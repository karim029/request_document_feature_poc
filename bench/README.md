# bench

Reproduces the measurements in `docs/PERFORMANCE.md`.

## Install k6 (once)

    winget install k6 --source winget

Open a new terminal and check with `k6 version`.

## Prepare

1. Start the database: `docker compose up -d`, then `npm run migration:run`.
2. Create the dataset: `npm run seed:large -- --reset` (about one minute), then in the SQL shell:
   `ANALYZE TABLE document_request, document_request_event, client, accountant;`
3. In `.env` set `DB_LOGGING=false` (query logging distorts the numbers).
4. Run the app in production mode, in its own terminal:
   `npm run build` then `npm run start:prod`.

## Run a measurement

    k6 run -e REQUEST_PATH="/requests?accountantId={accountant}&limit=20" bench/inbox.k6.js

Read the lines for `{ scenario:measured }`: `http_req_duration` (avg, med, p(90), p(95), p(99), max),
`http_reqs` (count and rate per second) and `http_req_failed` (error rate).

## Switch the database between setups

PowerShell, from the project root (use the user, password and database from your `.env`):

    Get-Content bench\drop-inbox-indexes.sql | docker exec -i mariadb_db mariadb -u <user> -p<password> <database>
    Get-Content bench\restore-inbox-indexes.sql | docker exec -i mariadb_db mariadb -u <user> -p<password> <database>

- `drop-inbox-indexes.sql`: the naive setup (no inbox indexes).
- `restore-inbox-indexes.sql`: the designed setup.
