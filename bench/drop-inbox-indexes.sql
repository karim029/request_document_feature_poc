-- NAIVE SETUP for the baseline: remove all the inbox indexes.
-- The foreign key on accountantId needs an index, so it is dropped first (and restored later).
ALTER TABLE document_request DROP FOREIGN KEY FK_request_accountant;
DROP INDEX IF EXISTS IDX_test_created ON document_request;
DROP INDEX IF EXISTS IDX_request_inbox_created ON document_request;
DROP INDEX IF EXISTS IDX_request_inbox_status_created ON document_request;
DROP INDEX IF EXISTS IDX_request_inbox_due ON document_request;