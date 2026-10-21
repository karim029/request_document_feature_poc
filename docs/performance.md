# Performance report

> The formatting and wording of this report were done with AI help (see `AI_NOTES.md`). Every number comes from my own runs (k6, `EXPLAIN`, `ANALYZE` and the SQL shell) on the machine described below, and I checked them against my terminal output.

## Summary

I built a dataset of 1,000,000 requests and measured the inbox, the dashboard and the write cost with 20 concurrent users.

- My first inbox indexes were wrong for two queries. For the default view and the due date sort, the index had `status` in the middle, which breaks date order when the query has no status filter, so the database had to gather and sort thousands of rows. I proved it with `EXPLAIN` and `ANALYZE` and fixed it one index at a time: default view p95 **1.24 s to 31 ms**, a single status **371 ms to 37 ms**, due date sort **1.49 s to 40 ms**.
- The dashboard missed its 300 ms target when computed live (p95 2.56 s) and meets it with a 30 second cache (p95 3 ms), at the price of numbers up to 30 seconds old.
- The indexes cost almost nothing on writes (3 to 8% on bulk inserts, within the noise) and 14 MB of disk.
- Twice I did not trust a result and checked it before reporting it (section 3). Once a prediction of mine was wrong, and I say so.
- What I have not measured yet is listed in section 6.

To reproduce any number: `bench/README.md`.

## 1. Setup

| Item | Value |
| --- | --- |
| Machine | Intel Core i5-1145G7 (4 cores, 8 threads), 15.7 GB RAM, SK hynix 256 GB SSD, Windows 11 |
| Docker | 8 CPUs, 7.6 GiB. MariaDB 11.8.9, `innodb_buffer_pool_size` 128 MB (default, not changed) |
| App | production build (`npm run start:prod`), query logging off for every load test, Node.js 26 |
| Load tool | k6: 20 virtual users, 10 s warm-up (not recorded), 60 s measured, a random accountant (1 to 200) on every request |

The app, the database and k6 share one laptop, so absolute numbers are pessimistic. The before and after comparisons are what count.

Dataset (`npm run seed:large`, 58.7 s, deterministic): 200 accountants, 20,000 clients, **1,000,000 requests** (40% approved, 25% pending, 20% reviewing, 15% rejected, a few clients with thousands of requests, timestamps shared by pairs to create ties) and **2,300,000 events**. Data and indexes total about 460 MB against a 128 MB buffer pool, so some reads come from disk.

## 2. How I measured

- `ANALYZE TABLE` after the load. Every measurement repeated, and the first (cold) run not used.
- At the database: `EXPLAIN`, `ANALYZE` and `ANALYZE FORMAT=JSON` on the real SQL, MariaDB's slow query log (`long_query_time = 0.1`), TypeORM's `maxQueryExecutionTime`, and the buffer pool counters (the change during a test).
- Under load: p50, p95, p99, requests per second and error rate. One change at a time. Run-to-run variation is about 10%, so smaller differences are noise.

## 3. What I found and changed

| # | Change | Before | After | Cost |
| --- | --- | --- | --- | --- |
| 1 | Inbox index `(accountantId, status, createdAt)` replaced by `(accountantId, createdAt, id)` | default view p95 1.24 s | p95 31 ms, 21 rows read, no sort | none extra (a replacement) |
| 2 | Added `(accountantId, status, createdAt, id)` for one status | `status=rejected` p95 371 ms | p95 37 ms | one more index (+14 MB); it moves on every status change |
| 3 | Due date index `(accountantId, status, dueDate)` replaced by `(accountantId, dueDate, id)` | `sort=dueDate_asc` p95 1.49 s | p95 40 ms | none extra (a replacement) |
| 4 | 30 second cache on the dashboard (`DASHBOARD_CACHE_TTL_MS`) | p95 2.56 s | p95 3.15 ms | numbers up to 30 s old; a cache miss still takes about 3 s |
| 5 | Bulk insert in batches instead of one row at a time | 908 rows/s | 8,716 rows/s | measured on the table, not yet on the endpoint |

**The pattern.** An index serves a query when its columns follow the query: first the columns filtered by equality, then the `ORDER BY` columns. A column in the middle that the query does not filter on breaks the order, and the database has to sort.

**How I found it.**
- With the original index the inbox took 4 ms in the shell (against 1.2 s with no index), but the plan still showed `Using filesort`: 8,790 rows sorted to return 21, and the sort was 96% of the query's time (`ANALYZE`).
- Under 20 users it was far worse: p95 1.24 s, although one request alone took about 20 ms. The disk was at 99% (546 MB/s) and the buffer pool counters showed about 11,000 page requests per HTTP request.
- `ANALYZE FORMAT=JSON` gave the cause: for many accountants the optimizer chose an index without `createdAt`, so it fetched every one of the accountant's rows from the table just to sort: **13,833 pages against 91** with the other index. 4,579 rows times about 3 pages per lookup matches. A single warm query hides this (15.8 ms against 10 ms).
- The due date sort was a different cause: 98% of its time was the sort itself (3,150 rows), with few pages touched.

