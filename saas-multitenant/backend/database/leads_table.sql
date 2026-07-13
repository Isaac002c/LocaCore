-- Script para criar a tabela de leads no PostgreSQL/Supabase
-- Execute este SQL no seu banco de dados Supabase

-- 1. Criar tabela leads (usando UUID conforme padrão Supabase)
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    company VARCHAR(255),
    value DECIMAL(15,2) DEFAULT 0,  -- 💰 VALOR DA OPORTUNIDADE (NOVO)
    status VARCHAR(50) DEFAULT 'novo',  -- Estágio: novo, contactado, qualificado, proposta, Negociacao, ganho, perdido
    stage VARCHAR(50) DEFAULT 'lead',  -- Novo campo para pipeline: lead, qualified, proposal, negotiation
    source VARCHAR(100),  -- site, google, indicacao, linkedin, etc
    notes TEXT,
    assigned_to UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Criar tabela de METAS da empresa (NOVO)
CREATE TABLE IF NOT EXISTS company_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,  -- 1-12
    year INTEGER NOT NULL,
    target_value DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, month, year)
);

-- 3. Criar tabela de ATIVIDADES (NOVO - CRÍTICO)
CREATE TABLE IF NOT EXISTS lead_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,  -- ligacao, email, reuniao, followup, tarefa
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_value ON leads(value);  -- Novo índice para valores
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);  -- Novo índice

CREATE INDEX IF NOT EXISTS idx_activities_lead ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_tenant ON lead_activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activities_due_date ON lead_activities(due_date);

CREATE INDEX IF NOT EXISTS idx_company_targets_tenant ON company_targets(tenant_id);

-- 5. Habilitar RLS (Row Level Security)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

-- 6. Policy: tenants só veem seus próprios leads
DROP POLICY IF EXISTS "Tenant can only see own leads" ON leads;
CREATE POLICY "Tenant can only see own leads" ON leads
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Policy para company_targets
CREATE POLICY "Tenant can only see own targets" ON company_targets
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Policy para lead_activities
CREATE POLICY "Tenant can only see own activities" ON lead_activities
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', true));

