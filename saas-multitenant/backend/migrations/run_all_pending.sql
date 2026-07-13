-- =============================================================================
-- CR Recursos — Migrations pendentes (execução única no Neon de produção)
-- Todas as statements são idempotentes (IF NOT EXISTS / IF EXISTS).
-- Execute uma de cada vez e verifique o output antes de prosseguir.
-- =============================================================================


-- =============================================================================
-- M1: tabela documents (upload de documentos do cliente)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id  UUID,
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE,
  file_url     TEXT NOT NULL,
  file_name    VARCHAR(500),
  file_type    VARCHAR(100),
  file_size    BIGINT,
  category     VARCHAR(100) DEFAULT 'outros',
  description  TEXT,
  uploaded_by  UUID REFERENCES users(id),
  uploaded_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id);


-- =============================================================================
-- M2: tabela fine_protocols (múltiplos protocolos por serviço)
-- Não altera fines.protocol_* — dados legados preservados.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fine_protocols (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fine_id          UUID NOT NULL REFERENCES fines(id) ON DELETE CASCADE,
  protocol_number  VARCHAR(100),
  protocol_date    DATE,
  protocol_status  VARCHAR(50) DEFAULT 'protocolado',
  protocol_notes   TEXT,
  protocol_file_url TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fine_protocols_fine   ON fine_protocols(fine_id);
CREATE INDEX IF NOT EXISTS idx_fine_protocols_tenant ON fine_protocols(tenant_id);


-- =============================================================================
-- M3: tabela approval_requests (solicitações de exclusão pelo consultor)
-- =============================================================================

CREATE TABLE IF NOT EXISTS approval_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by  UUID REFERENCES users(id),
  target_type   VARCHAR(50) NOT NULL,
  target_id     UUID NOT NULL,
  target_label  VARCHAR(255),
  reason        TEXT,
  status        VARCHAR(20) DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   UUID REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant ON approval_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);


-- =============================================================================
-- M4: multas_leads — adiciona nao_encontrado ao CHECK + coluna archived_at
-- ATENÇÃO: DROP CONSTRAINT + ADD CONSTRAINT — trava a tabela brevemente.
-- Execute fora do horário de uso ou com poucos registros (seguro para volume pequeno).
-- =============================================================================

ALTER TABLE multas_leads DROP CONSTRAINT IF EXISTS multas_leads_status_check;
ALTER TABLE multas_leads ADD CONSTRAINT multas_leads_status_check
  CHECK (status IN (
    'entrada', 'possui_defensor', 'nao_quer_defender',
    'negociacao', 'fechado', 'perdido', 'nao_encontrado'
  ));

ALTER TABLE multas_leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_multas_leads_archived ON multas_leads(archived_at)
  WHERE archived_at IS NULL;
