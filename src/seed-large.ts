import { createHash } from 'crypto';
import { QueryRunner } from 'typeorm';
import { AppDataSource } from './data-source';

// Dataset size (from the brief)
const ACCOUNTANTS = 200;
const CLIENTS = 20_000;
const REQUESTS = 1_000_000;
const BATCH = 2_000; // requests per insert batch

// Time layout: requests are spread over one year, and every two requests
// share the same timestamp, so the keyset pagination ties are exercised.
const BASE_MS = Date.UTC(2025, 9, 20);
const STEP_MS = 63_072; // 500,000 steps over 365 days
const HOUR = 3_600_000;
const DAY = 86_400_000;

type Status = 'pending' | 'reviewing' | 'rejected' | 'approved';

const sqlDateTime = (ms: number): string =>
  new Date(ms).toISOString().replace('T', ' ').replace('Z', '000');
const sqlDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const rowPlaceholders = (rows: number, columns: number): string => {
  const one = `(${new Array<string>(columns).fill('?').join(',')})`;
  return new Array<string>(rows).fill(one).join(',');
};

// Each client belongs to one accountant, spread evenly (100 clients each).
const ownerOf = (clientId: number): number =>
  ((clientId - 1) % ACCOUNTANTS) + 1;

// Distribution of requests per client: a few heavy clients, some big ones,
// and the rest with a few dozen. The total is exactly REQUESTS.
function requestsPerClient(): number[] {
  const heavy = 20;
  const heavyEach = 5_000;
  const big = 380;
  const bigEach = 789;
  const rest = CLIENTS - heavy - big;
  const remaining = REQUESTS - heavy * heavyEach - big * bigEach;
  const base = Math.floor(remaining / rest);
  const extra = remaining - base * rest;
  const counts = new Array<number>(CLIENTS).fill(0);
  for (let c = 0; c < CLIENTS; c++) {
    if (c < heavy) counts[c] = heavyEach;
    else if (c < heavy + big) counts[c] = bigEach;
    else counts[c] = base + (c - heavy - big < extra ? 1 : 0);
  }
  return counts;
}

