# bench

Reproduces the measurements in `docs/PERFORMANCE.md`.

## Install k6 (once)

    winget install k6 --source winget

Open a new terminal and check with `k6 version`.

## Prepare

1. `docker compose up -d`, then `npm run migration:run`.
2. `npm run seed:large -- --reset` (about a minute), then in the SQL shell:
   `ANALYZE TABLE document_request, document_request_event, client, accountant;`
3. In `.env` set `DB_LOGGING=false` (query logging distorts the numbers).
4. Run the app in production mode, in its own terminal: `npm run build`, then `npm run start:prod`.

## Load tests (20 users, 10 s warm-up, 60 s measured)

    k6 run -e REQUEST_PATH="/requests?accountantId={accountant}&limit=20" bench/inbox.k6.js
    k6 run -e REQUEST_PATH="/requests?accountantId={accountant}&status=rejected&limit=20" bench/inbox.k6.js
    k6 run -e REQUEST_PATH="/requests?accountantId={accountant}&sort=dueDate_asc&limit=20" bench/inbox.k6.js
    k6 run -e REQUEST_PATH="/accountants/{accountant}/dashboard" bench/inbox.k6.js

Read the lines for `{ scenario:measured }`: `http_req_duration` (med is p50, then p(95), p(99)), `http_reqs` (count and rate per second) and `http_req_failed` (error rate).

For the live dashboard set `DASHBOARD_CACHE_TTL_MS=0` in `.env`. Run each test twice and keep the second run (the first one is cold).

## Switch the inbox indexes (PowerShell, from the project root)

    Get-Content bench\drop-inbox-indexes.sql | docker exec -i mariadb_db mariadb -u <user> -p<password> <database>
    Get-Content bench\restore-inbox-indexes.sql | docker exec -i mariadb_db mariadb -u <user> -p<password> <database>

`drop-inbox-indexes.sql` is the naive setup: it drops all the inbox indexes and the dashboard index (and the foreign key on `accountantId`, which needs one of them). `restore-inbox-indexes.sql` rebuilds the final design: the three inbox indexes, the dashboard index, then the foreign key.

## Write cost of the indexes

Stop the app, then:

    npm run bench:write-cost
    npm run bench:write-cost -- --reverse

## MariaDB's slow query log (needs a user with the SUPER privilege, for example root)

    docker exec mariadb_db mariadb -u root -p<root password> -e "SET GLOBAL slow_query_log = 1; SET GLOBAL long_query_time = 0.1; SHOW VARIABLES LIKE 'slow_query_log_file';"
    docker exec mariadb_db tail -n 60 /var/lib/mysql/<the file name printed above>

## Bulk create of 500 clients (timed calls)

    $body = @{ title = "Bench bulk"; clientIds = 1..500 } | ConvertTo-Json
    1..3 | ForEach-Object { (Measure-Command { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/requests/bulk" -Headers @{ "X-Actor-Id" = "1"; "Idempotency-Key" = [guid]::NewGuid().ToString() } -ContentType "application/json" -Body $body | Out-Null }).TotalMilliseconds }

Set `BULK_INSERT_MODE=loop` and restart the app to time one statement per row. Clean up afterwards:

    DELETE FROM document_request_event WHERE requestId IN (SELECT id FROM document_request WHERE title = 'Bench bulk');
    DELETE FROM document_request WHERE title = 'Bench bulk';
    DELETE FROM bulk_batch;

## Buffer pool experiment

Compare `command: --innodb-buffer-pool-size=1G` in `compose.yaml` (`docker compose up -d` to apply, data is kept) against the default 128 MB, with `SHOW VARIABLES LIKE 'innodb_buffer_pool_size';` to check, and the live dashboard load test above.