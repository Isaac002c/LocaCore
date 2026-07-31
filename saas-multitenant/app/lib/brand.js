// =============================================================================
// brand.js — FONTE ÚNICA DE VERDADE da identidade institucional.
//
//   EMPRESA   TELUN        (operadora da plataforma / fornecedora da tecnologia)
//   PRODUTO   LocaCore     (o SaaS de gestão para locadoras)
//   ASSINATURA "Um produto TELUN"
//
// TELUN = Telos + Lumen — "a luz que conduz ao propósito".
//
// A identidade OPERACIONAL de cada tenant (a locadora, ex.: Rental Log) vem
// SEMPRE dos dados do tenant — name, logo_url, brand_color, tagline — e nunca
// é fixada aqui. Estes valores aparecem apenas em pontos INSTITUCIONAIS do
// produto (login, rodapé, créditos, PDFs, e-mails).
//
// Não espalhe texto ou cor de marca pelo código: consuma daqui (JS) ou das
// variáveis CSS `--telun-*` / `--nx-*` definidas em app/globals.css.
// =============================================================================

// ── Paleta oficial TELUN ─────────────────────────────────────────────────────
// Identidade predominantemente escura, elegante e tecnológica.
export const TELUN_COLORS = {
  cosmic:         '#0B0B12', // fundo principal
  deepViolet:     '#3B1F6A', // superfícies, menus, áreas secundárias
  electricLilac:  '#A56BFF', // ações principais, estados ativos, destaques
  luminousCopper: '#FF8A3D', // alertas e destaques pontuais
  sandGold:       '#FFD8A6', // detalhes, badges, informações especiais
};

export const BRAND = {
  companyName:      'TELUN',
  productName:      'LocaCore',
  productSignature: 'Um produto TELUN',
  productTagline:   'Gestão inteligente de locadoras',
  productDescription:
    'Plataforma integrada de gestão para locadoras de veículos. Um produto TELUN.',
  // Parametrizáveis por env — não invente endereços que não existam.
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'suporte@telun.com.br',
  website:      process.env.NEXT_PUBLIC_PLATFORM_WEBSITE || '',
  // Assets institucionais OFICIAIS. Gerados de img/logo_telun.jpeg por
  // scripts/gerar-icones-marca.js — rode-o de novo se a logo mudar.
  // O símbolo é luminoso sobre fundo Cosmic: o fundo faz parte da arte.
  logo:        '/brand/telun-logo.png',
  logoCompact: '/brand/telun-symbol.png',
  favicon:     '/brand/favicon-32.png',
  faviconSmall:'/brand/favicon-16.png',
  faviconLarge:'/brand/favicon-48.png',
  appleIcon:   '/brand/apple-touch-icon.png',
  icon192:     '/brand/icon-192.png',
  icon512:     '/brand/icon-512.png',
  ogImage:     '/brand/og-locacore.png',
  colors: TELUN_COLORS,
};

// ── Compatibilidade com os imports já existentes ─────────────────────────────
export const PRODUCT_NAME       = BRAND.productName;
export const PRODUCT_TAGLINE    = BRAND.productTagline;
export const PRODUCT_VENDOR     = BRAND.companyName;
export const PRODUCT_SIGNATURE  = BRAND.productSignature;
export const PRODUCT_BRAND_COLOR = TELUN_COLORS.electricLilac;
export const SUPPORT_EMAIL      = BRAND.supportEmail;
export const COPYRIGHT =
  `© ${new Date().getFullYear()} ${BRAND.companyName}. Todos os direitos reservados.`;

export default BRAND;
