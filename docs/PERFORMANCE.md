# Performance report

> The formatting and wording of this report were done with AI help (see `AI_NOTES.md`). Every number comes from my own runs (k6, `EXPLAIN`, `ANALYZE` and the SQL shell), and I checked them against my terminal output. To repeat any of them: `bench/README.md`.

## Summary

- I tested with 1,000,000 requests and 20 users at the same time (k6).
- My first inbox indexes were wrong for two queries. The index had `status` in the middle, so a query without a status filter could not read rows in date order, and the database had to sort thousands of rows. I found it with `EXPLAIN` and `ANALYZE` and fixed it one index at a time: default view p95 **1.24 s to 31 ms**, one status **371 ms to 37 ms**, due date sort **1.49 s to 40 ms**.
- The dashboard was too slow when computed live (p95 2.56 s, target 300 ms). Three changes helped: a 30 second cache (p95 3 ms), more memory for the database (live p95 186 ms), and an index that holds the columns its two heaviest queries need (live p95 about 140 to 150 ms: 139 ms after the index, and 148 ms after the review turnaround query was corrected, which is within the run-to-run noise).
- The indexes cost very little on writes (3 to 8% on bulk inserts, within the noise) and about 14 MB of disk (measured for the three inbox indexes; the dashboard index was not re-measured).
- My parallel integration test found a real bug in the review code (some losers of a race got 400 instead of 409). It is fixed.
- Twice I did not trust a result and repeated it before reporting it. Three of my predictions were wrong, and I say so.
- What I did not do is in section 8.

## 1. Setup

