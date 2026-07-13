# Módulo Financeiro (MVP) — NEXO Despachantes CRM · by ChronosTek

> **Atualização (UX overhaul):** o sistema foi reorganizado por domínios —
> **Visão Geral · CRM · Processos · Agenda · Financeiro · Configurações** — com
> sidebar agrupada, Dashboard Financeiro próprio (`?module=financeiro&tab=visao`)
> com filtro global de período e 6 gráficos (recharts, lazy-loaded), página de
> Pagamentos, Caixa com comparação semanal e linha cronológica, Faturamentos com
> KPIs + detalhe em drawer, e cancelamentos com motivo obrigatório.
> Novo endpoint agregado: `GET /api/financial/summary/overview?preset=|start=&end=&group=day|week|month`
> e `GET /api/financial/billings/stats`. URLs legadas (`?module=multas|leads`)
> continuam funcionando. Design tokens/componentes: `app/globals.css` (prefixo
> `.nx-`) e `app/components/ui.jsx`.

Documentação técnica do MVP financeiro implementado sobre a arquitetura existente
(Next.js 14 + Express + PostgreSQL/Neon, multi-tenant por JWT).

Todas as estruturas são **aditivas**: nenhuma tabela/coluna existente foi alterada
ou removida. O tenant **CR Recursos** e os dados atuais permanecem intactos.

---

## 1. Escopo entregue

- Categorias financeiras (entradas/saídas) por tenant, com seed automático.
- Lançamentos financeiros (entradas e saídas) — criar/editar/cancelar/filtrar/paginar.
- Caixa Semanal (segunda→domingo, ISO) com agregados calculados no banco.
- Faturamento por processo (multa) ou serviço, com desconto/acréscimo/valor final/saldo.
- Pagamentos totais/parciais/sinal/parcelas, com entrada automática no caixa (idempotente).
- Recibos com numeração única por tenant, PDF A4, cancelamento e reemissão.
- Histórico financeiro na página do cliente e do processo.
- Indicadores financeiros no dashboard administrativo.
- Configurações financeiras por tenant (identidade do recibo, prefixo, formas de pagamento).
- Permissões: admin com acesso total; consultor e super_admin bloqueados no backend.

**Fora de escopo (não implementado, conforme solicitado):** integrações bancárias,
NF-e, gateway, boleto/Pix automático, Open Finance, conciliação, contabilidade avançada.

---

## 2. Tabelas criadas

| Tabela | Papel |
|---|---|
| `financial_categories` | Categorias de entrada/saída por tenant |
| `service_billings` | Faturamento por processo (`fine_id`) / serviço |
| `payments` | Pagamentos (total/parcial/sinal/parcela) |
| `financial_transactions` | Lançamentos (Caixa) — entradas/saídas |
| `receipts` | Recibos (numeração única por tenant, snapshot dos dados) |
| `tenant_financial_settings` | Configurações financeiras por tenant |

Todas com `id UUID`, `tenant_id UUID`, `created_at`/`updated_at`, índices por
`tenant_id`, `client_id`, `fine_id`, `billing_id`, `payment_id`, datas e status.

**Decisão de arquitetura:** o faturamento foi modelado em `service_billings`
(vinculado a `fines` via `fine_id`) em vez de adicionar colunas em `fines`. Motivos:
não poluir a tabela crítica de produção, separar o "valor da multa" do "valor do
serviço do despachante", e evitar migration destrutiva. `fines` é a entidade
"processo" do sistema (contracts/services são views sobre ela).

**Idempotência:** índice único `uq_fin_tx_payment (payment_id)` garante **1 entrada
de caixa por pagamento**. Numeração de recibo usa `UPDATE ... RETURNING` com bloqueio
de linha em `tenant_financial_settings` + `UNIQUE(tenant_id, number)` como rede final.

Referências a `client_id`/`fine_id` usam `ON DELETE SET NULL` para **preservar o
histórico financeiro** caso um cliente/processo seja excluído.

---

## 3. Aplicar a migration

Pré-requisito: acesso ao banco (psql ou editor SQL do Neon). **Faça backup antes.**

```bash
# 1) Confirme o backup do banco (Neon: branch/snapshot; ou pg_dump).

# 2) Aplique a migration (idempotente — pode reexecutar com segurança):
psql "$DATABASE_URL" -f saas-multitenant/backend/migrations/create_financial_module.sql

# (Alternativa) cole o conteúdo do arquivo no SQL Editor do Neon e execute.
```

