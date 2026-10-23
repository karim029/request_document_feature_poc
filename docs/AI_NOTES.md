# AI notes

## Where I used AI
I used Claude throughout, as a mentor and as a code generator. I decided the design and read, ran and checked what it produced.

- **I wrote or directed myself:** the plan for the upload path (conditional update, version, event row), the choice to add a status index after my own tests, the checks that found two suspicious results (below), and every measurement run.
- **AI wrote, and I reviewed and ran:** the review method and its unit tests, the `seed:large` script, the k6 and write-cost scripts, the dashboard and bulk create code, the integration tests, the CI workflow, and the first drafts of the documents. I broke each test on purpose (changed the code, watched the test fail) before trusting it.
- **AI explained concepts** (indexes, `EXPLAIN`, isolation levels, keyset pagination), and I wrote my own notes from them.

## Where it was wrong, and how I caught it
1. **A race the AI's code missed.** The review method it wrote returned 400 instead of 409 to some of the losers of a parallel race. Under MariaDB's default REPEATABLE READ, the losing transaction re-read the row from an old snapshot, saw the old version and blamed the status. My parallel integration test (20 calls, expecting exactly one 200 and nineteen 409) caught it: ten losers got 409 and nine got something else. The fix was running those transactions at READ COMMITTED.
2. **A wrong diagnosis.** When the inbox was slow under load, the AI said it was a full table scan. `EXPLAIN` showed an index lookup, and `ANALYZE FORMAT=JSON` showed the real cause: the optimizer chose an index without `createdAt` and fetched 13,833 pages per query instead of 91.
3. **A wrong prediction and wrong code.** It predicted the overdue filter would be slow (it was not, p95 50 ms) and wrote `@Headers('x-actor-id', ParseIntPipe)`, which does not exist; the compiler showed it.

## How I verify
I run build, lint, unit tests and the integration tests before every commit, and read `git diff`. I repeat measurements and distrust results that contradict the mechanism: a write benchmark that did not reproduce when I reversed the order, and a cached dashboard run identical to the baseline (the cache was off because of a `.env` mistake). `migration:generate` as a drift check caught a typo in an index name in my entity.