-- Script de migração para adicionar seller_id na tabela de leads
-- Execute este SQL no seu banco de dados Supabase

-- 1. Adicionar coluna seller_id na tabela leads (se não existir)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES sellers(id) ON DELETE SET NULL;

-- 2. Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_leads_seller ON leads(seller_id);

-- 3. Atualizar RLS para incluir sellers
ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;

-- 4. Policy para sellers
DROP POLICY IF EXISTS "Tenant can only see own sellers" ON sellers;
CREATE POLICY "Tenant can only see own sellers" ON sellers
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', true));

-- 5. Habilitar extensions necessária para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