**Two results I did not trust, and what I did.**
- The first write-cost run showed the final design 2.6 times slower on single inserts (333 against about 900 per second). That contradicted the mechanism (two to three indexes cannot cost 60%), so I reran it in the opposite order. It did not reproduce (908). My explanation, a hypothesis and not proven, is that the database was still flushing the freshly built index pages.
- My first cached dashboard run matched the baseline (p95 2.53 s). The fastest request was still 1.58 s, which a working cache cannot produce. The cache was switched off by a mistake in `.env`. After fixing it: p95 3.15 ms.

**A prediction I got wrong.** I expected the overdue filter to be slow (341 rows read to find 21). Under load it was fine (p95 50 ms).

## 4. Results under load (20 users)

| Endpoint | Setup | p50 | p95 | p99 | Requests/s | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| Inbox, first page | no inbox indexes | 3.05 s | 3.87 s | 5.02 s | 5.3 | 0% |
| Inbox, first page | original design (two runs) | 1.16 to 1.20 s | 1.24 to 1.40 s | 1.56 to 1.61 s | 15.6 to 16.3 | 0% |
| Inbox, first page | `(accountantId, createdAt, id)` | 17.2 ms | 31.2 ms | 39.5 ms | 872 | 0% |
| Inbox, `status=rejected` | without the status index | 260.5 ms | 370.6 ms | 414.8 ms | 63.3 | 0% |
| Inbox, `status=rejected` | with it | 26.7 ms | 37.1 ms | 46.2 ms | 657 | 0% |
| Inbox, two statuses | final indexes | 22.6 ms | 36.9 ms | 52.8 ms | 684 | 0% |
| Inbox, `overdue=true` | final indexes | 26.2 ms | 45.3 ms | 73.5 ms | 577 | 0% |
| Inbox, `sort=dueDate_asc` | original due index | 111.7 ms | 1.49 s | 2.13 s | 45.8 | 0% |
| Inbox, `sort=dueDate_asc` | `(accountantId, dueDate, id)` | 27.0 ms | 40.5 ms | 54.5 ms | 655 | 0% |
| Dashboard | live, four queries per call | 1.89 s | 2.56 s | 3.13 s | 8.6 | 0% |
| Dashboard | 30 second cache | 2 ms | 3.15 ms | 5.0 ms | 3,095 | 0% |

The targets (inbox p95 under 100 ms, dashboard p95 under 300 ms) are met. The cached dashboard is almost all cache hits (about 99.8% in the run); the slowest request (3.26 s) is a miss. The cache hides the slow queries, it does not remove them. The slow query log named them: top clients (0.31 to 0.76 s) and the overdue count (0.36 to 0.39 s) under load, against 9 to 14 ms alone.

### Plans (`EXPLAIN` and `ANALYZE`)

| Query | `type` | `key` | rows read | `Extra` |
| --- | --- | --- | --- | --- |
| Default view, original index | ref | `IDX_request_inbox_created` (status first) | 8,790 sorted | Using where; Using filesort |
| Default view, no index | ALL | NULL | 988,875 (estimate) | Using where; Using filesort |
| Default view, new index | range | `IDX_request_inbox_created` | 21 | Using where |
| One status, new index | ref | `IDX_request_inbox_status_created` (`key_len` 5) | 21 (against 97 without it) | Using where |
| Due date sort, new index | range | `IDX_request_inbox_due` (`key_len` 8) | 21 (against 3,150 sorted) | Using index condition |
| History of one request | ref | `IDX_event_request_history` | 3 | Using where, no filesort |

## 5. Cost of the indexes

`bench/write-cost.ts`, three rounds per setup, run in both orders. Bulk inserts: 8,716 rows/s with the three inbox indexes against 9,026 with one (3 to 8% slower, within the noise). Single inserts and status updates: about 860 to 930 per second in every setup (about 1.1 ms each, which is the commit to disk, not index maintenance). Building the indexes on 1,000,000 rows takes 3 to 6 seconds. Disk: the indexes of `document_request` grew from 98.2 MB to 111.7 MB. The cost would grow with many concurrent writers and a larger table.

## 6. Not done yet, and limits

- Not measured under load yet: the history, the review (conditional update) and bulk create of 500 (target under 2 s). The history `EXPLAIN` above is from a small table and has not been repeated on the 2,300,000 events.
- Offset against keyset pagination was not measured (keyset is the design).
- No dead end reported yet (candidates: the buffer pool size, the connection pool size).
- Everything ran on one machine, with one dataset.

## 7. At 100M requests

- Partition the event table by month and archive old partitions (partitioned MariaDB tables cannot have foreign keys, so integrity would move into the application).
- Archive old closed requests; review which indexes earn their write cost, because they would no longer fit in memory.
- Replace the dashboard cache with a rollup table if requests per accountant grow, and add a read replica for the dashboard and the history.