Intel Core i5-1145G7 (4 cores, 8 threads), 15.7 GB RAM, SSD, Windows 11. Docker with 8 CPUs, MariaDB 11.8.9. The database memory cache (`innodb_buffer_pool_size`) was the default 128 MB for every measurement except the experiment in change 6, change 7 and the connection pool experiment (section 7), which used 1 GB; `compose.yaml` now sets 1 GB. The app ran as a production build with query logging off (TypeORM's warning for any query slower than 100 ms stays on, so a slow query still prints one line).

k6: 20 virtual users, a 10 second warm-up that is not counted, then 60 seconds measured, with a random accountant (1 to 200) on every request. The app, the database and k6 share one laptop, so the absolute numbers are on the slow side. The comparisons between runs are what count. Repeating the same run gives results within about 10% of each other, so smaller differences are noise.

Data (`npm run seed:large`, 58.7 s, and 66 s again on a clean clone from an empty database): 200 accountants, 20,000 clients, **1,000,000 requests** and **2,300,000 events**. A few clients have thousands of requests, and requests share timestamps in pairs to create ties. Together the data and indexes are about 460 MB, bigger than the 128 MB cache, so some reads go to disk.

## 2. What I changed and what happened

| # | Change | Before | After | Cost |
| --- | --- | --- | --- | --- |
| 1 | Inbox index `(accountantId, status, createdAt)` replaced by `(accountantId, createdAt, id)` | default view p95 1.24 s | p95 31 ms | none extra (a replacement) |
| 2 | Added `(accountantId, status, createdAt, id)` for one status | `status=rejected` p95 371 ms | p95 37 ms | one more index (+14 MB) |
| 3 | Due date index `(accountantId, status, dueDate)` replaced by `(accountantId, dueDate, id)` | `sort=dueDate_asc` p95 1.49 s | p95 40 ms | none extra (a replacement) |
| 4 | 30 second cache on the dashboard | p95 2.56 s | p95 3.15 ms | numbers up to 30 s old; a cache miss still costs the full live time |
| 5 | Bulk create with two multi-row inserts instead of one insert per row | 488 ms for 500 requests | 122 ms | none |
| 6 | Database memory cache from 128 MB to 1 GB | live dashboard p95 3.18 s | p95 186 ms | about 900 MB more memory |
| 7 | Index `(accountantId, status, dueDate, clientId)`, and the top clients query counts first and looks up the 10 winners after | live dashboard p95 186 ms; overdue count read 6,281 pages, top clients about 10,200 | p95 139 ms (148 ms after the turnaround query was corrected); 50 pages and about 115 pages | one more index; write cost not measured |

**The idea behind the index changes.** An index helps a query when its columns follow the query: first the columns the query filters on with `=`, then the columns it sorts by. A column in the middle that the query does not use breaks the order, and the database has to sort.

## 3. How I found the problems

- With the original index the inbox took 4 to 6 ms in the shell (about 3.3 ms of server time in ANALYZE; 1.2 s with no index at all), but the plan still showed `Using filesort`, which means the database sorts the rows itself: 8,790 rows sorted to return 21, and the sort was 96% of the query's time.
- With 20 users it was much worse (p95 1.24 s), although one request alone took about 20 ms. The disk was at 99%, and the cache counters showed about 11,000 page reads per request.
- `ANALYZE FORMAT=JSON` showed the cause. For many accountants the database chose an index that did not contain `createdAt`, so it read every one of the accountant's rows from the table just to sort them: **13,833 pages against 91** with the other index. A single quick query hides this (15.8 ms against 10 ms).
- The due date sort had a different cause: 98% of its time was the sort itself.
- The dashboard's two heaviest queries (found with the slow query log) were also page reads: the overdue count read about 2,000 table rows to check the due date, and top clients read them to get the client. The `Using temporary; Using filesort` in the top clients plan looked scary, but the sort took 0.06 ms. The cost was the page reads, which is why change 7 was about reading less from the table.

**Two results I did not trust, and what I did.**
- The first write test showed one setup 2.6 times slower on single inserts. That did not make sense (two to three indexes cannot cost 60%), so I repeated it in the opposite order, and it did not repeat. My guess is that the database was still saving the freshly built indexes to disk, but I have not proven it.
- My first cached dashboard run matched the run without the cache. The fastest request was still 1.58 s, which a working cache cannot give. The cache was switched off by a mistake in `.env`.

**Predictions I got wrong.** I expected the overdue filter on the inbox to be slow (it was not, p95 50 ms before the due date index was replaced, 45 ms after). I expected the bigger memory cache to help the live dashboard only a little (it made it 17 times faster). And I first called the slow inbox "a full table scan"; `EXPLAIN` showed it was not.

## 4. Results with 20 users

p50 is the middle request, p95 means 95 out of 100 requests were faster than this, and p99 means 99 out of 100.

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
| Dashboard, live (cache off) | 128 MB / 1 GB memory cache | 2.28 s / 139 ms | 3.18 s / 186 ms | 3.67 s / 219 ms | 7.1 / 119 |
| Dashboard, live (cache off, 1 GB) | before / after change 7 | 139 / 95 ms | 186 / 139 ms | 219 / 173 ms | 119 / 171 |
| Dashboard, live (cache off, 1 GB) | after the turnaround correction | 106 ms | 148 ms | 189 ms | 154 |

All runs had 0% errors. The targets (inbox p95 under 100 ms, dashboard p95 under 300 ms) are met. The cached dashboard is almost all cache hits (about 99.8%), and the slowest request (3.26 s) was a miss, so the cache hides the slow queries instead of removing them. With the 1 GB cache and change 7, a miss now costs about 0.14 to 0.15 s.

Change 7 improved the live dashboard p95 by 25% and the throughput by 44%. That is less than the page counts suggest (about 90 times fewer pages), because with 1 GB the pages were already in memory. The other dashboard queries still cost time (counting per status reads 4,579 index entries, and the turnaround joins the events table).

After a strict review, the turnaround query was corrected: the first version paired every upload with every decision of the same request, which was wrong for requests with several review cycles. Re-measured after the correction: 148 ms at p95, within the run-to-run noise of the earlier 139 ms. The corrected query does a little more work (it looks up the latest review before each decision).

**Bulk create of 500 clients** (one user, timed calls, target under 2 s): 122 ms with multi-row inserts (median of 8 calls, range 116 to 136 ms; the first call after a restart took 778 ms) against 488 ms with one insert per row (median of 9 calls). Everything runs in one transaction.

## 5. Query plans

Changes 1, 2, 3 and 7 are index changes, so they have plans. Changes 4, 5 and 6 are measured with timings (and, for 6, the cache counters). The inbox plans were checked with `ANALYZE FORMAT=JSON`, the others with the shorter `ANALYZE`, which shows the rows really read, the index used, and any sort or temporary table.

| Query (accountant 31 unless said) | Index used | Rows or pages read | Time | Notes |
| --- | --- | --- | --- | --- |
| Inbox default view, original index (accountant 1) | `IDX_request_inbox_created` (status first) | 8,790 rows sorted | 3.3 ms | `Using filesort` |
| Inbox default view, no index | none | 988,875 rows (estimate) | 1.2 s | full scan and sort |
| Inbox default view, new index | `IDX_request_inbox_created` | 21 rows | 0.2 ms | no sort |
| One status, new index | `IDX_request_inbox_status_created` | 21 rows (97 without it) | | no sort |
| Due date sort, new index | `IDX_request_inbox_due` | 21 rows (3,150 sorted before) | | no sort |
| Overdue count, before change 7 | `IDX_request_inbox_status_created` | 2,079 table rows, 6,281 pages | 6.6 ms | reads the table to check the due date |
| Overdue count, after | `IDX_request_dashboard` | 1,272 index entries, 50 pages | 0.7 ms | from the index alone |
| Top 10 clients, before change 7 | `IDX_request_inbox_status_created` | about 10,200 pages | 14.1 ms | `Using temporary; Using filesort` (the sort: 0.06 ms) |
| Top 10 clients, after | `IDX_request_dashboard` | about 115 pages | 1.0 ms | index only, then 10 client lookups |
| Counts per status | `IDX_request_inbox_status_created` | 4,579 index entries | | from the index alone |
| Review turnaround, each decision paired with the latest review before it (`ANALYZE FORMAT=JSON`, 1 GB cache, warm) | `IDX_request_inbox_due` for the requests, `IDX_event_request_history` for the decisions and for the review subquery | 4,579 requests (56 pages); 676 events read for 169 decisions in the last 30 days (15,776 pages); 338 review events in the subquery (1,522 pages) | 8.6 ms | no sort or temporary table; the first version, which joined every review to every decision, read 507 review events (2,029 pages) in 8.3 ms, so the correction costs nothing measurable |
| History of one request, at 2,300,000 events | `IDX_event_request_history` | 2 rows | | no sort |

### Queries per request

Counted from TypeORM's query log, one call each (the transaction lines are not counted).

| Endpoint | Statements |
| --- | --- |
| Inbox, first page | 1 (the client is joined, no query per row) |
| History | 2 |
| Dashboard, cache off | 5 (accountant check plus four counts); 0 when it comes from the cache |
| Review, a request that lost the race (logged) | 3 in one transaction |
| Review, success (from the code) | 4 |
| Bulk create, multi-row inserts (from the code) | 6, however many clients |
| Bulk create, one insert per row (logged, 3 clients) | 4 plus 2 per client: 10 for 3 clients, 1,004 for 500 |

## 6. What the indexes cost

`bench/write-cost.ts` (run in both orders): bulk inserts 8,716 rows/s with the three inbox indexes against 9,026 with one, which is 3 to 8% slower and within the noise. Single inserts and status updates took about 1 ms each in every setup, so the number of indexes made no measurable difference. Building the indexes on 1,000,000 rows takes 3 to 6 seconds. The table's indexes grew from 98.2 MB to 111.7 MB. I did not repeat the write test after adding the dashboard index (change 7); I expect the same small cost, but I have not measured it.

## 7. An experiment that did not help: a bigger connection pool

Each dashboard call runs four queries, and the connection pool (the number of connections the app keeps to the database) has 10, so I expected more connections to help. With the 1 GB cache in place I raised it to 40 and repeated the live dashboard test.

| Connection pool | p50 | p95 | p99 | Requests/s |
| --- | --- | --- | --- | --- |
| 10 (default) | 139 ms | 186 ms | 219 ms | 119 |
| 40 | 142 ms | 252 ms | 318 ms | 114 |

It did not help: the throughput is the same and the slowest requests got slower. The queries were limited by CPU and by the rows they read, not by waiting for a connection. With more connections, more queries run at once and compete for the same CPU. I went back to 10, and did not commit the experiment.

## 8. What I did not do

- The history and the review were not load tested. Bulk create was timed with one user, not 20.
- I did not measure offset against keyset pagination. Keyset is the design, and an integration test pages through 57 requests that share five timestamps, at three page sizes, with no duplicates and no gaps.
- Everything ran on one machine with one dataset.

## 9. At 100M requests

I would partition the event table by month and archive old partitions (partitioned MariaDB tables cannot have foreign keys, so the application would have to keep them consistent), archive old closed requests, and review which indexes are worth their write cost, because they would not fit in memory. At ten times the data (about 4.6 GB) even a 1 GB cache would be too small, so memory size and covering indexes would matter first. I would replace the dashboard cache with a summary table if the numbers per accountant grew, and add a read replica for the dashboard and the history.
