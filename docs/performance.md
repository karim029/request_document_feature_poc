# Performance report

> The formatting and wording of this report were done with AI help (see `AI_NOTES.md`). Every number comes from my own runs (k6, `EXPLAIN`, `ANALYZE`, the SQL shell), and I checked them against my terminal output. To reproduce them: `bench/README.md`.

## Summary and conclusions

- I measured a dataset of 1,000,000 requests with 20 concurrent users (k6).
- My first inbox indexes were wrong for two queries: `status` sat in the middle of the index, which breaks date order when a query has no status filter, so the database sorted thousands of rows. I proved it with `EXPLAIN` and `ANALYZE` and fixed it one index at a time: default view p95 **1.24 s to 31 ms**, one status **371 ms to 37 ms**, due date sort **1.49 s to 40 ms**.
- The dashboard misses its 300 ms target live (p95 2.56 s) and meets it with a 30 second cache (p95 3 ms), at the price of numbers up to 30 seconds old.
- Raising the buffer pool from 128 MB to 1 GB made the live dashboard 17 times faster (p95 3.18 s to 186 ms). I had predicted it would help only a little.
- The indexes cost almost nothing on writes and 14 MB of disk. Bulk create of 500 clients takes 122 ms.
- My parallel integration test found a real bug in the review (losers of a race got 400 instead of 409 under REPEATABLE READ). It is fixed with READ COMMITTED (`docs/DESIGN.md` section 6).
- Twice I did not trust a result and rechecked it before reporting it (section 3). One prediction of mine was wrong, and I say so.
- One experiment did not help: a bigger connection pool (section 7).
- What is not measured yet is in section 6.

## 1. Setup

Intel Core i5-1145G7 (4 cores, 8 threads), 15.7 GB RAM, SSD, Windows 11. Docker with 8 CPUs, MariaDB 11.8.9, `innodb_buffer_pool_size` 128 MB (the default) for every measurement except the buffer pool experiment in section 2, which used 1 GB. The repository's `compose.yaml` now sets 1 GB. Production build, query logging off for every load test. k6: 20 virtual users, 10 s warm-up not recorded, 60 s measured, a random accountant (1 to 200) on every request. The app, the database and k6 share one laptop, so absolute numbers are pessimistic; the comparisons are what count. Run-to-run variation is about 10%.

Dataset (`npm run seed:large`, 58.7 s, and 66 s again on a clean clone from an empty database): 200 accountants, 20,000 clients, **1,000,000 requests** (a few clients with thousands, timestamps shared by pairs to create ties) and **2,300,000 events**. About 460 MB of data and indexes against a 128 MB buffer pool.

## 2. Changes and results

| # | Change | Before | After | Cost |
| --- | --- | --- | --- | --- |
| 1 | Inbox index `(accountantId, status, createdAt)` replaced by `(accountantId, createdAt, id)` | default view p95 1.24 s | p95 31 ms, 21 rows read, no sort | none extra (a replacement) |
| 2 | Added `(accountantId, status, createdAt, id)` for one status | `status=rejected` p95 371 ms | p95 37 ms | one more index (+14 MB); it moves on every status change |
| 3 | Due date index `(accountantId, status, dueDate)` replaced by `(accountantId, dueDate, id)` | `sort=dueDate_asc` p95 1.49 s | p95 40 ms | none extra (a replacement) |
| 4 | 30 second cache on the dashboard | p95 2.56 s | p95 3.15 ms | numbers up to 30 s old; a cache miss still takes about 3 s |
| 5 | Bulk create: multi-row inserts instead of one statement per row | 488 ms for 500 requests | 122 ms | none |
| 6 | Buffer pool from 128 MB to 1 GB (`--innodb-buffer-pool-size=1G`) | live dashboard p95 3.18 s, 7 requests/s | p95 186 ms, 119 requests/s | about 900 MB more memory; the uncached dashboard now meets its target |

**The pattern.** An index serves a query when its columns follow the query: first the columns filtered by equality, then the `ORDER BY` columns. A column in the middle that the query does not filter on breaks the order, and the database has to sort.

## 3. How I found it

- With the original index the inbox took 4 ms in the shell (1.2 s with no index at all), but the plan still showed `Using filesort`: 8,790 rows sorted to return 21, and the sort was 96% of the query's time.
- Under 20 users it was far worse (p95 1.24 s) although one request alone took about 20 ms. The disk was at 99% and the buffer pool counters showed about 11,000 page requests per HTTP request.
- `ANALYZE FORMAT=JSON` gave the cause: for many accountants the optimizer chose an index without `createdAt`, so it fetched every one of the accountant's rows from the table just to sort them: **13,833 pages against 91** with the other index. A single warm query hides this (15.8 ms against 10 ms).
- The due date sort had a different cause: 98% of its time was the sort itself (3,150 rows).
- **A result I did not trust:** the first write-cost run showed one setup 2.6 times slower on single inserts. That contradicted the mechanism, so I reran it in the opposite order and it did not reproduce. The cause is probably the database still flushing freshly built index pages (a hypothesis, not proven).
- **A result I did not trust:** my first cached dashboard run matched the baseline. The fastest request was still 1.58 s, which a working cache cannot produce. The cache had been switched off by a mistake in `.env`.
- **A prediction I got wrong:** I expected the overdue filter to be slow (341 rows read to find 21). Under load it was fine (p95 50 ms). I also predicted a larger buffer pool would help the live dashboard only a little; it made it 17 times faster.

