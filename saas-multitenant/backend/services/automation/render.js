// =============================================================================
// render.js — Renderização de templates ({{var}}) e montagem das variáveis.
// =============================================================================

const fmtMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const fmtDate = (v) => {
  if (!v) return '';
  const s = typeof v === 'string' ? v.substring(0, 10) : new Date(v).toISOString().substring(0, 10);
  const [y, m, d] = s.split('-');
  return (y && m && d) ? `${d}/${m}/${y}` : '';
};

// Substitui {{chave}} pelos valores; devolve { text, missing[] }.
function render(body, vars = {}) {
  const missing = [];
  const text = String(body || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => {
    const val = vars[key];
    if (val === undefined || val === null || val === '') { missing.push(key); return ''; }
    return String(val);
  });
  return { text, missing };
}

// Variáveis padrão a partir de rental/charge/payment/document.
// `document` traz o link e o número do recibo/NFS-e (§25 template "Documento").
function buildVars({ rental, charge, payment, document } = {}) {
  const veic = rental ? [rental.vehicle_brand, rental.vehicle_model].filter(Boolean).join(' ') : '';
  const periodo = charge && charge.period_start && charge.period_end
    ? `${fmtDate(charge.period_start)} a ${fmtDate(charge.period_end)}`
    : (rental && rental.start_date ? `${fmtDate(rental.start_date)}${rental.end_date ? ` a ${fmtDate(rental.end_date)}` : ''}` : '');
  return {
    nome_cliente: (rental && (rental.client_name)) || (charge && charge.client_name) || 'cliente',
    nome: (rental && (rental.client_name)) || (charge && charge.client_name) || 'cliente',
    numero_locacao: (rental && rental.rental_number) || '',
    veiculo: veic + (rental && rental.vehicle_plate ? ` (${rental.vehicle_plate})` : ''),
    placa: (rental && rental.vehicle_plate) || '',
    periodo,
    valor: fmtMoney((charge && charge.amount) || (rental && rental.total_amount) || 0),
    vencimento: fmtDate(charge && charge.due_date),
    codigo_pix: (charge && charge.pix_code) || '',
    favorecido_pix: (charge && charge.provider_metadata && charge.provider_metadata.receiver_name) || '',
    payment_link: (charge && charge.payment_link) || '',
    data_pagamento: fmtDate((payment && payment.payment_date) || new Date()),
    document_link: (document && (document.link || document.document_link)) || '',
    document_numero: (document && (document.numero || document.number || document.full_number)) || '',
    document_tipo: (document && document.tipo) || '',
  };
}

module.exports = { render, buildVars, fmtMoney, fmtDate };
