import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentRequest } from './entities/document-request.entity';
import { DataSource, Repository } from 'typeorm';
import { CreateRequestDto } from './dto/create-request.dto';
import { Client } from 'src/clients/entities/client.entity';
import { DocumentRequestStatus } from './entities/document-request-status.enum';
import { UpdateRequestDto } from './dto/update-request.dto';
import { Accountant } from 'src/accountants/entities/accountant.entity';
import { DocumentRequestEvent } from './entities/document-request-event.entity';
import { sha256File } from 'src/common/utils/sha256-file';
import { unlink } from 'fs/promises';
import { InboxQueryDto, InboxSort } from './dto/inbox-query.dto';
import { decodeCursor, encodeCursor } from './inbox-cursor';

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(DocumentRequest)
    private requestRepository: Repository<DocumentRequest>,
    @InjectRepository(Client) private clientRepository: Repository<Client>,
    private readonly dataSource: DataSource,
    @InjectRepository(DocumentRequestEvent)
    private readonly requestEventRepository: Repository<DocumentRequestEvent>,
  ) {}

  async getInbox(query: InboxQueryDto) {
    const qb = this.requestRepository
      .createQueryBuilder('r')
      .innerJoin('r.client', 'c')
      .select([
        'r.id',
        'r.title',
        'r.status',
        'r.dueDate',
        'r.createdAt',
        'r.version',
        'c.id',
        'c.username',
      ])
      .where('r.accountantId = :accountantId', {
        accountantId: query.accountantId,
      });

    if (query.clientId) {
      qb.andWhere('r.clientId = :clientId', { clientId: query.clientId });
    }
    if (query.status?.length) {
      qb.andWhere('r.status IN (:...statuses)', { statuses: query.status });
    }
    if (query.createdFrom) {
      qb.andWhere('r.createdAt >= :createdFrom', {
        createdFrom: query.createdFrom,
      });
    }
    if (query.createdTo) {
      qb.andWhere('r.createdAt <= :createdTo', { createdTo: query.createdTo });
    }
    if (query.overdue) {
      qb.andWhere('r.status IN (:...open)', {
        open: [DocumentRequestStatus.Pending, DocumentRequestStatus.Reviewing],
      }).andWhere('r.dueDate < CURDATE()');
    }
    if (query.sort === InboxSort.DueAsc) {
      qb.andWhere('r.dueDate IS NOT NULL')
        .orderBy('r.dueDate', 'ASC')
        .addOrderBy('r.id', 'ASC');
    } else {
      qb.orderBy('r.createdAt', 'DESC').addOrderBy('r.id', 'DESC');
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (cursor.sort !== String(query.sort)) {
        throw new BadRequestException('The cursor does not match the sort');
      }
      const column = query.sort === InboxSort.DueAsc ? 'dueDate' : 'createdAt';
      const operator = query.sort === InboxSort.DueAsc ? '>' : '<';
      const bookmark = `(SELECT b.${column} FROM document_request b WHERE b.id = :cid)`;
      qb.andWhere(
        `(r.${column} ${operator} ${bookmark} OR (r.${column} = ${bookmark} AND r.id ${operator} :cid))`,
        { cid: cursor.id },
      );
    }

    const rows = await qb.limit(query.limit + 1).getMany();
    const hasNext = rows.length > query.limit;
    const page = hasNext ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        dueDate: r.dueDate,
        createdAt: r.createdAt,
        version: r.version,
        client: { id: r.client.id, username: r.client.username },
      })),
      nextCursor:
        hasNext && last
          ? encodeCursor({ sort: query.sort, id: last.id })
          : null,
    };
  }

  async getRequest(id: number) {
    const request = await this.requestRepository.findOneBy({ id });
    if (!request) {
      throw new NotFoundException('No request found with this id');
    }
    return request;
  }

  async createRequest(createRequestDto: CreateRequestDto) {
    const client = await this.clientRepository.findOne({
      where: {
        id: createRequestDto.clientId,
      },
      relations: {
        accountant: true,
      },
    });
    if (!client) {
      throw new NotFoundException('Client does not exist.');
    }

    const newRequest = {
      title: createRequestDto.title,
      description: createRequestDto.description,
      client: client,
      accountant: client.accountant,
    };

    return await this.requestRepository.save(newRequest);
  }

  async saveDocument(
    requestId: number,
    actorId: number,
    version: number,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded or file rejected');
    }
    const checksum = await sha256File(file.path);
    try {
      return await this.dataSource.transaction(
        'READ COMMITTED',
        async (manager) => {
          const actor = await manager.findOneBy(Client, { id: actorId });
          if (!actor) {
            throw new ForbiddenException('Only a client can upload a document');
          }
          const req = await manager.findOne(DocumentRequest, {
            where: { id: requestId },
            relations: { client: true },
          });
          if (!req) {
            throw new NotFoundException('Request not found');
          }
          if (actorId !== req.client.id) {
            throw new ForbiddenException(
              'The actor must be the client of this request',
            );
          }
          if (req.status === DocumentRequestStatus.Approved) {
            throw new BadRequestException(
              'Cannot upload a document to approved requests',
            );
          }
          const result = await manager
            .createQueryBuilder()
            .update(DocumentRequest)
            .set({
              status: DocumentRequestStatus.Reviewing,
              rejectionReason: null,
              reviewer: null,
              reviewedAt: null,
              originalName: Buffer.from(file.originalname, 'latin1')
                .toString('utf8')
                .slice(0, 255),
              storageKey: file.filename,
              mimeType: file.mimetype,
              fileSize: file.size,
              checksum: checksum,
              version: () => 'version+1',
            })
            .where(
              'id = :id AND version = :version AND status IN (:...statuses)',
              {
                id: requestId,
                version,
                statuses: [
                  DocumentRequestStatus.Pending,
                  DocumentRequestStatus.Rejected,
                  DocumentRequestStatus.Reviewing,
                ],
              },
            )
            .execute();

          if (result.affected === 0) {
            const current = await manager.findOneBy(DocumentRequest, {
              id: requestId,
            });
            if (!current) {
              throw new NotFoundException('Request not found');
            }
            if (current.version !== version) {
              throw new ConflictException(
                'The request was changed by someone else. Reload it and try again',
              );
            }
            throw new BadRequestException(
              'document upload can happen when request is in pending, reviewing or rejected status',
            );
          }
          await manager.insert(DocumentRequestEvent, {
            request: { id: requestId },
            fromStatus: req.status,
            toStatus: DocumentRequestStatus.Reviewing,
            actorClient: { id: actorId },
          });
          return await manager.findOneBy(DocumentRequest, { id: requestId });
        },
      );
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  async updateStatus(
    id: number,
    actorId: number,
    updateRequestDto: UpdateRequestDto,
  ) {
    if (
      updateRequestDto.status !== DocumentRequestStatus.Approved &&
      updateRequestDto.status !== DocumentRequestStatus.Rejected
    ) {
      throw new BadRequestException(
        'Review status must be Approved or Rejected',
      );
    }

    if (
      updateRequestDto.status === DocumentRequestStatus.Rejected &&
      !updateRequestDto.rejectionReason
    ) {
      throw new BadRequestException(
        'A rejection reason is required when rejecting a request.',
      );
    }

    return await this.dataSource.transaction(
      'READ COMMITTED',
      async (manager) => {
        const actor = await manager.findOneBy(Accountant, { id: actorId });
        if (!actor) {
          throw new ForbiddenException(
            'Only an accountant can review a request',
          );
        }
        const result = await manager
          .createQueryBuilder()
          .update(DocumentRequest)
          .set({
            status: updateRequestDto.status,
            rejectionReason:
              updateRequestDto.status === DocumentRequestStatus.Approved
                ? null
                : updateRequestDto.rejectionReason,
            reviewer: { id: actor.id },
            reviewedAt: () => 'CURRENT_TIMESTAMP(6)',
            version: () => 'version+1',
          })
          .where('id= :id AND version = :version AND status = :reviewing', {
            id,
            version: updateRequestDto.version,
            reviewing: DocumentRequestStatus.Reviewing,
          })
          .execute();

        if (result.affected === 0) {
          const current = await manager.findOneBy(DocumentRequest, { id });
          if (!current) {
            throw new NotFoundException('Request does not exist.');
          }
          if (current.version !== updateRequestDto.version) {
            throw new ConflictException(
              'The request was changed by someone else. Reload it and try again',
            );
          }
          throw new BadRequestException(
            'Request can only be reviewed if it is currently in Reviewing status.',
          );
        }
        await manager.insert(DocumentRequestEvent, {
          request: { id },
          fromStatus: DocumentRequestStatus.Reviewing,
          toStatus: updateRequestDto.status,
          reason: updateRequestDto.rejectionReason! ?? null,
          actorAccountant: actor,
        });

        return await manager.findOneBy(DocumentRequest, { id });
      },
    );
  }

  async getHistory(requestId: number) {
    const exists = await this.requestRepository.existsBy({
      id: requestId,
    });
    if (!exists) {
      throw new NotFoundException('Request does not exist');
    }
    const events = await this.requestEventRepository.find({
      where: { request: { id: requestId } },
      relations: { actorAccountant: true, actorClient: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus,
      reason: event.reason ?? null,
      createdAt: event.createdAt,
      actor: event.actorAccountant
        ? { type: 'accountant' as const, id: event.actorAccountant.id }
        : { type: 'client' as const, id: event.actorClient?.id },
    }));
  }
}
