# LocaCore — Ciclo 10: Automação recibo/NFS-e, confirmação manual e feature flags

Data: 2026-08-20 · Tenant foco: **Rental Log Service Ltda** · Base: ciclo 9 (working tree, não commitado)

> Regra honesta: nada aqui declara "concluído" uma integração sem credencial. Recibo já funciona; InfinitePay/Evolution/NFS-e ficam **prontos e aguardando credencial/conexão**, sem link/nota falsos (fail-closed).

---

## IMPLEMENTADO (novo neste ciclo)

- **Pipeline único pós-pagamento** (`services/automation/postPaymentPipeline.js`): pagamento confirmado (webhook **ou** manual) decide o documento pela regra do contador —
  `nfse_enabled` **e** hoje ≥ `nfse_mandatory_from` **e** fiscal configurado → **NFS-e**; senão `receipts_enabled` → **recibo**; senão nada. A virada de data respeita o fuso do tenant. Se a NFS-e falhar, o pagamento continua `PAID` e o fiscal vai para a fila (§9). Idempotente (1 recibo por pagamento; NFS-e por idempotency_key; mensagem por `payment_id:document`).
- **Recibo automático** reaproveitando o módulo financeiro real (`finance/receiptService.issueReceipt`): numeração única, emissor snapshot, vínculo cliente+locação. **Funciona já, sem InfinitePay/certificado** (§48).
- **Confirmação manual do pagamento** (§49): `POST /api/automations/charges/:id/confirm` (valor, data, forma, obs, responsável) → dá baixa via `finance/paymentService.confirmPayment` e dispara **o mesmo** pipeline (recibo/NFS-e → documento → WhatsApp). Sem lógica paralela.
- **Entrega do documento por WhatsApp** (§25/§39): template `document` + variáveis `document_link`/`document_numero`/`periodo`/`payment_link`; envio na fila (respeita rate-limit/janela).
- **Link público assinado** (`services/automation/publicLinks.js` + rota `/public/documents/receipt/:id`): capability-URL com HMAC derivado da master key; o cliente abre o recibo em PDF sem login, sem enumeração, `noindex`.
- **Feature flags granulares** (§45): `payments_enabled`, `receipts_enabled`, `nfse_enabled`, `document_auto_send` + `nfse_mandatory_from` — permite "Recibos ON / InfinitePay OFF / NFS-e preparada e desligada".
- **Categorias fiscais reutilizáveis** (`ensureDefaultFiscalCategories`, §12): locação→`99.04.01`/ISS **não incidente**; multa, juros, caução, manutenção, avaria, combustível, serviço adicional **separadas** (não herdam a tributação da locação). Não inventa CST/cClassTrib (Simples).
- **Seed do tenant Rental Log** (`scripts/seed-rental-log-fiscal.js`): mostra os dados extraídos dos documentos oficiais e só grava com `--commit` (não sobrescreve sem `--force`) — §2/§50.
- **Timeline da cobrança** (§38): `GET /api/automations/charges/:id/timeline` (da trilha de auditoria) + modal no front.
- **Frontend** (`app/locacao/Automacoes.jsx`): seção "Recibos e documentos fiscais" (flags + data), botão "Confirmar pgto" + modal, "Linha do tempo" por cobrança.
- **Auditoria de dados** (`scripts/audit-rental-log.sql`): consulta **somente leitura** de prontidão por tenant (ativas, valor, telefone, CPF, NCM).

## EXISTENTE E REAPROVEITADO (ciclo 9, mantido)

- `PaymentProvider` → **InfinitePayProvider** real (`/links` com `order_nsu` + `webhook_url`; confirmação **fail-closed** por `payment_check`), Asaas e sandbox.
- `MessagingProvider` → **EvolutionProvider** real (connectionState, template/texto, parse de webhook), Meta e sandbox.
- `FiscalProvider` → **NationalNfseProvider** (DPS + mTLS A1), Focus NFe, null (pending_configuration).
- Cobrança semanal fail-closed, prioridade de valor (§17), timezone SP (§18/§43), régua/dunning, readiness 2 níveis (§28/§29), dry-run, piloto/lote/global, secrets AES-256-GCM, certificado A1, `automation_audit_log`, webhooks idempotentes montados em `/webhooks`.

## ALTERADO (arquivos e migrations)

