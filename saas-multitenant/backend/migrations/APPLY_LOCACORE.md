# Aplicação das migrations do LocaCore (PostgreSQL real)

Todas as migrations do LocaCore são **aditivas e idempotentes** (`CREATE ... IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, blocos `DO`/`to_regclass`, índices únicos parciais).
Podem ser reexecutadas com segurança e **não apagam dados**.

> Sem acesso a um banco PostgreSQL/Docker neste ambiente, a migration NÃO foi
> executada em um Postgres real aqui. A DDL segue exatamente os padrões já usados e
> validados em `create_financial_module.sql` / `000_nexos_schema.sql`, e um schema
> equivalente é exercitado pelos testes (pg-mem) e pelo `demo-server.js`. Aplique em
> homologação com o procedimento abaixo antes de produção.

## Ordem de aplicação

```bash
# 1) Backup (obrigatório antes de qualquer migration em produção)
pg_dump "$DATABASE_URL" > backup_pre_locacore_$(date +%F).sql

# 2) Base (se ainda não aplicada) + Financeiro
psql "$DATABASE_URL" -f migrations/000_nexos_schema.sql
psql "$DATABASE_URL" -f migrations/create_financial_module.sql

# 3) LocaCore — Ciclo 1 (frota + locações + vínculos financeiros/documentos)
psql "$DATABASE_URL" -f migrations/create_locacore_module.sql

# 4) LocaCore — Ciclo 2 (tenants.modules + config options + adicionais)
psql "$DATABASE_URL" -f migrations/create_locacore_cycle2.sql

# 5) LocaCore — Ciclo 3 (automação: settings, templates, charges, outbox, fiscal, runs, costs, webhooks)
psql "$DATABASE_URL" -f migrations/create_locacore_cycle3.sql

# 6) Idempotência: reexecute 3, 4 e 5 — devem terminar sem erro e sem alterar dados.
psql "$DATABASE_URL" -f migrations/create_locacore_module.sql
psql "$DATABASE_URL" -f migrations/create_locacore_cycle2.sql
psql "$DATABASE_URL" -f migrations/create_locacore_cycle3.sql
```

## Variáveis de ambiente da automação (Ciclo 3)

Segredos NÃO ficam no banco. Configure por env quando ativar provedores reais:

```
# WhatsApp (ex.: Meta Cloud API / Twilio) — quando whatsapp_provider != 'null'
WHATSAPP_META_TOKEN=...            # ou WHATSAPP_TWILIO_TOKEN=...
# Cobrança/PIX (ex.: Asaas / Mercado Pago) — quando payment_provider != 'null'
PAYMENT_ASAAS_KEY=...              # ou PAYMENT_MERCADOPAGO_KEY=...
# Fiscal (ex.: Focus NFe / NFe.io) — quando fiscal_provider != 'null'
FISCAL_FOCUSNFE_TOKEN=...          # ou FISCAL_NFEIO_TOKEN=...
```

Sem provedor/credenciais, tudo roda em **sandbox** (WhatsApp/PIX simulados) e a
emissão fiscal permanece **pending_configuration** (nenhuma nota produtiva é emitida).

## Agendamento do job semanal (sem scheduler embutido)

O job é idempotente e disparável por endpoint. Agende via cron/systemd chamando o
disparo por tenant (ex.: quarta 09:00), ou o botão "Executar" no painel:

```
# Exemplo cron (dispara o processamento; proteja o endpoint conforme sua infra):
0 9 * * 3  curl -s -X POST -H "Authorization: Bearer <token-admin>" https://api.seu-dominio/api/automations/run/billing
*/10 * * * * curl -s -X POST -H "Authorization: Bearer <token-admin>" https://api.seu-dominio/api/automations/run/outbox
```

## Verificação pós-aplicação

```sql
-- Tabelas novas
SELECT to_regclass('public.vehicles'), to_regclass('public.rentals'),
       to_regclass('public.rental_extras'), to_regclass('public.tenant_config_options');

-- Colunas de vínculo adicionadas (aditivas)
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE column_name IN ('rental_id','vehicle_asset_id','modules')
   AND table_name IN ('service_billings','payments','financial_transactions','receipts','documents','tenants')
 ORDER BY table_name, column_name;

-- Índices e chaves estrangeiras da locação
SELECT indexname FROM pg_indexes WHERE tablename IN ('vehicles','rentals','rental_extras');

-- Habilitar o módulo para o tenant da locadora (exemplo; ajuste o slug/id):
UPDATE tenants SET modules = '["locacao","financeiro"]'::jsonb WHERE slug = '<slug-da-locadora>';
-- Tenants existentes (despachante) permanecem com modules = NULL → todas as áreas.
```

## Checklist de aplicação (homologação → produção)

- [ ] Backup criado e validado (`pg_dump`).
- [ ] Aplicado em homologação primeiro; smoke test de locação/frota OK.
- [ ] `create_locacore_module.sql` aplicado sem erro.
- [ ] `create_locacore_cycle2.sql` aplicado sem erro.
- [ ] Reexecução (idempotência) sem erro e sem mudança de dados.
- [ ] Verificação de tabelas/colunas/índices/FKs (queries acima) OK.
- [ ] `tenants.modules` configurado para a locadora; demais tenants inalterados.
- [ ] Backend reinicia e responde `/health`; login retorna `tenant.modules`.
- [ ] Rollback testado em homologação (abaixo), se necessário reverter.

## Rollback (reversível)

```bash
# Reverte na ordem inversa. ATENÇÃO: remove tabelas/colunas do LocaCore e seus dados.
psql "$DATABASE_URL" -f migrations/create_locacore_cycle2_rollback.sql
psql "$DATABASE_URL" -f migrations/create_locacore_module_rollback.sql
```

Os rollbacks removem apenas o que estas migrations criaram (tabelas de frota/locações,
adicionais, config options e as colunas de vínculo `rental_id`/`vehicle_asset_id`/`modules`).
O domínio de despachante e o financeiro permanecem intactos.
