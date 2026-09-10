DROP INDEX IF EXISTS idx_documents_fiscal_document;
DROP INDEX IF EXISTS uq_documents_fiscal_document;
ALTER TABLE documents DROP COLUMN IF EXISTS fiscal_document_id;

