-- =============================================================================
-- Ciclo 7 — Base de cobrança externa: mapeamento cliente → customer do provedor.
--
-- O adapter Asaas exige que o cliente da locação já exista como "customer" no
-- Asaas (external_customer_id) antes de gerar a cobrança PIX. Esta tabela guarda,
-- de forma idempotente e por-tenant, o id do cliente em CADA provedor — evitando
-- recriar customer a cada cobrança e permitindo trocar de provedor sem colisão.
-- =============================================================================

CREATE TABLE IF NOT EXISTS payment_customers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL,
  provider              TEXT NOT NULL,                 -- 'asaas', etc.
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_customer_id  TEXT NOT NULL,                 -- id do cliente no provedor
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_payment_customers UNIQUE (tenant_id, provider, client_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_customers_client ON payment_customers(tenant_id, client_id);
