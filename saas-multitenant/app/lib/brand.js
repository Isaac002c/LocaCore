// =============================================================================
// brand.js — Identidade institucional do PRODUTO (LocaCore, fornecido pela TELUN).
//
// Centraliza a marca do produto em um único lugar (nada de "Nexos"/"Chronostek"
// espalhado no código). A identidade OPERACIONAL de cada tenant (a locadora) vem
// SEMPRE dos dados do tenant — name, logo_url, brand_color, tagline — e nunca é
// fixada aqui. Estes valores aparecem apenas em pontos institucionais do produto
// (login, rodapé, créditos), como manda o §14 do escopo.
// =============================================================================

export const PRODUCT_NAME      = 'LocaCore';
export const PRODUCT_TAGLINE   = 'Gestão de Locadora';
export const PRODUCT_VENDOR    = 'TELUN';
export const PRODUCT_SIGNATURE  = `um produto ${PRODUCT_VENDOR}`;
export const PRODUCT_BRAND_COLOR = '#16324f';
export const SUPPORT_EMAIL     = 'suporte@telun.com.br';
export const COPYRIGHT         = `© ${new Date().getFullYear()} ${PRODUCT_VENDOR}. Todos os direitos reservados.`;
