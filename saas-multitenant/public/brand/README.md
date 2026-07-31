# Assets institucionais — TELUN / LocaCore

> **EMPRESA:** TELUN · **PRODUTO:** LocaCore · **ASSINATURA:** *Um produto TELUN*

A **logo oficial da TELUN** está aplicada. O original fica em `img/logo_telun.jpeg`
(fora de `public/`, para não ser servido) e uma cópia em
`public/brand/telun-logo-original.jpeg`.

Todos os PNGs abaixo são **gerados** a partir dela:

```bash
node scripts/gerar-icones-marca.js
```

Rode esse comando sempre que a logo oficial mudar — não edite os PNGs à mão.

> O símbolo é luminoso sobre fundo **Cosmic (#0B0B12)**: o fundo é parte da arte.
> Por isso os ícones são gerados COM fundo, sem tentar recortar transparência
> (o recorte destruiria o brilho das trilhas).

Os `.svg` que restaram são placeholders tipográficos do período anterior e não
são mais referenciados pelo app.

## Caminhos exatos que devem receber os arquivos oficiais

| Caminho | Uso | Formato | Estado |
| --- | --- | --- | --- |
| `telun-logo-original.jpeg` | Arte oficial (fonte de tudo) | JPEG 1254×1254 | ✅ oficial |
| `telun-logo.png` | Logo principal | PNG 512×512 | ✅ gerado |
| `telun-symbol.png` | Símbolo (login, assinatura da sidebar) | PNG 256×256 | ✅ gerado |
| `favicon-16.png` / `favicon-32.png` / `favicon-48.png` | Aba do navegador | PNG | ✅ gerado |
| `apple-touch-icon.png` | Ícone iOS | PNG 180×180 | ✅ gerado |
| `icon-192.png` | PWA | PNG 192×192 | ✅ gerado |
| `icon-512.png` | PWA (any + maskable) | PNG 512×512 | ✅ gerado |
| `og-locacore.png` | Open Graph / redes sociais | PNG 1200×630 | ✅ gerado |

Os caminhos são consumidos por `app/lib/brand.js` (`BRAND.favicon`,
`BRAND.logoCompact`, `BRAND.appleIcon`, ...), e é dali que `layout.jsx`,
`manifest.webmanifest`, o login e a sidebar leem. **Não referencie o caminho do
arquivo direto nos componentes** — use sempre `BRAND.*`.

## Paleta oficial

| Cor | Hex | Uso |
| --- | --- | --- |
| Cosmic | `#0B0B12` | fundo principal (shell) |
| Deep Violet | `#3B1F6A` | superfícies, menus, áreas secundárias |
| Electric Lilac | `#A56BFF` | ações principais, estado ativo, destaques |
| Luminous Copper | `#FF8A3D` | alertas e destaques pontuais |
| Sand Gold | `#FFD8A6` | detalhes, badges, informações especiais |

As cores vivem em `app/globals.css` como `--telun-*` e em `app/lib/brand.js`
(`TELUN_COLORS`). **Não use hex de marca diretamente nos componentes.**

## Importante

Os arquivos em `public/logos/` são **logos de TENANTS** (clientes), não da
plataforma. Não confundir com esta pasta e não remover.
