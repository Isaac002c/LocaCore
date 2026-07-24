# Migração de marca: Chronostek → TELUN (host master)

> **⚠️ NÃO EXECUTAR AUTOMATICAMENTE.** Este procedimento altera o **slug produtivo**
> do tenant host do painel master (`chronostek`) e o e-mail/domínio institucional.
> Exige **banco de dados real, backup completo e autorização explícita** do
> responsável. O código-fonte **não** executa nada disto — é um runbook manual.

## Contexto

Há três marcas distintas no repositório — não confundir:

| Marca        | O que é                                   | Onde aparece                              | Renomear agora? |
|--------------|-------------------------------------------|-------------------------------------------|-----------------|
| **LocaCore** | Produto (SaaS de locadora)                | Login, recibos, contratos, rodapé         | Já é LocaCore ✅ |
| **TELUN**    | Fornecedor/software house do produto      | Assinatura institucional ("um produto TELUN") | Já é TELUN ✅ |
| **Chronostek** | **Slug produtivo** do tenant host do painel master (super_admin) | `masterModels.MASTER_SLUG`, `seed_master.js`, DNS/nginx, DB | **Somente sob autorização** ⛔ |

A identidade **visível do produto** já está 100% em LocaCore/TELUN
(`app/lib/brand.js`, `backend/services/finance/constants.js → DEFAULT_BRANDING`).
O que permanece como `chronostek` é **apenas** a infraestrutura produtiva do host
master, cuja renomeação quebra login do super_admin, DNS e integrações se feita
sem o procedimento abaixo.

## Pré-requisitos

1. Janela de manutenção agendada e comunicada.
2. **Backup verificado** do banco (`pg_dump`) e snapshot da infra.
3. Novo domínio/e-mail institucional TELUN provisionados (DNS, TLS, caixa de e-mail).
4. Autorização por escrito do responsável pela conta.

## Passo a passo (host master)

### 1. Banco de dados (transacional)
```sql
BEGIN;
-- 1.1 Renomear o slug do tenant host do master
UPDATE tenants SET name = 'TELUN', slug = 'telun' WHERE slug = 'chronostek';
-- 1.2 Atualizar e-mail do super_admin (se a política de e-mail mudar)
UPDATE users SET email = 'contato@telun.com.br'
 WHERE email = 'contato@chronostek.com.br' AND role = 'super_admin';
-- 1.3 Conferir antes de confirmar
SELECT id, name, slug FROM tenants WHERE slug IN ('telun','chronostek');
COMMIT;  -- ou ROLLBACK se algo estiver errado
```

### 2. Código (após o banco)
- `backend/models/masterModels.js` → `const MASTER_SLUG = 'telun';`
- `backend/scripts/seed_master.js` → `SLUG='telun'`, `EMAIL='contato@telun.com.br'`,
  nomes `'TELUN Master'` (idempotente; só afeta ambientes novos).
- Variáveis de ambiente/secret manager: e-mail e domínio do master.

### 3. Infraestrutura
- `nginx/api.conf`, `nginx/api-init.conf`: `server_name` → domínio TELUN.
- `docker-compose.yml`, `deploy/docker-compose.yml`: hosts/labels.
- DNS: novos registros A/CNAME + certificado TLS (Let's Encrypt) para o domínio TELUN.
- Redirecionar o domínio antigo (301) durante um período de transição.

### 4. Validação pós-migração
- Login do super_admin no novo domínio.
- Painel master lista os tenants e **exclui** o próprio host (`MASTER_SLUG`).
- Recibos/contratos seguem exibindo LocaCore/TELUN (inalterado).
- Nenhum tenant operacional foi afetado (isolamento preservado).

## Rollback
Restaurar o backup do passo *Pré-requisitos* e reverter DNS/nginx. Como o passo 1
é transacional, um `ROLLBACK` antes do `COMMIT` desfaz a renomeação no banco.

## Migrações históricas
Comentários de cabeçalho como *"NEXO Despachantes CRM by ChronosTek"* em
`create_financial_module*.sql` e `add_master_panel_columns.sql` são **registro
histórico** de migrações já aplicadas. **Não editar** — alterá-los muda o checksum
e provoca *drift* no runner de migrações (`scripts/migrate.js`).