- Migrations: **`create_locacore_cycle10.sql`** (+ rollback) e `manifest.json`.
- Backend: `services/automation/{postPaymentPipeline,publicLinks}.js` (novos), `paymentConfirmService.js` (usa o pipeline + `confirmManual`), `render.js` (vars de documento), `defaultTemplates.js` (`document`), `models/automationModels.js` (flags no whitelist + `ensureDefaultFiscalCategories`), `routes/automationRoutes.js` (confirm/timeline/categorias), `routes/publicDocumentRoutes.js` (nova), `app.js` (monta `/public`), `providers/fiscal.js` (doc do endpoint real da NFS-e Nacional), `scripts/{seed-rental-log-fiscal.js,audit-rental-log.sql}`.
- Frontend: `app/lib/automationsAPI.js`, `app/locacao/Automacoes.jsx`.
- Testes: `tests/{postpayment-pipeline,fiscal-categories,migrate-cycle10}.test.js` (novos).

## BANCO (novo no ciclo 10)

`automation_settings` += `payments_enabled`, `receipts_enabled`, `nfse_enabled` (BOOL default FALSE), `nfse_mandatory_from` (DATE, sem default — não inventada), `document_auto_send` (BOOL default TRUE). `receipts` += `rental_id` (FK) + índices `idx_receipts_rental`/`idx_receipts_payment`. Puramente aditivo; defaults seguros; não reescreve dado nem reprocessa nota antiga.

## FISCAL

| Item | Status |
|---|---|
| **Recibo** | ✅ **Pronto e funcional** (independe de credencial). Ativa com `receipts_enabled`. |
| **NFS-e** | Provider nacional pronto (fail-closed). **Aguardando** certificado A1 + validação → `nfse_enabled`. Nunca emite nota simulada (§47). |
| **Certificado A1** | Upload/cofre cifrado + alertas de validade prontos. **Aguardando arquivo .pfx + senha.** |
| **99.04.01** | Config inicial da locação (categoria `locacao`), **não hardcoded**. Histórico `99.01.01` preservado, não migrado (§3/§13). |
| **NCM** | Campo mestre no veículo (ciclo 9) + defaults do contador documentados. Marca `NCM_REQUIRED` se faltar; não infere. |
| **ISS** | `iss_treatment = nao_incide` na categoria locação (§4), parametrizado. |
| **IBS/CBS** | Vazio de propósito (Simples); estrutura pronta para 2027 (§5). |

## INFINITEPAY

**Código pronto / aguardando conta+InfiniteTag.** Bate com a doc oficial atual (verificada ago/2026): `POST https://api.checkout.infinitepay.io/links` (handle + `order_nsu` + `webhook_url`) e confirmação por `payment_check`. Sem InfiniteTag, nenhum link/PIX falso é criado (`payments_enabled` OFF ⇒ recibo por confirmação manual).

## EVOLUTION

**Código pronto / aguardando conexão.** Falta: URL + API key + instance name + **QR Code escaneado** (estado `open`) + webhook `…/webhooks/whatsapp/evolution`. Teste de mensagem disponível em Configurações → Integrações. Abstração `MessagingProvider.send()` isola o LocaCore de Baileys/Evolution (troca futura sem reescrever cobrança).

## WEBHOOKS (URLs, públicas, montadas em `app.js`)

- `POST /webhooks/infinitepay` e `/webhooks/payment/:provider` — ✅ montado (raw-body + verificação ativa fail-closed).
- `POST /webhooks/whatsapp/:provider` (+ `GET /webhooks/whatsapp/meta/:tenantId` handshake) — ✅ montado.
- `GET /public/documents/receipt/:id?tid=&t=` — ✅ (link assinado do recibo).
- Status: **funcionais no código**; ficam ativos quando o backend com ciclo 9/10 for implantado e `BASE_URL` público estiver setado.

## AUTOMAÇÃO

Scheduler (`America/Sao_Paulo`, jobs overdue/outbox/dunning/billing/fiscal) e worker/fila (`message_outbox` com retry/backoff, dead-letter, idempotência) do ciclo 9 — mantidos. Régua de cobrança (D-2…D+5) cancela mensagens futuras ao confirmar pagamento (§26). Retry com backoff e `NEEDS_ATTENTION` após o limite (§34).

## AUDITORIA DE DADOS (HOJE)

