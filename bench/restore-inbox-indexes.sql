-- DESIGNED SETUP: the three inbox indexes and the dashboard index as they stand after the
-- measurements (DESIGN.md section 5), then the foreign key. Indexes first, so the foreign key
-- reuses one instead of creating its own.
CREATE INDEX IDX_request_inbox_created ON document_request (accountantId, createdAt, id);
CREATE INDEX IDX_request_inbox_status_created ON document_request (accountantId, status, createdAt, id);
CREATE INDEX IDX_request_inbox_due ON document_request (accountantId, dueDate, id);
CREATE INDEX IDX_request_dashboard ON document_request (accountantId, status, dueDate, clientId);
ALTER TABLE document_request
  ADD CONSTRAINT FK_request_accountant FOREIGN KEY (accountantId) REFERENCES accountant(id);