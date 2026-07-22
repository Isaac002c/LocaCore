-- =============================================================================
-- Adiciona PLACA ao lançamento financeiro (Caixa) — operação despachante veicular.
-- A Pâmela lança um serviço a partir do cliente e informa a placa do veículo
-- (ela faz vários serviços por cliente/semana e precisa identificar qual veículo).
-- Aditivo, idempotente e NÃO destrutivo. Rollback em add_transaction_plate_rollback.sql.
-- =============================================================================
ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS plate VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_fin_tx_plate
  ON financial_transactions (tenant_id, plate)
  WHERE plate IS NOT NULL;
