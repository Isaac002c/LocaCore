# LocaCore — Deploy: VPS (backend + banco) + Vercel (frontend)

> **LocaCore** é um produto **TELUN**.
> Repositório: `https://github.com/Isaac002c/LocaCore` (branch `main`).

Arquitetura alvo:

```
   Navegador
       │  https://locacore.vercel.app
       ▼
   VERCEL (Next.js)  ──rewrite /api/* e /auth/*──►  https://api.SEU-DOMINIO
       (frontend)                                         │
                                                          ▼
                                              VPS: nginx (TLS) → backend:5000
                                                          │
                                          worker · scheduler · Postgres · backup
```

O frontend chama sempre `/api/...` **relativo**. A Vercel faz o proxy no servidor
(`next.config.js → rewrites`), então o navegador enxerga **mesma origem** — cookies
de sessão funcionam e o CSP não precisa liberar terceiros.

---

## Pré-requisitos (o que só você pode providenciar)

| Item | Detalhe |
| --- | --- |
| **VPS** | Ubuntu 22.04/24.04. Mínimo 2 vCPU / 4 GB RAM / 40 GB SSD. |
| **Domínio** | Um subdomínio para a API, ex. `api.seudominio.com.br`. |
| **DNS** | Registro **A** do subdomínio → **IP da VPS** (propagar antes do TLS). |
| **Conta Vercel** | Conectada ao GitHub `Isaac002c`. |

---

# PARTE 0 — GitHub ✅ (concluído)

O código já está em `github.com/Isaac002c/LocaCore`, branch `main`.
Confira que está atualizado antes de cada deploy:

```bash
git push origin main
```

---

# PARTE 1 — VPS (backend + PostgreSQL)

## 1.1 Acesso e firewall

```bash
ssh root@IP_DA_VPS
```

Crie um usuário sem root e habilite o firewall (só SSH, HTTP e HTTPS):

```bash
adduser --disabled-password --gecos "" deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

> O Postgres **não** abre porta no host — fica só na rede interna do Docker.

## 1.2 Docker

```bash
curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
```

Saia e entre de novo como `deploy` (`ssh deploy@IP_DA_VPS`), depois confirme:

```bash
docker --version && docker compose version
```

## 1.3 Clonar o repositório

```bash
sudo mkdir -p /opt/locacore && sudo chown deploy:deploy /opt/locacore
git clone https://github.com/Isaac002c/LocaCore.git /opt/locacore
```

> Repositório privado? Gere um **deploy key** (`ssh-keygen -t ed25519 -C locacore-vps`),
> adicione a chave pública em *GitHub → repo → Settings → Deploy keys* (read-only)
> e clone pela URL SSH.

## 1.4 Variáveis de produção

```bash
cd /opt/locacore/saas-multitenant
cp .env.prod.example .env.prod
```

Gere os segredos:

```bash
echo "JWT_SECRET=$(openssl rand -hex 64)" && echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
```

Edite `.env.prod` (`nano .env.prod`) e preencha **no mínimo**:

| Variável | Valor |
| --- | --- |
| `API_DOMAIN` | `api.seudominio.com.br` |
| `CERTBOT_EMAIL` | seu e-mail |
| `NGINX_TEMPLATES` | `templates-init` (fase 1) |
| `POSTGRES_PASSWORD` | o gerado acima |
| `DATABASE_URL` | mesma senha do `POSTGRES_PASSWORD` |
| `JWT_SECRET` | o gerado acima |
| `BASE_URL` | `https://api.seudominio.com.br` |
| `FRONTEND_URL` | preencher depois com a URL da Vercel (Parte 2) |

Proteja o arquivo (contém segredos):

```bash
chmod 600 .env.prod
```

## 1.5 Subir banco + API (fase 1, HTTP)

```bash
cd /opt/locacore/saas-multitenant
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --build postgres migrate backend proxy
```

O serviço `migrate` roda as migrations (runner com lock + checksum) e sai.
Confira:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod logs migrate
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod exec backend node scripts/migrate.js status
```

Teste a API por HTTP (ainda sem TLS):

```bash
curl -s http://api.seudominio.com.br/health/ready
```

> Se falhar: o DNS ainda não propagou, ou a porta 80 está bloqueada.
> `docker compose ... logs proxy backend` mostra o motivo.

## 1.6 Emitir o certificado TLS

Com a fase 1 no ar (o nginx já serve `/.well-known/acme-challenge/`):

```bash
cd /opt/locacore/saas-multitenant
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod run --rm \
  --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$(grep ^API_DOMAIN .env.prod | cut -d= -f2)" \
  --email "$(grep ^CERTBOT_EMAIL .env.prod | cut -d= -f2)" --agree-tos --no-eff-email
```

## 1.7 Ativar HTTPS (fase 2)

Troque o template e recrie o proxy:

```bash
sed -i 's/^NGINX_TEMPLATES=.*/NGINX_TEMPLATES=templates/' .env.prod
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --force-recreate proxy
curl -s https://api.seudominio.com.br/health/ready
```

## 1.8 Subir worker, scheduler, backup e renovação

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod ps
```

> O serviço `frontend` **não sobe** (está no profile `frontend`) — quem serve o
> front é a Vercel. Para servir na própria VPS: `--profile frontend up -d`.

