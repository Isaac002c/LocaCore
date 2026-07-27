# Migração de marca: CHRONOSTEK → TELUN

> **EMPRESA:** TELUN · **PRODUTO:** LocaCore · **ASSINATURA:** *Um produto TELUN*
> TELUN = *Telos + Lumen* — a luz que conduz ao propósito.

Status: **executada em 2026-07-27**. Este documento é o registro da migração e o
guia para remover a compatibilidade temporária.

---

## 1. Escopo

Três identidades distintas que **não** devem ser confundidas:

| Papel | Quem | Onde aparece |
| --- | --- | --- |
| **Fornecedora da plataforma** | **TELUN** | Login, rodapé, PDFs, e-mails, metadados |
| **Produto** | **LocaCore** | Título, PWA, assinatura, documentos |
| **Operadora da locação** | **Rental Log** (e demais tenants) | Dados do tenant — *não alterados* |

A marca antiga (Chronostek / ChronosTek / Chronos Tech) foi removida de toda a
experiência pública e operacional.

## 2. Ocorrências encontradas e classificação

Auditoria inicial: **53 ocorrências em 18 arquivos**.

| Classe | Itens | Ação |
| --- | --- | --- |
| **1. Visual/pública** | `public/logoChronosTech.png`, `app/icon.png` (favicon **era o logo antigo**), comentário em `financeAccess.js` | **Removidos/substituídos** |
| **2. Configuração** | `backend/.env.example`, `.env.prod.example` | Atualizados |
| **3. Banco** | tenant operador `slug=chronostek`, e-mail do super_admin | Migration (§4) |
| **4. Infraestrutura** | `docker-compose.yml`, `deploy/docker-compose.yml`, `nginx/api*.conf` | Legado, marcado; não servido ao usuário |
| **5. Identificador técnico** | `MASTER_SLUG` em `masterModels.js` | Parametrizado + **alias** |
| **6. Documentação histórica** | cabeçalhos de migrations, `README`, `DEPLOY.md`, `RELATORIO_CICLO5.md` | **Preservados de propósito** |
| **7. Compatibilidade** | slug antigo aceito durante transição | Alias controlado |

## 3. Alterações executadas

### Configuração central de marca
- `app/lib/brand.js` — fonte única (empresa, produto, assinatura, paleta, assets).
- `backend/services/finance/constants.js` — `DEFAULT_BRANDING` espelha o frontend.
- `app/globals.css` — variáveis `--telun-*` e tokens `--nx-*` apontando para elas.

### Paleta oficial aplicada
| Cor | Hex | Uso |
| --- | --- | --- |
| Cosmic | `#0B0B12` | fundo do shell, theme-color |
| Deep Violet | `#3B1F6A` | superfícies e áreas secundárias |
| Electric Lilac | `#A56BFF` | ações principais e estado ativo |
| Luminous Copper | `#FF8A3D` | alertas e destaques pontuais |
| Sand Gold | `#FFD8A6` | detalhes e badges |

**198 substituições** do antigo azul institucional (`#2563eb`, `#1d4ed8`,
`#3b82f6`, `#1e40af`) por tokens, em 39 arquivos.
As cores de **status** (verde/vermelho/âmbar/ciano) foram **preservadas** — §8:
sucesso, perigo e atenção precisam continuar universalmente compreensíveis.

### Assets
- ❌ Removidos: `public/logoChronosTech.png`, `app/icon.png`.
- ✅ Criados: `public/brand/{favicon,telun-logo,telun-symbol}.svg` — **placeholders
  tipográficos neutros**, nenhuma logo foi inventada. Caminhos dos arquivos
  oficiais documentados em `public/brand/README.md`.
- `public/logos/*` são logos de **tenants** — preservados.

### Metadados / PWA
`app/layout.jsx` e `public/manifest.webmanifest`: título, descrição,
applicationName, short_name, theme-color `#0B0B12`, Open Graph, Twitter Card,
`robots: noindex` (área autenticada).

## 4. Banco de dados

- **Migration:** `migrate_chronostek_brand_to_telun.sql` (no `manifest.json`).
- **Rollback:** `migrate_telun_brand_to_chronostek_rollback.sql`.

Propriedades: idempotente, não destrutiva, transacional, auditável.
Migra: tenant operador (`chronostek` → `telun`, **mesmo id**, sem duplicar),
e-mail do super_admin, branding institucional em settings/templates/contratos.

**Não reescreve recibos e contratos já emitidos** — são documentos com valor
histórico/fiscal e o snapshot deve refletir o que foi entregue na época.

## 5. Aliases de compatibilidade

`backend/models/masterModels.js`:

```js
const MASTER_SLUG = process.env.MASTER_TENANT_SLUG || 'telun';
const MASTER_SLUG_ALIASES = ['chronostek'];   // ← remover após validação
```

Ambos os slugs são reconhecidos como operador, então as métricas do painel
master ficam corretas **antes e depois** da migration.

**Data recomendada para remover o alias: 2026-08-27** (30 dias após a migração),
depois de confirmar que nenhum tenant/rota depende do slug antigo. Para remover:
apagar `MASTER_SLUG_ALIASES`, rodar a suíte e reimplantar.

## 6. Domínios

| Item | Hoje | Situação |
| --- | --- | --- |
| Frontend | `locacore.chronostek.com.br` | ⚠️ **domínio ainda no DNS antigo** |
| API | `api-locacore.chronostek.com.br` | ⚠️ idem |

O domínio **não bloqueia** o rebranding visual (§19): a interface já é 100%
TELUN. Quando o domínio TELUN existir:

1. Adicionar o hostname novo no túnel Cloudflare (mantendo o antigo como alias);
2. Adicionar o domínio no projeto Vercel;
3. Atualizar `FRONTEND_URL`, `BASE_URL` e `EXTRA_CORS_ORIGINS` no `.env.production`;
4. Validar e só então remover o alias antigo.

Tudo já está parametrizado — nenhuma URL fixa no código.

## 7. Ocorrências preservadas (e por quê)

| Local | Justificativa |
| --- | --- |
| Cabeçalhos de `create_financial_module*.sql`, `add_master_panel_columns.sql` | Alterar muda o **checksum** e provoca *drift* no runner de migrations |
| `nginx/api*.conf`, `docker-compose.yml` (raiz e `deploy/`) | Infra **legada** do deploy anterior, marcada como tal; não é servida ao usuário |
| `README.md`, `DEPLOY.md`, `RELATORIO_CICLO5.md`, `FINANCEIRO_MVP.md` | Documentação histórica que explica a própria migração |
| `MASTER_SLUG_ALIASES` | Compatibilidade controlada com remoção agendada |
| Domínios `*.chronostek.com.br` | Sob controle da empresa; troca planejada, não bloqueia o rebranding |

Nenhuma delas aparece para o usuário final — garantido por teste automatizado.

## 8. Teste de guarda

`backend/tests/brand-guard.test.js` (9 testes) **falha** se a marca antiga
aparecer em: interface, assets públicos, metadados, manifest, branding do
backend, gerador de PDF. As exceções acima são explícitas e justificadas no
próprio arquivo.

## 9. Checklist de validação

- [x] Login exibe *LocaCore — Um produto TELUN*
- [x] Paleta TELUN no CSS publicado (5 cores)
- [x] Status semânticos preservados
- [x] Favicon/manifest/metadados TELUN
- [x] Nenhum asset antigo no bundle
- [x] **0 ocorrências** da marca antiga no bundle
- [x] Backend, PDFs e contratos assinam TELUN
- [x] Migration + rollback criados e no manifest
- [x] Alias do operador master controlado
- [x] 201 testes verdes · build OK
