-- =============================================================================
-- LocaCore - Ciclo 10
-- Recibo x NFS-e por data de obrigatoriedade + feature flags granulares.
--
-- Puramente ADITIVA. Nenhum dado operacional existente e reescrito e nenhuma
-- nota/recibo antigo e reprocessado. Defaults seguros (flags novas = FALSE),
-- de modo que o comportamento so muda quando o administrador ativa.
-- =============================================================================

-- Feature flags independentes (§45) e a data-porteiro da NFS-e (§6/§8/§9).
--   payments_enabled : liga a criacao de cobranca no provedor externo (InfinitePay).
--   receipts_enabled : liga a geracao automatica de recibo apos o pagamento.
--   nfse_enabled     : liga a emissao automatica de NFS-e apos o pagamento.
--   nfse_mandatory_from : a partir desta data (no fuso do tenant) o pipeline passa
--                         a emitir NFS-e em vez de recibo. NULL = ainda nao definida.
--   document_auto_send  : envia o recibo/NFS-e ao cliente pelo canal configurado.
ALTER TABLE automation_settings
  ADD COLUMN IF NOT EXISTS payments_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS receipts_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nfse_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nfse_mandatory_from DATE,
  ADD COLUMN IF NOT EXISTS document_auto_send BOOLEAN NOT NULL DEFAULT TRUE;

-- Vinculo do recibo emitido pelo pipeline com a locacao (a coluna ja pode existir
-- em bancos que aplicaram o modulo de locacao; IF NOT EXISTS mantem idempotente).
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_rental ON receipts(tenant_id, rental_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(tenant_id, payment_id);
