import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';

/**
 * Integration tests against a real MariaDB (the database in .env, or the CI service container).
 * Every row they create is tagged and removed afterwards.
 */

interface Envelope<T> {
  data?: T;
}
const unwrap = <T>(body: unknown): T =>
  ((body as Envelope<T>).data ?? body) as T;

describe('Requests portal (real MariaDB)', () => {
  let app: INestApplication;
  let db: DataSource;
  const tag = `it${Date.now()}`;
  let accountantId: number;
  let otherAccountantId: number;
  let clientId: number;
  let secondClientId: number;
  let baseUrl: string;

  async function insert(sql: string, params: unknown[]): Promise<number> {
    const result = await db.query<{ insertId: number }>(sql, params);
    return Number(result.insertId);
  }

  async function count(
    table: string,
    where: string,
    params: unknown[],
  ): Promise<number> {
    const rows = await db.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
      params,
    );
    return Number(rows[0].n);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    db = app.get(DataSource);

    accountantId = await insert(
      'INSERT INTO accountant (username, email) VALUES (?, ?)',
      [`${tag}-acc1`, `${tag}-acc1@test.com`],
    );
    otherAccountantId = await insert(
      'INSERT INTO accountant (username, email) VALUES (?, ?)',
      [`${tag}-acc2`, `${tag}-acc2@test.com`],
    );
    clientId = await insert(
      'INSERT INTO client (username, email, accountantId) VALUES (?, ?, ?)',
      [`${tag}-cli1`, `${tag}-cli1@test.com`, accountantId],
    );
    secondClientId = await insert(
      'INSERT INTO client (username, email, accountantId) VALUES (?, ?, ?)',
      [`${tag}-cli2`, `${tag}-cli2@test.com`, accountantId],
    );
  });

  afterAll(async () => {
    await db.query(
      `DELETE e FROM document_request_event e
         JOIN document_request r ON r.id = e.requestId
        WHERE r.title LIKE ?`,
      [`${tag}%`],
    );
    await db.query('DELETE FROM document_request WHERE title LIKE ?', [
      `${tag}%`,
    ]);
    await db.query('DELETE FROM bulk_batch WHERE idempotencyKey LIKE ?', [
      `${tag}%`,
    ]);
    await db.query('DELETE FROM client WHERE username LIKE ?', [`${tag}%`]);
    await db.query('DELETE FROM accountant WHERE username LIKE ?', [`${tag}%`]);
    for (const name of await uploadedFiles()) {
      await unlink(join(UPLOADS, name));
    }
    await app.close();
  });

  // Upload helpers. The uploaded file name carries the tag, so the stored file can be found.
  const UPLOADS = 'uploads';

  async function uploadedFiles(): Promise<string[]> {
    const names = await readdir(UPLOADS).catch(() => [] as string[]);
    return names.filter((name) => name.includes(tag));
  }

  // Polls a condition for up to 2 s: Nest removes a rejected upload after the response is sent.
  async function waitFor(condition: () => Promise<boolean>): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (await condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return condition();
  }

  async function addRequest(
    name: string,
    status: string,
    version: number,
  ): Promise<number> {
    return insert(
      `INSERT INTO document_request
         (title, status, clientId, accountantId, version, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, NOW(6), NOW(6))`,
      [`${tag} ${name}`, status, clientId, accountantId, version],
    );
  }

  function upload(requestId: number, actor: number, version?: number) {
    const call = request(baseUrl)
      .post(`/requests/upload/${requestId}`)
      .set('X-Actor-Id', String(actor))
      .attach('file', Buffer.from('%PDF-1.4 integration test'), {
        filename: `${tag}-scan.pdf`,
        contentType: 'application/pdf',
      });
    return version === undefined
      ? call
      : call.field('version', String(version));
  }

  describe('upload', () => {
    it('the client uploads: 201, reviewing, version + 1, one event pending to reviewing by the client', async () => {
      const requestId = await addRequest('upload ok', 'pending', 0);

      const response = await upload(requestId, clientId, 0).expect(201);
      const body = unwrap<{ status: string; version: number }>(response.body);
      expect(body.status).toBe('reviewing');
      expect(body.version).toBe(1);

      const events = await db.query<
        Array<{
          fromStatus: string;
          toStatus: string;
          actorClientId: number;
          actorAccountantId: number | null;
        }>
      >(
        'SELECT fromStatus, toStatus, actorClientId, actorAccountantId FROM document_request_event WHERE requestId = ?',
        [requestId],
      );
      expect(events).toEqual([
        {
          fromStatus: 'pending',
          toStatus: 'reviewing',
          actorClientId: clientId,
          actorAccountantId: null,
        },
      ]);
    });

    it('a client that does not own the request gets 403', async () => {
      const requestId = await addRequest('upload not owner', 'pending', 0);
      await upload(requestId, secondClientId, 0).expect(403);
    });

    it('an approved request gets 400', async () => {
      const requestId = await addRequest('upload approved', 'approved', 2);
      await upload(requestId, clientId, 2).expect(400);
    });

    it('a missing version gives 400 and leaves no new file in uploads/', async () => {
      const requestId = await addRequest('upload no version', 'pending', 0);
      const before = (await uploadedFiles()).length;

      await upload(requestId, clientId).expect(400);

      const unchanged = await waitFor(
        async () => (await uploadedFiles()).length === before,
      );
      expect(unchanged).toBe(true);
    });
  });

  describe('re-upload while a reviewer approves', () => {
    it('the client re-uploads first, so the reviewer who saw the old version gets 409', async () => {
      const requestId = await addRequest('re-upload race', 'reviewing', 1);

      // The client replaces the file the reviewer is looking at.
      const reupload = await upload(requestId, clientId, 1).expect(201);
      expect(unwrap<{ version: number }>(reupload.body).version).toBe(2);

      // The reviewer approves what they saw, version 1: it is no longer the current file.
      await request(baseUrl)
        .patch(`/requests/review/${requestId}`)
        .set('X-Actor-Id', String(accountantId))
        .send({ status: 'approved', version: 1 })
        .expect(409);

      const [row] = await db.query<Array<{ status: string; version: number }>>(
        'SELECT status, version FROM document_request WHERE id = ?',
        [requestId],
      );
      expect(row).toEqual({ status: 'reviewing', version: 2 });
    });
  });

  describe('single create', () => {
    it('writes the request and exactly one first event by the accountant, and returns no private fields', async () => {
      const title = `${tag} single create`;
      const response = await request(baseUrl)
        .post('/requests')
        .set('X-Actor-Id', String(accountantId))
        .send({ clientId, title })
        .expect(201);
      const created = unwrap<{ id: number }>(response.body);

      const events = await db.query<
        Array<{
          fromStatus: string | null;
          toStatus: string;
          actorAccountantId: number;
          actorClientId: number | null;
        }>
      >(
        'SELECT fromStatus, toStatus, actorAccountantId, actorClientId FROM document_request_event WHERE requestId = ?',
        [created.id],
      );
      expect(events).toEqual([
        {
          fromStatus: null,
          toStatus: 'pending',
          actorAccountantId: accountantId,
          actorClientId: null,
        },
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(
        /email|storageKey|checksum/,
      );
    });

    it('a missing actor header gives 400 and creates nothing', async () => {
      const title = `${tag} single no actor`;
      await request(baseUrl)
        .post('/requests')
        .send({ clientId, title })
        .expect(400);
      expect(await count('document_request', 'title = ?', [title])).toBe(0);
    });
  });

  describe('response envelope', () => {
    it('wraps a success in { success: true, data } and an error in { success: false }', async () => {
      const ok = await request(baseUrl)
        .get('/requests')
        .query({ accountantId })
        .expect(200);
      expect(ok.body).toMatchObject({ success: true });
      expect(ok.body).toHaveProperty('data');

      const missing = await request(baseUrl)
        .get('/requests/999999999')
        .expect(404);
      expect(missing.body).toMatchObject({ success: false, statusCode: 404 });
    });
  });

  describe('parallel transitions', () => {
    it('20 parallel approve and reject calls: exactly one 200, the rest 409, one consistent history', async () => {
      const requestId = await insert(
        `INSERT INTO document_request
           (title, status, clientId, accountantId, version, createdAt, updatedAt)
         VALUES (?, 'reviewing', ?, ?, 0, NOW(6), NOW(6))`,
        [`${tag} parallel`, clientId, accountantId],
      );

      const calls = Array.from({ length: 20 }, (_, i) =>
        request(baseUrl)
          .patch(`/requests/review/${requestId}`)
          .set(
            'X-Actor-Id',
            String(i % 2 === 0 ? accountantId : otherAccountantId),
          )
          .send(
            i % 4 < 2
              ? { status: 'approved', version: 0 }
              : {
                  status: 'rejected',
                  rejectionReason: 'parallel test',
                  version: 0,
                },
          ),
      );
      const responses = await Promise.all(calls);

      const codes = responses.map((response) => response.status);
      expect(codes.filter((code) => code !== 200 && code !== 409)).toEqual([]);
      expect(codes.filter((code) => code === 200)).toHaveLength(1);
      expect(codes.filter((code) => code === 409)).toHaveLength(19);

      const [row] = await db.query<Array<{ status: string; version: number }>>(
        'SELECT status, version FROM document_request WHERE id = ?',
        [requestId],
      );
      expect(row.version).toBe(1);
      expect(['approved', 'rejected']).toContain(row.status);

      const events = await db.query<
        Array<{ fromStatus: string; toStatus: string }>
      >(
        'SELECT fromStatus, toStatus FROM document_request_event WHERE requestId = ?',
        [requestId],
      );
      expect(events).toHaveLength(1);
      expect(events[0].fromStatus).toBe('reviewing');
      expect(events[0].toStatus).toBe(row.status);

      const history = await request(baseUrl)
        .get(`/requests/${requestId}/history`)
        .expect(200);
      const items = unwrap<Array<{ toStatus: string }>>(history.body);
      expect(items).toHaveLength(1);
      expect(items[0].toStatus).toBe(row.status);
    });
  });

  describe('inbox pagination with identical timestamps', () => {
    let pagingAccountantId: number;
    const stamps = [
      '2026-01-01 10:00:00.123456',
      '2026-01-01 10:00:00.123457',
      '2026-01-02 09:30:00.000000',
      '2026-01-03 08:15:00.500000',
      '2026-01-04 23:59:59.999999',
    ];

    beforeAll(async () => {
      pagingAccountantId = await insert(
        'INSERT INTO accountant (username, email) VALUES (?, ?)',
        [`${tag}-pager`, `${tag}-pager@test.com`],
      );
      const pagingClientId = await insert(
        'INSERT INTO client (username, email, accountantId) VALUES (?, ?, ?)',
        [`${tag}-pagercli`, `${tag}-pagercli@test.com`, pagingAccountantId],
      );
      // 57 requests that share only five different timestamps, and four different due dates.
      for (let i = 0; i < 57; i++) {
        await insert(
          `INSERT INTO document_request
             (title, status, clientId, accountantId, dueDate, version, createdAt, updatedAt)
           VALUES (?, 'pending', ?, ?, ?, 0, ?, ?)`,
          [
            `${tag} page ${i}`,
            pagingClientId,
            pagingAccountantId,
            i % 3 === 0 ? null : `2026-02-0${1 + (i % 4)}`,
            stamps[i % 5],
            stamps[i % 5],
          ],
        );
      }
    });

    interface Page {
      items: Array<{ id: number }>;
      nextCursor: string | null;
    }

    async function pageAll(sort: string, limit: number): Promise<number[]> {
      const ids: number[] = [];
      let cursor: string | undefined;
      for (;;) {
        const response: request.Response = await request(baseUrl)
          .get('/requests')
          .query({ accountantId: pagingAccountantId, limit, sort, cursor })
          .expect(200);
        const page: Page = unwrap<Page>(response.body);
        ids.push(...page.items.map((item) => item.id));
        if (!page.nextCursor) return ids;
        cursor = page.nextCursor;
      }
    }

    it.each([10, 7, 100])(
      'newest first, page size %i: every request once, in order',
      async (limit) => {
        const expected = (
          await db.query<Array<{ id: number }>>(
            'SELECT id FROM document_request WHERE accountantId = ? ORDER BY createdAt DESC, id DESC',
            [pagingAccountantId],
          )
        ).map((row) => row.id);
        const paged = await pageAll('createdAt_desc', limit);
        expect(paged).toHaveLength(57);
        expect(new Set(paged).size).toBe(57);
        expect(paged).toEqual(expected);
      },
    );

    it('by due date, page size 10: every request with a due date once, in order', async () => {
      const expected = (
        await db.query<Array<{ id: number }>>(
          `SELECT id FROM document_request
            WHERE accountantId = ? AND dueDate IS NOT NULL
            ORDER BY dueDate ASC, id ASC`,
          [pagingAccountantId],
        )
      ).map((row) => row.id);
      const paged = await pageAll('dueDate_asc', 10);
      expect(new Set(paged).size).toBe(paged.length);
      expect(paged).toEqual(expected);
    });

    it('rejects a cursor that is not valid', async () => {
      await request(baseUrl)
        .get('/requests')
        .query({ accountantId: pagingAccountantId, cursor: 'garbage' })
        .expect(400);
    });
  });

  describe('bulk create', () => {
    const bulk = (key: string, body: object) =>
      request(baseUrl)
        .post('/requests/bulk')
        .set('X-Actor-Id', String(accountantId))
        .set('Idempotency-Key', key)
        .send(body);

    it('is atomic: one unknown client id means nothing is inserted', async () => {
      const key = `${tag}-bad`;
      const title = `${tag} bulk bad`;
      const response = await bulk(key, {
        title,
        clientIds: [clientId, secondClientId, 999999999],
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('999999999');
      expect(await count('document_request', 'title = ?', [title])).toBe(0);
      expect(await count('bulk_batch', 'idempotencyKey = ?', [key])).toBe(0);
    });

    it('a retry returns the same answer and creates nothing; a different body is rejected', async () => {
      const key = `${tag}-retry`;
      const title = `${tag} bulk retry`;
      const body = { title, clientIds: [clientId, secondClientId] };

      const first = await bulk(key, body);
      expect(first.status).toBe(201);
      const created = unwrap<{ created: number; requestIds: number[] }>(
        first.body,
      );
      expect(created.created).toBe(2);
      expect(await count('document_request', 'title = ?', [title])).toBe(2);
      expect(
        await count(
          'document_request_event',
          `requestId IN (SELECT id FROM document_request WHERE title = ?)`,
          [title],
        ),
      ).toBe(2);

      const second = await bulk(key, body);
      expect(second.status).toBe(201);
      expect(unwrap(second.body)).toEqual(created);
      expect(await count('document_request', 'title = ?', [title])).toBe(2);

      const different = await bulk(key, { title, clientIds: [clientId] });
      expect(different.status).toBe(409);
    });

    it('five identical requests at the same moment create the batch once', async () => {
      const key = `${tag}-race`;
      const title = `${tag} bulk race`;
      const body = { title, clientIds: [clientId, secondClientId] };

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => bulk(key, body)),
      );

      expect(responses.map((response) => response.status)).toEqual([
        201, 201, 201, 201, 201,
      ]);
      const answers = responses.map((response) =>
        JSON.stringify(unwrap(response.body)),
      );
      expect(new Set(answers).size).toBe(1);
      expect(await count('document_request', 'title = ?', [title])).toBe(2);
    });
  });
});
