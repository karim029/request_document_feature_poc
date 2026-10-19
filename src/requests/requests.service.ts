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

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(DocumentRequest)
    private requestRepository: Repository<DocumentRequest>,
    @InjectRepository(Client) private clientRepository: Repository<Client>,
    private readonly dataSource: DataSource
  ) {}

  async getAllRequests() {
    return await this.requestRepository.find();
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

  async saveDocument(requestId: number, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded or file rejected');
    }
    // fetch the request
    const req = await this.requestRepository.findOneBy({ id: requestId });
    if (!req) {
      throw new NotFoundException('Request does not exist.');
    }
    if (req.status === DocumentRequestStatus.Approved) {
      throw new BadRequestException(
        'Cannot upload file to an already approved request.',
      );
    }
    req.storageKey = file.path;
    req.status = DocumentRequestStatus.Reviewing;
    return await this.requestRepository.save(req);
  }

  async updateStatus(id: number,actorId: number , updateRequestDto: UpdateRequestDto) {

    if(updateRequestDto.status !== DocumentRequestStatus.Approved && updateRequestDto.status !== DocumentRequestStatus.Rejected){
      throw new BadRequestException('Review status must be Approved or Rejected')
    }

    if(updateRequestDto.status === DocumentRequestStatus.Rejected && !updateRequestDto.rejectionReason){
      throw new BadRequestException('A rejection reason is required when rejecting a request.')
    }

    return await this.dataSource.transaction(async(manager)=>{
      const actor = await manager.findOneBy(Accountant, {id:actorId})
      if(!actor){
        throw new ForbiddenException('Only an accountant can review a request')
      }
      const result = await manager.createQueryBuilder().update(DocumentRequest).set(
        {
          status: updateRequestDto.status,
          rejectionReason: updateRequestDto.status === DocumentRequestStatus.Approved ? null : updateRequestDto.rejectionReason,
          reviewer: {id: actor.id},
          reviewedAt: ()=> 'CURRENT_TIMESTAMP(6)',
          version: ()=> 'version+1',
        }
      ).where('id= :id AND version = :version AND status = :reviewing',{
        id,
        version: updateRequestDto.version,
        reviewing: DocumentRequestStatus.Reviewing
      }).execute()

      if(result.affected === 0){
        const current = await manager.findOneBy(DocumentRequest, {id})
        if(!current){
          throw new NotFoundException('Request does not exist.')
        }
        if(current.version !== updateRequestDto.version){
          throw new ConflictException('The request was changed by someone else. Reload it and try again')
        }
        throw new BadRequestException('Request can only be reviewed if it is currently in Reviewing status.')

      }
      await manager.insert(DocumentRequestEvent, {
        request: {id},
        fromStatus: DocumentRequestStatus.Reviewing,
        toStatus: updateRequestDto.status,
        reason: updateRequestDto.rejectionReason! ?? null,
        actorAccountant: actor

      })

      return await manager.findOneBy(DocumentRequest, {id})
    })
  }
}