// A small seeded random generator, so every run produces the same data.
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// For each request, which client owns it. Shuffled, so one client's requests
// are spread over the whole year instead of sitting side by side.
function clientForEachRequest(): Int32Array {
  const counts = requestsPerClient();
  const list = new Int32Array(REQUESTS);
  let k = 0;
  counts.forEach((n, c) => {
    for (let j = 0; j < n; j++) list[k++] = c + 1;
  });
  const random = mulberry32(42);
  for (let i = REQUESTS - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

// 40% approved, 25% pending, 20% reviewing, 15% rejected.
function statusFor(i: number): Status {
  const slot = (i * 7) % 20;
  if (slot < 8) return 'approved';
  if (slot < 13) return 'pending';
  if (slot < 17) return 'reviewing';
  return 'rejected';
}

async function insertRows(
  qr: QueryRunner,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  if (rows.length === 0) return;
  const names = columns.map((c) => `\`${c}\``).join(',');
  const sql = `INSERT INTO \`${table}\` (${names}) VALUES ${rowPlaceholders(rows.length, columns.length)}`;
  await qr.query(sql, rows.flat());
}

const REQUEST_COLUMNS = [
  'id',
  'title',
  'description',
  'status',
  'rejectionReason',
  'createdAt',
  'updatedAt',
  'dueDate',
  'reviewedAt',
  'storageKey',
  'originalName',
  'mimeType',
  'fileSize',
  'checksum',
  'version',
  'clientId',
  'accountantId',
  'reviewerId',
];
const EVENT_COLUMNS = [
  'requestId',
  'fromStatus',
  'toStatus',
  'reason',
  'actorAccountantId',
  'actorClientId',
  'createdAt',
];

function buildBatch(
  from: number,
  to: number,
  clients: Int32Array,
): { requests: unknown[][]; events: unknown[][] } {
  const requests: unknown[][] = [];
  const events: unknown[][] = [];
  for (let i = from; i < to; i++) {
    const id = i + 1;
    const clientId = clients[i];
    const owner = ownerOf(clientId);
    const status = statusFor(i);
    const created = BASE_MS + Math.floor(i / 2) * STEP_MS;
    const uploaded = created + HOUR;
    const decided = created + 5 * HOUR;
    const hasFile = status !== 'pending';
    const isDecided = status === 'approved' || status === 'rejected';
    const version = status === 'pending' ? 0 : status === 'reviewing' ? 1 : 2;
    const dueDate =
      i % 10 < 7 ? sqlDay(created + (7 + ((i * 13) % 54)) * DAY) : null;
    const updated = isDecided ? decided : hasFile ? uploaded : created;

    requests.push([
      id,
      `Seed request ${id}`,
      'Seeded for load testing',
      status,
      status === 'rejected' ? 'Seeded rejection' : null,
      sqlDateTime(created),
      sqlDateTime(updated),
      dueDate,
      isDecided ? sqlDateTime(decided) : null,
      hasFile ? `seed-${id}.pdf` : null,
      hasFile ? `document-${id}.pdf` : null,
      hasFile ? 'application/pdf' : null,
      hasFile ? 20_000 + (id % 400_000) : null,
      hasFile ? createHash('sha256').update(String(id)).digest('hex') : null,
      version,
      clientId,
      owner,
      isDecided ? owner : null,
    ]);

    // History: created by the accountant, uploaded by the client, decided by the accountant.
    events.push([id, null, 'pending', null, owner, null, sqlDateTime(created)]);
    if (hasFile) {
      events.push([
        id,
        'pending',
        'reviewing',
        null,
        null,
        clientId,
        sqlDateTime(uploaded),
      ]);
    }
    if (isDecided) {
      events.push([
        id,
        'reviewing',
        status,
        status === 'rejected' ? 'Seeded rejection' : null,
        owner,
        null,
        sqlDateTime(decided),
      ]);
    }
  }
  return { requests, events };
}

async function truncateAll(qr: QueryRunner): Promise<void> {
  await qr.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [
    'document_request_event',
    'bulk_batch',
    'document_request',
    'client',
    'accountant',
  ]) {
    await qr.query(`TRUNCATE TABLE \`${table}\``);
  }
  await qr.query('SET FOREIGN_KEY_CHECKS = 1');
}

const seconds = (since: number): string =>
  ((Date.now() - since) / 1000).toFixed(1);

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  const started = Date.now();

  try {
    const [{ n }] = (await qr.query(
      'SELECT COUNT(*) AS n FROM document_request',
    )) as [{ n: string }];
    const existing = Number(n);

    if (existing >= REQUESTS && !reset) {
      console.log(
        `Already seeded (${existing} requests). Use --reset to rebuild.`,
      );
      return;
    }
    if (existing > 0 && !reset) {
      console.log(
        `The table has ${existing} requests, not the large dataset. Run with --reset to wipe and reseed.`,
      );
      process.exitCode = 1;
      return;
    }
    if (reset) {
      console.log('Resetting tables...');
      await truncateAll(qr);
    }

    // Faster loading: skip foreign key and unique checks. The data is built to be consistent; counts and the status split are printed at the end.
    await qr.query('SET FOREIGN_KEY_CHECKS = 0');
    await qr.query('SET UNIQUE_CHECKS = 0');

    let phase = Date.now();
    await insertRows(
      qr,
      'accountant',
      ['id', 'username', 'email'],
      Array.from({ length: ACCOUNTANTS }, (_, k) => [
        k + 1,
        `seed-accountant-${k + 1}`,
        `seed-accountant-${k + 1}@test.com`,
      ]),
    );
    for (let from = 0; from < CLIENTS; from += BATCH) {
      const rows: unknown[][] = [];
      for (let c = from + 1; c <= Math.min(from + BATCH, CLIENTS); c++) {
        rows.push([
          c,
          `seed-client-${c}`,
          `seed-client-${c}@test.com`,
          ownerOf(c),
        ]);
      }
      await insertRows(
        qr,
        'client',
        ['id', 'username', 'email', 'accountantId'],
        rows,
      );
    }
    console.log(`Accountants and clients inserted in ${seconds(phase)}s`);

    phase = Date.now();
    const clients = clientForEachRequest();
    let eventCount = 0;
    for (let from = 0; from < REQUESTS; from += BATCH) {
      const to = Math.min(from + BATCH, REQUESTS);
      const { requests, events } = buildBatch(from, to, clients);
      await qr.startTransaction();
      try {
        await insertRows(qr, 'document_request', REQUEST_COLUMNS, requests);
        await insertRows(qr, 'document_request_event', EVENT_COLUMNS, events);
        await qr.commitTransaction();
      } catch (error) {
        await qr.rollbackTransaction();
        throw error;
      }
      eventCount += events.length;
      if (to % 50_000 === 0) {
        console.log(
          `  ${to} requests, ${eventCount} events (${seconds(phase)}s)`,
        );
      }
    }
    await qr.query('SET UNIQUE_CHECKS = 1');
    await qr.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`Requests and events inserted in ${seconds(phase)}s`);
    console.log(`Seeding took ${seconds(started)}s in total`);

    // Verification report, to copy into PERFORMANCE.md
    console.log('\nStatus split:');
    console.table(
      await qr.query(
        `SELECT status, COUNT(*) AS n,
                ROUND(100 * COUNT(*) / (SELECT COUNT(*) FROM document_request), 1) AS pct
         FROM document_request GROUP BY status`,
      ),
    );
    console.log('Busiest clients:');
    console.table(
      await qr.query(
        `SELECT clientId, COUNT(*) AS requests FROM document_request
         GROUP BY clientId ORDER BY requests DESC LIMIT 3`,
      ),
    );
    console.log('Table and index sizes:');
    console.table(
      await qr.query(
        `SELECT table_name AS tableName, table_rows AS approxRows,
                ROUND(data_length / 1048576, 1) AS dataMb,
                ROUND(index_length / 1048576, 1) AS indexMb
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name IN ('document_request', 'document_request_event', 'client', 'accountant')`,
      ),
    );
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
