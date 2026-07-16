# Deploy — Nexos (VPS + Vercel)

> **Nexos** é uma plataforma desenvolvida e mantida pela **Chronostek**.

Deploy **novo e independente** (não toca no ambiente/dados atuais). Backend e
**PostgreSQL dentro do VPS**; frontend na **Vercel**.

---

## Estado atual de produção (2026-07)

| Camada | Detalhe |
| --- | --- |
| **Frontend** | Vercel, projeto `nexos` → `https://nexos-ochre.vercel.app` (HTTPS). Auto-deploy da branch `main` (repo `github.com/Isaac002c/Nexos`, Root Directory `saas-multitenant`). Domínio custom `nexos.chronostek.com.br` fica para etapa posterior. |
| **API** | Backend Express na VPS (`nexos-backend:5000`), exposto por **Cloudflare Tunnel nomeado** em `https://api-nexos.chronostek.com.br`. Env do frontend: `BACKEND_URL` → esse host (proxy `/api` e `/auth` via `next.config.js`). |
| **Banco** | PostgreSQL `nexos` só na rede interna `nexos-network` (sem porta no host). Volume `nexos-postgres-data`. |
| **CORS** | Backend libera `FRONTEND_URL` (Vercel) + `EXTRA_CORS_ORIGINS` (domínio custom futuro). Sem `*`. |
| **Backup** | `scripts/backup-db.sh` (pg_dump -Fc, sem senha no script) via cron 03:30 → `/opt/nexos/backups/database` (600), retenção 14, log em `backups/backup.log`. |
| **Túnel (token)** | `deploy/tunnel.env` (`TUNNEL_TOKEN=...`, chmod 600, fora do git). Serviço `tunnel` no compose (`restart: unless-stopped`). |

Subir/atualizar backend + túnel na VPS:
```bash
cd /opt/nexos
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build backend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d tunnel
```

---

> ⚠️ **Pré-requisito importante:** o schema base do banco (tabelas `tenants`,
> `users`, `clients`, `fines`, `service_types`, `sellers`, ...) **não está no
> repositório** — foi criado direto no Neon. Para subir "do zero" você precisa
> de um `schema.sql`. Duas formas (escolha uma):
> 1. **Dump só de schema do Neon** (recomendado — read-only, NÃO copia dados):
>    `pg_dump --schema-only --no-owner --no-privileges "$NEON_URL" > deploy/schema.sql`
> 2. **Reconstruir do código** — posso gerar um `schema.sql` a partir dos models
>    (mais sujeito a divergências; peça se preferir esse caminho).

---

## 0. Pré-requisitos no VPS (Ubuntu 22/24)
```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # reabra a sessão
docker --version && docker compose version
```

## 1. Código no VPS
```bash
# repo privado — configure deploy key/HTTPS token do GitHub, então:
git clone https://github.com/<usuario>/Nexos.git
cd Nexos/saas-multitenant
# coloque o deploy/schema.sql (passo acima) dentro de deploy/
```

## 2. Variáveis de ambiente
```bash
cp deploy/backend.env.example deploy/backend.env
# gere um JWT forte:
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(64).toString('hex'))"
# edite deploy/backend.env (DATABASE_URL/JWT_SECRET/FRONTEND_URL/BASE_URL)

# variáveis do compose (Postgres + domínio):
cat > deploy/.env <<EOF
POSTGRES_USER=nexo
POSTGRES_PASSWORD=<mesma senha usada na DATABASE_URL>
POSTGRES_DB=nexo
API_DOMAIN=api.seu-dominio.com
CERTBOT_EMAIL=voce@seu-dominio.com
EOF
```
> `deploy/backend.env` e `deploy/.env` estão no `.gitignore` — não serão versionados.

## 3. Banco: subir Postgres, aplicar schema + migrations, seed
```bash
cd Nexos/saas-multitenant
docker compose -f deploy/docker-compose.yml up -d postgres

# 3.1 schema base (do dump) + módulo financeiro + migrations idempotentes
docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U nexo -d nexo < deploy/schema.sql
docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U nexo -d nexo < backend/migrations/create_financial_module.sql
# (rode também as demais migrations que não estejam no dump, se houver)

# 3.2 primeiro tenant + admin
docker compose -f deploy/docker-compose.yml up -d backend
docker compose -f deploy/docker-compose.yml exec \
  -e SEED_TENANT_NAME="Minha Empresa" \
  -e SEED_ADMIN_NAME="Admin" \
  -e SEED_ADMIN_EMAIL="admin@empresa.com" \
  -e SEED_ADMIN_PASSWORD="senha-forte" \
  backend node scripts/seed_admin.js
```

## 4. Nginx + SSL
```bash
sed -i "s/__API_DOMAIN__/api.seu-dominio.com/g" deploy/nginx.conf   # aponte o DNS A p/ o IP do VPS antes
# certificado inicial (standalone, porta 80 livre):
docker run --rm -p 80:80 -v nexo-certs:/etc/letsencrypt certbot/certbot \
  certonly --standalone --agree-tos --no-eff-email \
  -m voce@seu-dominio.com -d api.seu-dominio.com
docker compose -f deploy/docker-compose.yml up -d nginx
# teste:
curl -s https://api.seu-dominio.com/health
```
> Alternativa mais simples: colocar o VPS atrás do **Cloudflare** (SSL flexível/full)
> e apontar só o proxy, dispensando o certbot.

## 5. Frontend na Vercel (sem token, via GitHub)
No painel da Vercel → **Add New → Project → Import** o repositório GitHub:
- **Root Directory:** `saas-multitenant`
- **Framework:** Next.js (detecta automático)
- **Environment Variables:**
  - `BACKEND_URL = https://api.seu-dominio.com`  (o `next.config.js` faz o proxy `/api` e `/auth`)
  - (opcional) `FRONTEND_URL` = a própria URL da Vercel
- Deploy. Depois ajuste `FRONTEND_URL` no `deploy/backend.env` do VPS com o domínio final da Vercel e `docker compose ... up -d backend` para o CORS liberar.

## 6. Verificação (smoke test)
- `https://api.seu-dominio.com/health` → `{"status":"ok"}`
- Login na URL da Vercel com o admin semeado → Dashboard carrega.
- Criar cliente / faturar / registrar pagamento / emitir recibo (PDF).

## 7. Rollback
Como é um ambiente **novo e isolado**, o rollback é trivial e não afeta a produção atual:
```bash
docker compose -f deploy/docker-compose.yml down          # para tudo (mantém volumes/dados)
docker compose -f deploy/docker-compose.yml down -v       # remove TUDO, inclusive o banco novo
```
O ambiente atual (Neon + backend antigo + Vercel atual) permanece intacto o tempo todo.
