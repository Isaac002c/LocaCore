-- Script para corrigir vendedores existentes
-- Execute este SQL no seu banco de dados Supabase

-- 1. Adicionar valor padrão para a coluna active (se não existir)
ALTER TABLE sellers ALTER COLUMN active SET DEFAULT true;

-- 2. Atualizar todos os vendedores existentes para active = true
UPDATE sellers SET active = true WHERE active IS NULL OR active = false;

-- 3. Verificar se há vendedores ativos
SELECT id, name, active FROM sellers;