## 1.9 Criar o primeiro tenant + admin

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod exec \
  -e SEED_TENANT_NAME="Rental Log" \
  -e SEED_ADMIN_NAME="Administrador" \
  -e SEED_ADMIN_EMAIL="admin@rentallog.com.br" \
  -e SEED_ADMIN_PASSWORD="UMA-SENHA-FORTE" \
  backend node scripts/seed_admin.js
```

> Script idempotente (por e-mail/slug). Troque a senha no primeiro acesso.

---

# PARTE 2 — Vercel (frontend, conectado ao GitHub)

## 2.1 Importar o projeto

1. **vercel.com → Add New → Project → Import Git Repository**
2. Escolha **`Isaac002c/LocaCore`**
3. ⚠️ **Root Directory: `saas-multitenant`** — *este é o passo mais importante.*
   O app Next.js está nessa subpasta; sem isso o build falha.
4. Framework Preset: **Next.js** (detectado automaticamente)
5. Build Command / Install Command: deixe o padrão (já definidos em `vercel.json`)

## 2.2 Variáveis de ambiente (Production)

Em **Settings → Environment Variables**:

| Nome | Valor |
| --- | --- |
| `BACKEND_URL` | `https://api.seudominio.com.br` |
| `NEXT_PUBLIC_APP_ENV` | `production` |

> `BACKEND_URL` é o destino do rewrite `/api/*` e `/auth/*`. **Sem barra no final.**
> Não coloque `JWT_SECRET`, senha de banco ou qualquer segredo aqui — o frontend
> não usa nenhum deles.

## 2.3 Deploy

Clique em **Deploy**. Ao final você recebe a URL, ex. `https://locacore.vercel.app`.
Cada `git push origin main` passa a gerar deploy automático.

## 2.4 Fechar o CORS na VPS

Volte na VPS e aponte o backend para a URL da Vercel:

```bash
cd /opt/locacore/saas-multitenant
sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=https://locacore.vercel.app|' .env.prod
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --force-recreate backend
```

> Domínio customizado depois? Adicione-o na Vercel e inclua em
> `EXTRA_CORS_ORIGINS` (lista separada por vírgula) — o backend nunca usa `*`.

---

# PARTE 3 — Verificação (smoke de produção)

```bash
# 1. API viva e pronta (banco conectado)
curl -s https://api.seudominio.com.br/health/ready

# 2. Frontend responde
curl -sI https://locacore.vercel.app | head -1

# 3. Proxy da Vercel chegando na API (deve retornar 401 — sem token é o esperado)
curl -s -o /dev/null -w "%{http_code}\n" https://locacore.vercel.app/api/rentals
```

Depois, no navegador: **login → Painel → Frota → Locações**.

Checklist final:

- [ ] Login funciona e o Painel carrega os KPIs
- [ ] Criar cliente, veículo e locação
- [ ] Gerar contrato PDF (abre o arquivo)
- [ ] Upload de documento (URL do arquivo usa o domínio da API, não `localhost`)
- [ ] Banner de ambiente **não** aparece (é `production`)
- [ ] Rodapé mostra **LocaCore · um produto TELUN**

---

# PARTE 4 — Operação

### Atualizar (deploy de uma nova versão)

```bash
cd /opt/locacore && git pull origin main
cd saas-multitenant
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d --build
```

A Vercel atualiza o frontend sozinha no `git push`.

### Logs

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod logs -f backend
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod logs -f worker scheduler
```

### Backup

O serviço `backup` roda `pg_dump` diário em `deploy/backups/` com retenção
(`BACKUP_RETENTION_DAYS`). **Teste o restore pelo menos uma vez** — backup não
testado não é backup:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod exec backup ls -lh /backups
```

Restore: `backend/scripts/restore.sh` (leia o cabeçalho do script antes).

### Renovação do certificado

O serviço `certbot` tenta renovar a cada 12 h. Após uma renovação, recarregue o nginx:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod exec proxy nginx -s reload
```

---

# Pendências que continuam bloqueadas (não dependem deste deploy)

| Item | Bloqueio |
| --- | --- |
| WhatsApp (Meta) | Credenciais da Meta Cloud API |
| Cobrança/PIX (Asaas) | Chave de API + token de webhook |
| Emissão fiscal | Provedor + credenciais + **dados do contador** (segue `pending_configuration`) |
| Renomear slug `chronostek` → `telun` | Ver `backend/migrations/MIGRATION_CHRONOSTEK_TO_TELUN.md` — exige banco real, backup e autorização |

Ao ativar qualquer provedor, preencha as variáveis correspondentes no `.env.prod`
e recrie `backend worker scheduler`. **Segredos nunca vão para o banco nem para a Vercel.**

---

## Observações do repositório

- Existe um `package.json` na **raiz** do repositório com `express-rate-limit` e
  `express-validator` — as mesmas dependências (e versões) já declaradas em
  `saas-multitenant/backend/package.json`. É resquício de um `npm install` no
  diretório errado. Não afeta a Vercel **desde que o Root Directory esteja
  configurado**; pode ser removido numa limpeza.
- `nginx/api.conf` e `nginx/api-init.conf` são **legado** do deploy anterior
  (domínio e upstream antigos). O compose de produção usa `nginx/templates*/`.