## 4. Under load (20 users)

| Endpoint | Setup | p50 | p95 | p99 | Requests/s |
| --- | --- | --- | --- | --- | --- |
| Inbox, first page | no inbox indexes | 3.05 s | 3.87 s | 5.02 s | 5.3 |
| Inbox, first page | original design (two runs) | 1.16 to 1.20 s | 1.24 to 1.40 s | 1.56 to 1.61 s | 15.6 to 16.3 |
| Inbox, first page | `(accountantId, createdAt, id)` | 17.2 ms | 31.2 ms | 39.5 ms | 872 |
| Inbox, `status=rejected` | without / with the status index | 260.5 / 26.7 ms | 370.6 / 37.1 ms | 414.8 / 46.2 ms | 63 / 657 |
| Inbox, two statuses | final indexes | 22.6 ms | 36.9 ms | 52.8 ms | 684 |
| Inbox, `overdue=true` | final indexes | 26.2 ms | 45.3 ms | 73.5 ms | 577 |
| Inbox, `sort=dueDate_asc` | original / new due index | 111.7 / 27.0 ms | 1.49 s / 40.5 ms | 2.13 s / 54.5 ms | 46 / 655 |
| Dashboard | live / 30 second cache | 1.89 s / 2 ms | 2.56 s / 3.15 ms | 3.13 s / 5.0 ms | 8.6 / 3,095 |
| Dashboard, live (cache off) | 128 MB / 1 GB buffer pool, same session | 2.28 s / 139 ms | 3.18 s / 186 ms | 3.67 s / 219 ms | 7.1 / 119 |

All runs had 0% errors. The targets (inbox p95 under 100 ms, dashboard p95 under 300 ms) are met. The cached dashboard is almost all cache hits (about 99.8%); the slowest request (3.26 s) is a miss, so the cache hides the slow queries instead of removing them. With the 1 GB buffer pool the uncached dashboard also meets its target (p95 186 ms), so a cache miss costs about 0.2 s instead of about 3 s. MariaDB's slow query log named them: top clients (0.31 to 0.76 s) and the overdue count (0.36 to 0.39 s) under load, against 9 to 14 ms alone.

**Bulk create of 500 clients** (one user, timed calls, target under 2 s): 122 ms with multi-row inserts (median of 8 warm calls, range 116 to 136 ms, 778 ms on the first cold call) against 488 ms with one statement per row (median of 9 calls). Everything runs in one transaction.

## 5. Plans

| Query | `type` | `key` | rows read | `Extra` |
| --- | --- | --- | --- | --- |
| Default view, original index | ref | `IDX_request_inbox_created` (status first) | 8,790 sorted | Using filesort |
| Default view, new index | range | `IDX_request_inbox_created` | 21 | no sort |
| One status, new index | ref | `IDX_request_inbox_status_created` | 21 (97 without it) | no sort |
| Due date sort, new index | range | `IDX_request_inbox_due` | 21 (3,150 sorted before) | no sort |

## 6. Cost of the indexes, and what is not done

Write cost (`bench/write-cost.ts`, run in both orders): bulk inserts 8,716 rows/s with the three inbox indexes against 9,026 with one (3 to 8%, within the noise). Single inserts and status updates ran at about 1 ms each in every setup, so the number of indexes made no measurable difference. Building the indexes takes 3 to 6 seconds. Disk: the table's indexes grew from 98.2 MB to 111.7 MB.

Not done:
- The history and the review (conditional update) have not been load tested, and the history plan was only checked on a small table.
- Offset against keyset pagination was not measured. Keyset is the design; paging through 57 requests that share five timestamps, at three page sizes, is covered by an integration test (no duplicates, no gaps).
- Everything ran on one machine, with one dataset.

## 7. A dead end: a bigger connection pool

I expected more connections to help the live dashboard: each call runs four queries, and the default pool has 10 connections, so 20 users put about 80 queries at once on 10 connections. With the 1 GB buffer pool in place, I raised the pool to 40 and repeated the live dashboard test.

| Connection pool | p50 | p95 | p99 | Requests/s |
| --- | --- | --- | --- | --- |
| 10 (default) | 139 ms | 186 ms | 219 ms | 119 |
| 40 | 142 ms | 252 ms | 318 ms | 114 |

It did not help: throughput is the same (within the noise) and the tail is slower. The queries were already limited by CPU and by the rows they read, not by waiting for a connection. With more connections, more queries run at once and compete for the same CPU, so each takes longer. I went back to the default of 10, and the experiment was not committed.

## 8. At 100M requests

Partition the event table by month and archive old partitions (partitioned MariaDB tables cannot have foreign keys, so integrity would move into the application). Archive old closed requests, and review which indexes earn their write cost because they would no longer fit in memory. Use a rollup table instead of the cache for the dashboard if requests per accountant grow, and a read replica for reads. At ten times the data (about 4.6 GB of data and indexes) a 1 GB buffer pool would again be too small, so memory sizing and covering indexes for the dashboard's two heavy queries come first.