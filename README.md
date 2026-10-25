# Requests Portal

NestJS + TypeORM + MariaDB 11. Accountants ask clients for documents: requests with a safe review workflow (versioned, with an event history), an inbox with keyset pagination, a dashboard, and bulk create. Built to stay fast at 1,000,000 requests: see [docs/DESIGN.md](docs/DESIGN.md) and [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Run it on a clean machine

Needs Node.js 24 or newer and Docker.

```bash
cp .env.example .env        # Windows: copy .env.example .env
docker compose up -d        # MariaDB 11
npm ci
npm run migration:run       # creates the schema (synchronize is off)
npm run start:dev           # http://localhost:3000
```

Optional data:

```bash
npm run seed                       # small demo data
npm run seed:large -- --reset      # 200 accountants, 20,000 clients, 1,000,000 requests (about a minute)
```

## Checks

```bash
npm run lint:ci
npm test                    # unit tests
npm run build
npm run test:int            # integration tests, need the database up and migrated, app stopped
```

CI (GitHub Actions) runs lint, unit tests, build and `npm audit --omit=dev`, then the integration tests against a MariaDB service container, with the migrations run from an empty database. The integration tests cover the parallel review race, a re-upload during a review (409), the upload flow, single and bulk create, inbox paging with tied timestamps, the review turnaround and the response envelope.

## API

The actor is identified by the `X-Actor-Id` header. This is identification, not authentication (see [docs/DESIGN.md](docs/DESIGN.md), section 4). Successful responses are `{ success: true, data, timestamp }`, errors are `{ success: false, message, statusCode, timestamp }`.

| Endpoint | What it does |
| --- | --- |
| `POST /requests` | Create a request for a client (`clientId`, `title` up to 255 characters, optional `description`). Header `X-Actor-Id`: an accountant. The request and its first history event are written in one transaction.|
|`GET /requests?accountantId=...` | Inbox. Filters: `clientId`, `status` (repeatable), `createdFrom`, `createdTo`, `overdue=true`. `sort=createdAt_desc` or `dueDate_asc`, `limit` up to 100, `cursor` for the next page. No total count. |
| `GET /requests/:id` | One request |
| `PATCH /requests/review/:id` | Approve or reject (`status`, `rejectionReason`, required when rejecting, 1 to 255 characters after trimming, `version` the reviewer saw). Header `X-Actor-Id`: an accountant. 409 if the request changed meanwhile. |
| `POST /requests/upload/:id` | Upload a document (multipart: `file`, and `version`). Header `X-Actor-Id`: the client of the request. |
| `GET /requests/:id/history` | The events of a request, oldest first |
| `POST /requests/bulk` | The same request for up to 500 clients, all or nothing. Headers `X-Actor-Id` (an accountant) and `Idempotency-Key` (a retry returns the first answer). |
| `GET /accountants/:id/dashboard` | Counts per status, overdue, average review turnaround (30 days), top 10 clients by open requests |

Input that is empty or too long is rejected with 400, never 500.

POST routes return 201, the NestJS default.

## Configuration

Copy `.env.example` to `.env` and set the database values. Optional:

| Variable | Meaning |
| --- | --- |
| `DB_LOGGING` | `true` prints every SQL statement (leave it off when measuring) |
| `DASHBOARD_CACHE_TTL_MS` | Dashboard cache lifetime, default 30000. `0` switches it off, so the numbers are live. |
| `BULK_INSERT_MODE` | `loop` inserts one row per statement. Only used to measure against the default multi-row insert. |

The compose file starts MariaDB with a 1 GB InnoDB buffer pool (`--innodb-buffer-pool-size=1G`, default is 128 MB). [docs/PERFORMANCE.md](docs/PERFORMANCE.md) shows what it does for the dashboard. Lower it if your machine has little memory.

## Documents

- [docs/DESIGN.md](docs/DESIGN.md): the schema, the indexes and why, the concurrency design, the trade-offs, the migrations.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): the measurements. [bench/README.md](bench/README.md) has the commands to repeat them.
- [AI_NOTES.md](AI_NOTES.md): where AI was used and where it was wrong.

## Known limitations

- The actor header is not authentication. Production would use JWT with role guards.
- The read endpoints (inbox, history, dashboard) take any accountantId and are not access-controlled. Production would use JWT with an owner check.
- Uploaded files are kept on local disk, there is no endpoint to download them, and the MIME type is checked from what the client declares.
- The database keeps one file per request.
- Files replaced by a re-upload are not yet deleted from disk.
- The dashboard cache lives in one process, and its numbers can be up to 30 seconds old.
- The inbox has no page numbers and no total count (keyset pagination).
- Not built (stretch): several documents per request, a PostgreSQL comparison, a Next.js page.
- `POST /requests` is not idempotent: a double click or a retry creates a duplicate request. Bulk create has an idempotency key for that reason.
