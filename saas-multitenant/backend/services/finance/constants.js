// =============================================================================
// Constantes canônicas do módulo financeiro (fonte da verdade do backend).
// Os valores aqui DEVEM casar com os CHECKs das migrations e com o frontend.
// =============================================================================

const TRANSACTION_TYPES = ['entrada', 'saida'];

const TRANSACTION_STATUSES = [
  'previsto', 'pendente', 'pago', 'recebido', 'vencido', 'cancelado',
];

const BILLING_STATUSES = [
  'nao_faturado', 'faturado', 'parcialmente_pago', 'pago', 'vencido', 'cancelado',
];

const PAYMENT_STATUSES = ['confirmado', 'cancelado'];

const RECEIPT_STATUSES = ['emitido', 'cancelado'];

const PAYMENT_METHODS = [
  'pix', 'dinheiro', 'cartao_credito', 'cartao_debito',
  'boleto', 'transferencia', 'outro',
];

const PAYMENT_METHOD_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  outro: 'Outro',
};

const TRANSACTION_ORIGINS = ['manual', 'pagamento', 'sistema'];

// Categorias iniciais criadas (idempotentemente) por tenant no primeiro acesso.
const DEFAULT_CATEGORIES = [
  { name: 'Pagamento de serviço',      type: 'entrada' },
  { name: 'Sinal',                     type: 'entrada' },
  { name: 'Parcela',                   type: 'entrada' },
  { name: 'Outros recebimentos',       type: 'entrada' },
  { name: 'Taxas',                     type: 'saida'   },
  { name: 'Custas',                    type: 'saida'   },
  { name: 'Despesas administrativas',  type: 'saida'   },
  { name: 'Pagamentos',                type: 'saida'   },
  { name: 'Outras despesas',           type: 'saida'   },
];

// Identidade institucional do PRODUTO — fonte única do backend (espelha
// app/lib/brand.js no frontend).
//   EMPRESA TELUN · PRODUTO LocaCore · ASSINATURA "Um produto TELUN"
// Usada como fallback quando o tenant (a locadora) não tem branding próprio.
// A locadora é a OPERADORA da locação; a TELUN é a FORNECEDORA da plataforma.
const DEFAULT_BRANDING = {
  name:           process.env.PRODUCT_NAME      || 'LocaCore',
  signature:      process.env.PRODUCT_SIGNATURE || 'Um produto TELUN',
  company:        process.env.PLATFORM_COMPANY_NAME || 'TELUN',
  operator:       process.env.PLATFORM_OPERATOR_NAME || 'TELUN',
  support_email:  process.env.SUPPORT_EMAIL     || 'suporte@telun.com.br',
  website:        process.env.PLATFORM_WEBSITE  || '',
  receipt_prefix: process.env.RECEIPT_PREFIX    || 'LOCA',
  colors: {
    cosmic: '#0B0B12', deepViolet: '#3B1F6A', electricLilac: '#A56BFF',
    luminousCopper: '#FF8A3D', sandGold: '#FFD8A6',
  },
};

module.exports = {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  BILLING_STATUSES,
  PAYMENT_STATUSES,
  RECEIPT_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_ORIGINS,
  DEFAULT_CATEGORIES,
  DEFAULT_BRANDING,
};
