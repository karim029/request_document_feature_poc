# Design: Request Portal at scale

## 1. Overview and Goals
This document coverS the database designs and decisions made for the entities and the relations of the request portal feature, using MariaDB, and taking into consideration about 1000000 requests, 200 accountants and 20000 clients. taking into consideration in the design
- correct concurrency transitions 
- indexes for the most used queries
- measured performance
- trade offs
- what i'd change at 100M rows section

## 2. ERD
```mermaid
erDiagram
    accountant ||--o{ client : "manages"
    client ||--o{ document_request : "receives"
    accountant ||--o{ document_request : "owns"
    accountant |o--o{ document_request : "reviews"
    document_request ||--o{ document_request_event : "has history"
    accountant |o--o{ document_request_event : "acts as"
    client |o--o{ document_request_event : "acts as"
 
    accountant {
        int id PK
        string username
        string email
    }
    client {
        int id PK
        string username
        string email
        int accountant_id FK
    }
    document_request {
        int id PK
        string title
        text description
        string status
        text rejection_reason
        int client_id FK
        int accountant_id FK
        date due_date
        int reviewer_id FK
        datetime reviewed_at
        int version
        string storage_key
        string original_name
        string mime_type
        int file_size
        string checksum
        datetime created_at
        datetime updated_at
    }
    document_request_event {
        int id PK
        int request_id FK
        string from_status
        string to_status
        text reason
        int actor_accountant_id FK
        int actor_client_id FK
        datetime created_at
    }
```
Every event has exactly one actor: exactly one of `actor_accountant_id` and `actor_client_id` is set. enforced by a CHECK constraint in the migration. A newly created request has `from_status` NULL

## 3. Schema changes and why each column exists
 
| Column | Table | Why |
| --- | --- | --- |
| `accountant_id` | `document_request` | Copied from the client so the inbox filter and the index `(accountant_id, status, created_at)` need no join. Trade-off: the same fact is stored twice. Rule: it is the owner at creation time, and clients do not change accountant. |
| `due_date` | `document_request` | Needed for the overdue filter and the dashboard. |
| `reviewer_id` | `document_request` | Who made the current decision. Empty until a decision. |
| `reviewed_at` | `document_request` | When the approve or reject decision was made. |
| `version` | `document_request` | Optimistic locking: detects that the row changed since it was read, for example a re-upload while the status is still Reviewing. |
| `storage_key`, `original_name`, `mime_type`, `file_size`, `checksum` | `document_request` | Replace `documentPath`, so the API never exposes a server path and the file is described properly. |
| `document_request_event` | new table | Append-only log of every change: who, from what, to what, when and why. Gives the history endpoint, every rejection reason, and the review turnaround for the dashboard. |
 
## 4. Actor assumption
 
The server identifies the actor from an `X-Actor-Id` header. It checks that the user exists and that their role fits the action (an accountant creates, reviews, approves and rejects requests; a client uploads), and it records the id in the event row so the history shows who acted.
 
The weakness is that this is identification, not authentication: anyone can claim to be any actor, and the server cannot verify that the caller really is that user.
 
I would use JWT bearer tokens in production. A guard verifies the signature and expiry, rejects a missing or invalid token with 401, and rejects a valid user with the wrong role with 403.

## 5. Indexes

| Query | Index | Why this order | Write cost |
| --- | --- | --- | --- |
| Inbox, newest first: `WHERE accountant_id = ? AND status IN (...) ORDER BY created_at DESC, id DESC` | `(accountant_id, status, created_at)` on `document_request` | The equality columns open the accountant and status folders, and `created_at` last gives the order inside them, so no sort is needed. It also serves the dashboard counts through its leftmost prefix. | Every insert adds one entry. A status change moves the entry. `created_at` never changes. |
| Inbox, by due date: `WHERE accountant_id = ? AND status = ? ORDER BY due_date ASC`, and the overdue filter | `(accountant_id, status, due_date)` on `document_request` | Same folders, with `due_date` last as the order, and as the range for the overdue filter. | Every insert adds one entry. It moves when `status` or `due_date` changes. |
| History: `WHERE request_id = ? ORDER BY created_at, id` | `(request_id, created_at, id)` on `document_request_event` | `request_id` is the only equality, so it opens the folder. `created_at` then `id` give the order, with `id` as the tie-breaker for equal timestamps. | Events are only inserted, never updated or deleted, so one entry per insert. |

**Dashboard candidates, decided after measuring the naive version:** top clients `(accountant_id, status, client_id)`, and turnaround, which reads the event table.

## 6. Concurrency design

### The problem

Reviewing a request reads the row, checks the status in code, and then writes the result. Those are three separate steps, and another request can slip in between them. That causes two problems:

- Two accountants approve and reject the same request at the same moment. Both pass the check, and the last write silently overwrites the first.
- A reviewer opens a request, the client re-uploads a corrected file, and the reviewer approves a file they never saw. The status is still `reviewing`, so a status check does not notice.

A stricter check in the code cannot fix this, because the gap between the check and the write still exists.

### Options considered

1. **Conditional update.** Put the check in the write: `UPDATE ... WHERE id = ? AND status = 'reviewing'`. It is atomic, simple, and needs no extra column. Its downside is that it only protects the condition written in the `WHERE`, so it misses other changes, such as a re-upload while the status stays `reviewing`.
2. **Row lock (pessimistic).** Read inside a transaction with `SELECT ... FOR UPDATE`, which blocks anyone else touching that one row until the transaction ends. It is always correct. Its downsides are that the lock is held for the whole transaction, it holds a database connection, it cannot span the time a person spends reading a document, and locking several rows in different orders can deadlock.
3. **Version column (optimistic).** Each row carries a counter that increases on every write. The update only succeeds if the version still matches the one the client read. It takes no lock, and it detects any change to the row. Its costs are one extra column, the client must send back the version it saw, and every write path must bump it.

### Choice

I chose the version column, for these reasons:

- A reviewer reads for an unpredictable time, so a row lock cannot cover the gap between reading and clicking. A version travels with the click.
- Collisions on a single request are rare, so optimistic locking costs almost nothing in the normal case, and fails safely with a 409 in the rare one.
- It catches the re-upload case that a status-only check misses.
- It does not replace history. The append-only `document_request_event` table records who changed what and when.

For a short automated operation with no human in the middle, a conditional update would also be fine.

### How it works

Every response that returns a request includes its `version`. The review request must send back the version the reviewer saw. In one transaction, the server:

1. Runs `UPDATE document_request SET status = ?, reviewer_id = ?, reviewed_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'reviewing'`.
2. If one row changed, inserts the matching `document_request_event` row (from status, to status, actor, reason).
3. If zero rows changed, rolls back and returns `409 Conflict`, because someone changed the request first.

The upload path follows the same pattern and also bumps `version`. If it did not, a re-upload would go undetected.

### How it is proven

An integration test against a real MariaDB sends 20 parallel approve and reject calls for the same request. Exactly one returns 200, the other 19 return 409, and the request's event history shows one consistent transition.