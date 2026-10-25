import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';

/**
 * The dashboard's review turnaround against a real MariaDB, with a rejection and re-upload cycle.
 * Every row it creates is tagged and removed afterwards.
 */

interface Envelope<T> {
  data?: T;
}
const unwrap = <T>(body: unknown): T =>
  ((body as Envelope<T>).data ?? body) as T;

describe('Dashboard review turnaround (real MariaDB)', () => {
  let app: INestApplication;
  let db: DataSource;
  let baseUrl: string;
  const tag = `itdash${Date.now()}`;
  const originalTtl = process.env.DASHBOARD_CACHE_TTL_MS;
  let accountantId: number;
  let clientId: number;

  async function insert(sql: string, params: unknown[]): Promise<number> {
    const result = await db.query<{ insertId: number }>(sql, params);
    return Number(result.insertId);
  }

  async function addRequest(name: string): Promise<number> {
    return insert(
      `INSERT INTO document_request
         (title, status, clientId, accountantId, version, createdAt, updatedAt)
       VALUES (?, 'approved', ?, ?, 0, NOW(6) - INTERVAL 10 HOUR, NOW(6))`,
      [`${tag} ${name}`, clientId, accountantId],
    );
  }

  // One history event, hoursAgo hours before now. Uploads are made by the client, the rest by the accountant.
  async function addEvent(
    requestId: number,
    fromStatus: string | null,
    toStatus: string,
    hoursAgo: number,
  ): Promise<void> {
    const byClient = toStatus === 'reviewing';
    await insert(
      `INSERT INTO document_request_event
         (requestId, fromStatus, toStatus, actorAccountantId, actorClientId, createdAt)
       VALUES (?, ?, ?, ?, ?, NOW(6) - INTERVAL ? SECOND)`,
      [
        requestId,
        fromStatus,
        toStatus,
        byClient ? null : accountantId,
        byClient ? clientId : null,
        hoursAgo * 3600,
      ],
    );
  }

  beforeAll(async () => {
    // Live numbers: the cache is read when the service is created.
    process.env.DASHBOARD_CACHE_TTL_MS = '0';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    db = app.get(DataSource);

    accountantId = await insert(
      'INSERT INTO accountant (username, email) VALUES (?, ?)',
      [`${tag}-acc`, `${tag}-acc@test.com`],
    );
    clientId = await insert(
      'INSERT INTO client (username, email, accountantId) VALUES (?, ?, ?)',
      [`${tag}-cli`, `${tag}-cli@test.com`, accountantId],
    );

    // Request A: one review of 1 hour.
    const a = await addRequest('A');
    await addEvent(a, null, 'pending', 10);
    await addEvent(a, 'pending', 'reviewing', 8);
    await addEvent(a, 'reviewing', 'approved', 7);

    // Request B: rejected after 1 hour, uploaded again, approved after 3 hours.
    const b = await addRequest('B');
    await addEvent(b, null, 'pending', 10);
    await addEvent(b, 'pending', 'reviewing', 9);
    await addEvent(b, 'reviewing', 'rejected', 8);
    await addEvent(b, 'rejected', 'reviewing', 7);
    await addEvent(b, 'reviewing', 'approved', 4);
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
    await db.query('DELETE FROM client WHERE username LIKE ?', [`${tag}%`]);
    await db.query('DELETE FROM accountant WHERE username LIKE ?', [`${tag}%`]);
    await app.close();
    if (originalTtl === undefined) delete process.env.DASHBOARD_CACHE_TTL_MS;
    else process.env.DASHBOARD_CACHE_TTL_MS = originalTtl;
  });

  it('pairs each decision with the latest review before it', async () => {
    const response = await request(baseUrl)
      .get(`/accountants/${accountantId}/dashboard`)
      .expect(200);
    const dashboard = unwrap<{ avgReviewTurnaroundHours: number | null }>(
      response.body,
    );

    // Three decisions: A 1 h, B rejected 1 h, B approved 3 h, so (1 + 1 + 3) / 3 = 1.67.
    // Pairing every upload with every decision gave 1.8: B added 1, -1, 5 and 3 hours.
    expect(dashboard.avgReviewTurnaroundHours).toBe(1.67);
  });
});
