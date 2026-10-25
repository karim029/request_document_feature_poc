-- NAIVE SETUP for the baseline: remove every index that starts with accountantId, the three
-- inbox indexes and the dashboard index, so no query can use one.
-- The foreign key on accountantId needs an index, so it is dropped first (and restored later).
ALTER TABLE document_request DROP FOREIGN KEY FK_request_accountant;
DROP INDEX IF EXISTS IDX_request_inbox_created ON document_request;
DROP INDEX IF EXISTS IDX_request_inbox_status_created ON document_request;
DROP INDEX IF EXISTS IDX_request_inbox_due ON document_request;
DROP INDEX IF EXISTS IDX_request_dashboard ON document_request;