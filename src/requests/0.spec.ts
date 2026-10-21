import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { BulkRequestsService } from './entities/bulk-request-create.service';
const dto = { title: 'Bank statement', clientIds: [5, 6] };

interface Call {
  sql: string;
  params: unknown[];
}

function setup(
  options: {
    accountantExists?: boolean;
    knownClients?: number[];
    duplicate?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const manager = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO bulk_batch')) {
        return options.duplicate
          ? Promise.reject(
              new QueryFailedError(sql, params, {
                code: 'ER_DUP_ENTRY',
              } as unknown as Error),
            )
          : Promise.resolve(undefined);
      }
      if (sql.includes('FROM accountant')) {
        return Promise.resolve(
          options.accountantExists === false ? [] : [{ id: 1 }],
        );
      }
      if (sql.includes('FROM client')) {
        return Promise.resolve(
          (options.knownClients ?? [5, 6]).map((id) => ({
            id,
            accountantId: 1,
          })),
        );
      }
      if (sql.includes('INSERT INTO document_request_event'))
        return Promise.resolve(undefined);
      if (sql.includes('INSERT INTO document_request')) {
        // Five parameters per request row.
        const rows = params.length / 5;
        return Promise.resolve(
          Array.from({ length: rows }, (_, i) => ({ id: 100 + i })),
        );
      }
      if (sql.includes('UPDATE bulk_batch')) return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected query: ${sql}`));
    }),
  };
  const replayQuery = jest.fn();
  const dataSource = {
    transaction: jest.fn((callback: (m: typeof manager) => Promise<unknown>) =>
      callback(manager),
    ),
    query: replayQuery,
  } as unknown as DataSource;
  const inserts = (table: string) =>
    calls.filter(
      (call) =>
        call.sql.includes(`INSERT INTO ${table}`) &&
        !call.sql.includes(`${table}_`),
    );
  return { calls, dataSource, replayQuery, inserts };
}

describe('BulkRequestsService', () => {
  const originalMode = process.env.BULK_INSERT_MODE;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.BULK_INSERT_MODE;
    else process.env.BULK_INSERT_MODE = originalMode;
  });

  it('inserts the requests and their first events with one statement each, and stores the response', async () => {
    delete process.env.BULK_INSERT_MODE;
    const { calls, dataSource, inserts } = setup();

    const result = await new BulkRequestsService(dataSource).create(
      1,
      'key-1',
      dto,
    );

    expect(result).toEqual({ created: 2, requestIds: [100, 101] });
    expect(inserts('document_request')).toHaveLength(1);
    expect(
      calls.filter((call) =>
        call.sql.includes('INSERT INTO document_request_event'),
      ),
    ).toHaveLength(1);
    const update = calls.find((call) => call.sql.includes('UPDATE bulk_batch'));
    expect(update?.params[0]).toBe(JSON.stringify(result));
  });

  it('claims the idempotency key before doing anything else', async () => {
    delete process.env.BULK_INSERT_MODE;
    const { calls, dataSource } = setup();

    await new BulkRequestsService(dataSource).create(1, 'key-1', dto);

    expect(calls[0].sql).toContain('INSERT INTO bulk_batch');
    expect(calls[0].params[0]).toBe('key-1');
  });

  it('rejects the whole batch when a client id does not exist, and lists it', async () => {
    delete process.env.BULK_INSERT_MODE;
    const { dataSource, inserts } = setup({ knownClients: [5] });

    const attempt = new BulkRequestsService(dataSource).create(1, 'key-2', dto);

    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow('6');
    expect(inserts('document_request')).toHaveLength(0);
  });

  it('refuses a caller who is not an accountant', async () => {
    delete process.env.BULK_INSERT_MODE;
    const { dataSource, inserts } = setup({ accountantExists: false });

    await expect(
      new BulkRequestsService(dataSource).create(9, 'key-3', dto),
    ).rejects.toThrow(ForbiddenException);
    expect(inserts('document_request')).toHaveLength(0);
  });

  it('returns the stored answer when the key was already used with the same body', async () => {
    delete process.env.BULK_INSERT_MODE;
    const { calls, dataSource, replayQuery, inserts } = setup({
      duplicate: true,
    });
    const stored = { created: 2, requestIds: [1, 2] };
    replayQuery.mockImplementation(() =>
      Promise.resolve([
        { requestHash: calls[0].params[1], response: JSON.stringify(stored) },
      ]),
    );

    const result = await new BulkRequestsService(dataSource).create(
      1,
      'key-4',
      dto,
    );

    expect(result).toEqual(stored);
    expect(inserts('document_request')).toHaveLength(0);
  });

  it('rejects the same key with a different body (409)', async () => {
    delete process.env.BULK_INSERT_MODE;
    const { dataSource, replayQuery } = setup({ duplicate: true });
    replayQuery.mockResolvedValue([
      {
        requestHash: 'some-other-hash',
        response: JSON.stringify({ created: 1, requestIds: [1] }),
      },
    ]);

    await expect(
      new BulkRequestsService(dataSource).create(1, 'key-5', dto),
    ).rejects.toThrow(ConflictException);
  });

  it('inserts one row per statement in loop mode (kept only to measure the difference)', async () => {
    process.env.BULK_INSERT_MODE = 'loop';
    const { calls, dataSource, inserts } = setup();

    await new BulkRequestsService(dataSource).create(1, 'key-6', dto);

    expect(inserts('document_request')).toHaveLength(2);
    expect(
      calls.filter((call) =>
        call.sql.includes('INSERT INTO document_request_event'),
      ),
    ).toHaveLength(2);
  });
});
