// Measures what the inbox indexes cost on writes.
//
// For each index setup it inserts rows (in bulk and one at a time) and updates the status of rows
// one at a time (the reviews and uploads), three rounds each, and reports the median rows per second.
// The test rows are deleted after every round. The last setup is the final design, so the database
// is left as the migrations define it.
//
// Run with the app stopped and the database otherwise idle:
//   npm run bench:write-cost

import { QueryRunner } from 'typeorm';
import { AppDataSource } from '../src/data-source';

const BULK_ROWS = 20_000;
const BULK_BATCH = 500;
const SINGLE_ROWS = 2_000;
const UPDATE_ROWS = 2_000;
const ROUNDS = 3;
const CLIENTS = 20_000;
const ACCOUNTANTS = 200;

const CREATED_NEW = 'ADD INDEX `IDX_request_inbox_created` (`accountantId`, `createdAt`, `id`)';
const STATUS_NEW =
  'ADD INDEX `IDX_request_inbox_status_created` (`accountantId`, `status`, `createdAt`, `id`)';
const DUE_NEW = 'ADD INDEX `IDX_request_inbox_due` (`accountantId`, `dueDate`, `id`)';
const CREATED_OLD =
  'ADD INDEX `IDX_request_inbox_created` (`accountantId`, `status`, `createdAt`)';
const DUE_OLD = 'ADD INDEX `IDX_request_inbox_due` (`accountantId`, `status`, `dueDate`)';

interface Setup {
  name: string;
  adds: string[];
}

// The foreign key on accountantId needs one index that starts with accountantId, so every
// setup keeps at least one.
const SETUPS: Setup[] = [
  { name: '1 inbox index (needed by the foreign key)', adds: [CREATED_NEW] },
  { name: 'Original design (2 indexes)', adds: [CREATED_OLD, DUE_OLD] },
  { name: 'Final design (3 indexes)', adds: [CREATED_NEW, STATUS_NEW, DUE_NEW] },
];

const DROP_ALL = [
  'IDX_request_inbox_created',
  'IDX_request_inbox_status_created',
  'IDX_request_inbox_due',
]
  .map((name) => `DROP INDEX IF EXISTS \`${name}\``)
  .join(', ');

const seconds = (since: number): number => (performance.now() - since) / 1000;
const rate = (rows: number, since: number): number => rows / seconds(since);
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const round1 = (value: number): number => Math.round(value * 10) / 10;

async function applySetup(qr: QueryRunner, setup: Setup): Promise<number> {
  const started = performance.now();
  await qr.query(
    `ALTER TABLE \`document_request\` ${DROP_ALL}, ${setup.adds.join(', ')}`,
  );
  return seconds(started);
}

function randomStatus(): string {
  const r = Math.random();
  if (r < 0.25) return 'pending';
  if (r < 0.45) return 'reviewing';
  if (r < 0.6) return 'rejected';
  return 'approved';
}

function randomDueDate(): string | null {
  if (Math.random() >= 0.7) return null;
  const days = 7 + Math.floor(Math.random() * 54);
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function insertRows(qr: QueryRunner, count: number): Promise<void> {
  const values: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const clientId = 1 + Math.floor(Math.random() * CLIENTS);
    const accountantId = ((clientId - 1) % ACCOUNTANTS) + 1;
    values.push('Bench write', randomStatus(), clientId, accountantId, randomDueDate());
  }
  const placeholders = new Array<string>(count).fill('(?, ?, ?, ?, ?, NOW(6), NOW(6))').join(',');
  await qr.query(
    `INSERT INTO \`document_request\`
       (\`title\`, \`status\`, \`clientId\`, \`accountantId\`, \`dueDate\`, \`createdAt\`, \`updatedAt\`)
     VALUES ${placeholders}`,
    values,
  );
}

async function oneRound(qr: QueryRunner): Promise<{ bulk: number; single: number; update: number }> {
  const [{ maxId }] = (await qr.query(
    'SELECT COALESCE(MAX(id), 0) AS maxId FROM document_request',
  )) as [{ maxId: string | number }];
  const firstId = Number(maxId);

  // Bulk inserts: batches of BULK_BATCH rows, one transaction per batch.
  let started = performance.now();
  for (let done = 0; done < BULK_ROWS; done += BULK_BATCH) {
    await qr.startTransaction();
    await insertRows(qr, BULK_BATCH);
    await qr.commitTransaction();
  }
  const bulk = rate(BULK_ROWS, started);

  // Single inserts: one statement, one commit each (what the create endpoint does).
  started = performance.now();
  for (let i = 0; i < SINGLE_ROWS; i++) await insertRows(qr, 1);
  const single = rate(SINGLE_ROWS, started);

  // Status updates, one at a time (what a review or an upload does).
  const ids = (await qr.query(
    'SELECT id FROM document_request WHERE id > ? ORDER BY id LIMIT ?',
    [firstId, UPDATE_ROWS],
  )) as Array<{ id: number }>;
  started = performance.now();
  for (const { id } of ids) {
    await qr.query(
      `UPDATE document_request SET status = 'approved', version = version + 1, updatedAt = NOW(6) WHERE id = ?`,
      [id],
    );
  }
  const update = rate(ids.length, started);

  await qr.query('DELETE FROM document_request WHERE id > ?', [firstId]);
  return { bulk, single, update };
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  const results: Array<Record<string, string | number>> = [];
  const order = process.argv.includes('--reverse') ? [...SETUPS].reverse() : SETUPS;
  try {
    for (const setup of order) {
      console.log(`\nSwitching to: ${setup.name}`);
      const buildSeconds = await applySetup(qr, setup);
      console.log(`  index build: ${buildSeconds.toFixed(1)} s`);

      const bulk: number[] = [];
      const single: number[] = [];
      const update: number[] = [];
      for (let round = 1; round <= ROUNDS; round++) {
        const result = await oneRound(qr);
        bulk.push(result.bulk);
        single.push(result.single);
        update.push(result.update);
        console.log(
          `  round ${round}: bulk ${Math.round(result.bulk)}/s, single ${Math.round(result.single)}/s, updates ${Math.round(result.update)}/s`,
        );
      }
      results.push({
        setup: setup.name,
        'index build (s)': round1(buildSeconds),
        'bulk insert (rows/s)': Math.round(median(bulk)),
        'single insert (rows/s)': Math.round(median(single)),
        'status update (rows/s)': Math.round(median(update)),
      });
    }
  } finally {
    // Always leave the final design in place.
    await applySetup(qr, SETUPS[SETUPS.length - 1]);
    await qr.release();
    await AppDataSource.destroy();
  }

  console.log('\nMedian of three rounds:');
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});