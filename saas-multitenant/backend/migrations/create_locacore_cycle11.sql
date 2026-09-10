-- =============================================================================
-- LocaCore - Ciclo 11
-- Arquivamento idempotente do documento fiscal na pasta do cliente.
--
-- A coluna é aditiva e não altera documentos existentes. A restrição única
-- impede que uma retentativa da emissão crie duas cópias da mesma nota.
-- =============================================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS fiscal_document_id UUID
    REFERENCES fiscal_documents(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_fiscal_document
  ON documents(tenant_id, fiscal_document_id)
  WHERE fiscal_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_fiscal_document
  ON documents(fiscal_document_id);