Não há seed obrigatório: categorias iniciais e as configurações do tenant são
criadas **sob demanda** no primeiro acesso ao módulo (idempotente). Isso evita
qualquer escrita em massa e mantém a CR Recursos intacta até o primeiro uso.

### Rollback da migration

```bash
# DESTRUTIVO — remove apenas as 6 tabelas do financeiro (nenhuma tabela existente).
psql "$DATABASE_URL" -f saas-multitenant/backend/migrations/create_financial_module_rollback.sql
```

---

## 4. Variáveis de ambiente

Nenhuma nova variável obrigatória. As existentes continuam valendo
(`DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `BACKEND_URL`, `PORT`).

Dependência nova do backend: **`pdfkit`** (geração de PDF local). Instale com
`npm install` no deploy do backend (já consta em `backend/package.json`).
Se `pdfkit` não estiver instalado, o endpoint de PDF responde `503` sem derrubar
o sistema (mesmo padrão do envio de e-mail/SMTP).

---

## 5. Build, testes e execução

```bash
# Backend
cd saas-multitenant/backend
npm install
npm test            # 59 testes (regras puras, serviços, HTTP auth, SQL via pg-mem, PDF)
node app.js         # inicia a API (porta 5000)

# Frontend
cd saas-multitenant
npm install
npm run build       # build de produção Next.js
npm run dev         # dev na porta 3001
```

---

## 6. Endpoints (todos sob `/api/financial`, admin-only)

Autenticados via `tenantContext` (tenant vem do token — `tenant_id` do payload é
ignorado) e protegidos por `requireFinanceRead`/`requireFinanceManage`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/categories` | Lista (semeia defaults) |
| POST/PUT | `/categories`, `/categories/:id` | Criar/editar |
| PATCH | `/categories/:id/active` | Ativar/inativar |
| DELETE | `/categories/:id` | Excluir (bloqueado se houver lançamentos) |
| GET/POST/PUT | `/transactions` | Lançamentos (filtros, paginação, ordenação) |
| POST | `/transactions/:id/cancel` | Cancelar lançamento manual |
| GET | `/cashbox?week_offset=` | Caixa Semanal (range + agregados + lista) |
| GET/POST/PUT | `/billings` | Faturamentos |
| POST | `/billings/:id/cancel` | Cancelar faturamento |
| GET | `/payments` · POST `/payments` | Listar / registrar pagamento |
| POST | `/payments/:id/cancel` | Cancelar pagamento (estorno lógico) |
| GET/POST | `/receipts` | Listar / emitir recibo |
| GET | `/receipts/:id/pdf?download=1` | PDF (inline/anexo) |
| POST | `/receipts/:id/cancel` · `/reissue` | Cancelar / reemitir |
| GET/PUT | `/settings` | Configurações financeiras do tenant |
| GET | `/summary/dashboard` | Indicadores do dashboard |
| GET | `/summary/client/:id` · `/summary/fine/:id` | Histórico do cliente / processo |

---

## 7. Permissões

- **Admin:** acesso completo (ler + gerenciar), emissão/cancelamento de recibos, config.
- **Consultor / seller / demais:** sem acesso ao financeiro (403 no backend).
- **Super Admin:** não acessa dados financeiros internos do tenant (403 no backend).

Enforcement em `backend/middlewares/financeAccess.js` — não depende de ocultar menu.

---

## 8. Deploy (checklist)

1. Confirmar **backup** do banco (Neon snapshot/branch ou `pg_dump`).
2. Validar migration em staging: aplicar `create_financial_module.sql`.
3. Validar variáveis de ambiente (sem novas obrigatórias).
4. Backend: `npm install` (traz `pdfkit`) → `npm test` → deploy (Render).
5. Frontend: `npm install` → `npm run build` → deploy (Vercel).
6. Smoke test: login admin → módulo Financeiro → criar categoria → faturar →
   registrar pagamento → emitir recibo → baixar PDF → conferir Caixa/Dashboard.
7. Rollback (se necessário): reverter deploy e, se preciso, rodar o rollback SQL.

**Não executar deploy automaticamente sem autorização explícita.**

---

## 9. Semana do Caixa

Definição única (frontend e backend): **segunda-feira 00:00 → domingo 23:59** (ISO 8601).
O backend é a fonte da verdade do intervalo (`getWeekRangeByOffset`) e o retorna
em `data.range`; o frontend apenas navega por `week_offset` e exibe o range recebido.