Prod está em `6380ed1` (**antes** do ciclo 9) — as colunas `ncm`/`weekly_rate`/flags **não existem lá ainda**, então a auditoria por NCM/valor semanal só roda depois de aplicar a migration. A consulta read-only automatizada ao banco de produção foi **bloqueada pelo classificador de segurança** (queries em prod exigem sua autorização). Entregue: `scripts/audit-rental-log.sql` (somente leitura). Para os números reais de HOJE, rode na VPS:

```bash
docker exec -i locacore-postgres psql -U locacore -d locacore < saas-multitenant/backend/scripts/audit-rental-log.sql
```

(telefone/CPF/locações ativas já rodam no schema atual; NCM/valor semanal, após a migration).

## TESTES

- **Antes:** 346 (backend) · **Depois:** **360** (+14: 11 pipeline recibo/NFS-e/manual, 2 categorias fiscais, 1 migration ciclo 10). **0 falhas.** Todos os testes anteriores preservados.
- Cobrem: gate recibo↔NFS-e por data e fuso, NFS-e ativa só a partir da data e no modo after_payment, recibo idempotente, confirmação manual dispara o mesmo pipeline, link assinado à prova de adulteração, categorias separadas (serviço não herda tributação da locação), migration aditiva com defaults seguros.

## BUILD

- Backend: `node --test` → **360/360**.
- Frontend: `next build` → **compilado com sucesso** (TypeScript OK; só o aviso pré-existente de `metadataBase`).

## PRONTIDÃO

- **Recibos: 100%** — pronto para ativar (`receipts_enabled`).
- **Confirmação manual: 100%** — pronto.
- **Evolution/WhatsApp: ~90%** — aguardando conexão (QR + credenciais + webhook).
- **InfinitePay: ~85%** — aguardando conta + InfiniteTag.
- **Fiscal/NFS-e: ~90%** — aguardando certificado A1 + validação do contador; para emissão DIRETA no ADN falta o assinador de DPS-XML (ver abaixo).
- **Dados (Rental Log):** a medir com o script após aplicar a migration em prod.

## BLOQUEADORES REAIS (dependem de nós/cliente)

1. **Deploy** do ciclo 9+10 em produção (prod está em `6380ed1`; runbook em [[locacore-producao]]).
2. **InfiniteTag/conta InfinitePay** do cliente.
3. **Certificado A1 (.pfx) + senha** e as definições finais do contador (código municipal, alíquota se aplicável).
4. **Conexão Evolution** (URL + API key + instância + QR escaneado + webhook).
5. **`BASE_URL` público** e `AUTOMATION_SECRETS_KEY`/`PUBLIC_LINK_SECRET` no ambiente (para webhooks e links de documento).
6. **NFS-e Nacional direta:** o endpoint real é `POST https://sefin.nfse.gov.br/SefinNacional/nfse` com **DPS em XML assinado (XMLDSig) + GZip + Base64** sobre mTLS. O adapter atual envia JSON para endpoint parametrizável (pronto para intermediário RJ, ex. PlugNotas/Focus/NFE.io). Bater direto no ADN exige um passo extra de montar+assinar o XML da DPS — não incluído por não haver certificado para testar. **Decisão a tomar:** intermediário (mais rápido) vs. construir o assinador de DPS.

## PRÓXIMOS PASSOS (como testar cada coisa)

1. **Testar uma cobrança:** deploy do backend → em Automações, `payment_provider=infinitepay`, InfiniteTag e `payments_enabled` ON → "Executar cobrança semanal" (ou dry-run primeiro). Sem InfiniteTag, use confirmação manual.
2. **Enviar WhatsApp:** Configurações → Integrações → WhatsApp: URL+API key+instância, escanear QR, "Testar mensagem".
3. **Confirmar pagamento:** aba Cobranças → "Confirmar pgto" (valor/data/forma) → dispara o pipeline.
4. **Gerar recibo:** ligar `receipts_enabled` → a confirmação (manual ou webhook) gera recibo, guarda, associa e (se WhatsApp ON) envia o link.
5. **Configurar InfinitePay:** Configurações → Integrações → InfinitePay (InfiniteTag; webhook `…/webhooks/infinitepay`) → "Testar integração".
6. **Testar NFS-e:** subir certificado A1, aplicar `seed-rental-log-fiscal.js`, validar config fiscal, decidir ADN-direto vs intermediário; ligar `nfse_enabled` só em homologação, com uma nota controlada.
7. **Ativar piloto:** dry-run → modo `pilot` com 1 locação → validar cálculo/cobrança/WhatsApp/pagamento/recibo → escalonar 5 → 10 → elegíveis.
