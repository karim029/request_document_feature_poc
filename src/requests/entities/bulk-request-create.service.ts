import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { BulkCreateRequestDto } from '../dto/bulk-create-request.dto';

export interface BulkCreateResponse {
  created: number;
  requestIds: number[];
}

interface Target {
  clientId: number;
  accountantId: number;
}

/**
 * Creates the same request for many clients at once.
 *
 * All or nothing: everything happens in one transaction, so one bad client id means nothing is
 * inserted. The first thing the transaction does is claim the idempotency key in `bulk_batch`
 * (a unique key), so a retry, or two identical requests at the same moment, cannot create the
 * batch twice: the second one hits the duplicate key and gets the stored answer back.
 */
@Injectable()
export class BulkRequestsService {
  // 'multi' inserts all rows with one statement. 'loop' inserts one row per statement. The loop
  // exists only so the difference can be measured (docs/PERFORMANCE.md).
  private readonly insertMode =
    process.env.BULK_INSERT_MODE === 'loop' ? 'loop' : 'multi';

  constructor(private readonly dataSource: DataSource) {}

  async create(
    actorId: number,
    idempotencyKey: string,
    dto: BulkCreateRequestDto,
  ): Promise<BulkCreateResponse> {
    const requestHash = this.hashOf(dto);
    try {
      return await this.dataSource.transaction((manager) =>
        this.createInTransaction(
          manager,
          actorId,
          idempotencyKey,
          requestHash,
          dto,
        ),
      );
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        return this.replay(idempotencyKey, requestHash);
      }
      throw error;
    }
  }

  private async createInTransaction(
    manager: EntityManager,
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
    dto: BulkCreateRequestDto,
  ): Promise<BulkCreateResponse> {
    // 1. Claim the idempotency key. A retry fails here with a duplicate key.
    await manager.query(
      `INSERT INTO bulk_batch (idempotencyKey, requestHash, response, createdAt)
       VALUES (?, ?, '', NOW(6))`,
      [idempotencyKey, requestHash],
    );

    // 2. Only an accountant creates requests.
    const actors = await manager.query<Array<{ id: number }>>(
      'SELECT id FROM accountant WHERE id = ?',
      [actorId],
    );
    if (actors.length === 0) {
      throw new ForbiddenException('Only an accountant can create requests.');
    }

    // 3. Every client must exist. Otherwise the whole batch is rejected, listing the unknown ids.
    const clients = await manager.query<
      Array<{ id: number; accountantId: number }>
    >('SELECT id, accountantId FROM client WHERE id IN (?)', [dto.clientIds]);
    const accountantOf = new Map(
      clients.map((client) => [client.id, client.accountantId]),
    );
    const unknown = dto.clientIds.filter((id) => !accountantOf.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `These client ids do not exist: ${unknown.join(', ')}`,
      );
    }

    // 4. Insert the requests, and the first event of each.
    const targets: Target[] = dto.clientIds.map((clientId) => ({
      clientId,
      accountantId: accountantOf.get(clientId) as number,
    }));
    const requestIds =
      this.insertMode === 'loop'
        ? await this.insertOneByOne(manager, targets, dto, actorId)
        : await this.insertMultiRow(manager, targets, dto, actorId);

    // 5. Store the answer with the key, so a retry returns exactly the same thing.
    const response: BulkCreateResponse = {
      created: requestIds.length,
      requestIds,
    };
    await manager.query(
      'UPDATE bulk_batch SET response = ? WHERE idempotencyKey = ?',
      [JSON.stringify(response), idempotencyKey],
    );
    return response;
  }

  // One INSERT for all the requests and one for all the events.
  private async insertMultiRow(
    manager: EntityManager,
    targets: Target[],
    dto: BulkCreateRequestDto,
    actorId: number,
  ): Promise<number[]> {
    const requestRows = targets
      .map(() => `(?, ?, 'pending', ?, ?, ?, NOW(6), NOW(6))`)
      .join(',');
    const requestParams = targets.flatMap((target) => [
      dto.title,
      dto.description ?? null,
      dto.dueDate ?? null,
      target.clientId,
      target.accountantId,
    ]);
    const inserted = await manager.query<Array<{ id: number }>>(
      `INSERT INTO document_request
         (title, description, status, dueDate, clientId, accountantId, createdAt, updatedAt)
       VALUES ${requestRows}
       RETURNING id`,
      requestParams,
    );
    const requestIds = inserted.map((row) => row.id);

    const eventRows = requestIds
      .map(() => `(?, NULL, 'pending', NULL, ?, NULL, NOW(6))`)
      .join(',');
    const eventParams = requestIds.flatMap((id) => [id, actorId]);
    await manager.query(
      `INSERT INTO document_request_event
         (requestId, fromStatus, toStatus, reason, actorAccountantId, actorClientId, createdAt)
       VALUES ${eventRows}`,
      eventParams,
    );
    return requestIds;
  }

  // One INSERT per request and one per event. Kept only to measure against the multi-row version.
  private async insertOneByOne(
    manager: EntityManager,
    targets: Target[],
    dto: BulkCreateRequestDto,
    actorId: number,
  ): Promise<number[]> {
    const requestIds: number[] = [];
    for (const target of targets) {
      const inserted = await manager.query<Array<{ id: number }>>(
        `INSERT INTO document_request
           (title, description, status, dueDate, clientId, accountantId, createdAt, updatedAt)
         VALUES (?, ?, 'pending', ?, ?, ?, NOW(6), NOW(6))
         RETURNING id`,
        [
          dto.title,
          dto.description ?? null,
          dto.dueDate ?? null,
          target.clientId,
          target.accountantId,
        ],
      );
      const id = inserted[0].id;
      await manager.query(
        `INSERT INTO document_request_event
           (requestId, fromStatus, toStatus, reason, actorAccountantId, actorClientId, createdAt)
         VALUES (?, NULL, 'pending', NULL, ?, NULL, NOW(6))`,
        [id, actorId],
      );
      requestIds.push(id);
    }
    return requestIds;
  }

  // The same key arrived again: return the stored answer, unless the body is different.
  private async replay(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<BulkCreateResponse> {
    const rows = await this.dataSource.query<
      Array<{ requestHash: string; response: string }>
    >('SELECT requestHash, response FROM bulk_batch WHERE idempotencyKey = ?', [
      idempotencyKey,
    ]);
    const stored = rows[0];
    if (!stored) {
      throw new ConflictException(
        'The idempotency key is in use by another request. Retry.',
      );
    }
    if (stored.requestHash !== requestHash) {
      throw new ConflictException(
        'This idempotency key was already used with a different body.',
      );
    }
    return JSON.parse(stored.response) as BulkCreateResponse;
  }

  // The same ids in a different order are the same request.
  private hashOf(dto: BulkCreateRequestDto): string {
    const normalized = JSON.stringify({
      title: dto.title,
      description: dto.description ?? null,
      dueDate: dto.dueDate ?? null,
      clientIds: [...dto.clientIds].sort((a, b) => a - b),
    });
    return createHash('sha256').update(normalized).digest('hex');
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code ===
        'ER_DUP_ENTRY'
    );
  }
}
