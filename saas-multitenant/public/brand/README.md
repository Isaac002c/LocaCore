# Assets institucionais — TELUN / LocaCore

> **EMPRESA:** TELUN · **PRODUTO:** LocaCore · **ASSINATURA:** *Um produto TELUN*

Os arquivos `.svg` presentes aqui são **PLACEHOLDERS tipográficos neutros**
(apenas a palavra/letra em tipografia padrão com a paleta oficial). **Não são a
logo oficial** — nenhuma marca foi inventada. Substitua-os pelos arquivos
originais quando a identidade visual da TELUN estiver disponível.

## Caminhos exatos que devem receber os arquivos oficiais

| Caminho | Uso | Formato | Estado |
| --- | --- | --- | --- |
| `public/brand/telun-logo.svg` | Logo principal (assinatura, login, PDFs) | SVG | ⚠️ placeholder |
| `public/brand/telun-symbol.svg` | Logo reduzida / símbolo (sidebar recolhida, avatar) | SVG | ⚠️ placeholder |
| `public/brand/telun-logo-light.svg` | Logo para fundo claro | SVG | ❌ pendente |
| `public/brand/telun-logo-dark.svg` | Logo para fundo escuro | SVG | ❌ pendente |
| `public/brand/favicon.svg` | Favicon do navegador | SVG | ⚠️ placeholder |
| `public/brand/apple-touch-icon.png` | Ícone iOS | PNG 180×180 | ❌ pendente |
| `public/brand/icon-192.png` | PWA | PNG 192×192 | ❌ pendente |
| `public/brand/icon-512.png` | PWA (maskable) | PNG 512×512 | ❌ pendente |
| `public/brand/og-locacore.png` | Open Graph / redes sociais | PNG 1200×630 | ❌ pendente |

> Enquanto os PNGs estiverem pendentes, o `manifest.webmanifest` e o `layout.jsx`
> referenciam **apenas o SVG** — nada aponta para arquivo inexistente.
> Ao adicionar os PNGs, inclua-os no manifest e nos `icons` do layout.

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
