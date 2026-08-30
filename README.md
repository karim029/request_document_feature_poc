# Requests Portal (Document Request Feature) POC

Accountants on the mazeed ops currently request documents from clients
informally, via WhatsApp. This feature replaces that with a structured,
trackable workflow: an accountant creates a document request tied to a
specific client, the client submits the document through mazeed ops ,
and the accountant reviews it, approving or rejecting with a reason.

## Tech Stack
- Backend: NestJS + TypeScript
- Database: MySQL (via TypeORM)
- File storage: local disk (see Limitations)
- Containerization: Docker (MySQL only)

## Architecture Overview
The core feature lives in `RequestsModule`, following the standard
Controller → Service → Repository pattern. Three entities model the
domain:
- **Accountant** — has many Clients
- **Client** — belongs to one Accountant, has many Requests
- **DocumentRequest** — belongs to one Client, tracks status
  (`pending` → `reviewing` → `approved`/`rejected`), an optional
  rejection reason, and the path to the submitted file.

Validation is handled via DTOs (`class-validator`), errors via custom
exception filters, and all successful responses are wrapped in a
consistent shape via a global interceptor.

## Local Setup
1. Clone the repo
2. Create a `.env` file with:

DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=<your value>
DB_PASSWORD=<your value>
DB_DATABASE=<your value>

3. Start the database: `docker-compose up -d`
4. Install dependencies: `npm install`
5. Run the app: `npm run start:dev`
6. (Optional) Seed demo data: `npm run seed`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/requests` | Returns all document requests |
| GET | `/requests/:id` | Returns a single request by id (404 if not found) |
| POST | `/requests` | Creates a new request (`title`, `clientId`, optional `description`) |
| POST | `/requests/:id/upload` | Client submits a document (`multipart/form-data`, field `file`); auto-transitions status to `reviewing` |
| PATCH | `/requests/review/:id` | Accountant approves/rejects a request currently `reviewing` (`status`, optional `rejectionReason`) |

## Known Limitations
This is a proof-of-concept, scoped deliberately to demonstrate the
core workflow rather than production-readiness:
- No authentication/user management — Accountants and Clients are
  treated as existing platform users and were seeded directly.
- One document per request only — no support for batching multiple
  documents into a single request.
- No rejection history — only the most recent rejection reason is
  stored, not a full audit trail.
- No delete endpoint — document requests are treated as a permanent
  record, not something to be removed.
- Files are stored on local disk, not cloud storage (e.g. S3).
- The seed script is not idempotent — running it multiple times will
  create duplicate demo records. Run once on a fresh database.

## Testing
A Postman collection with all endpoints (including descriptions and
example bodies) is available in `/postman`.