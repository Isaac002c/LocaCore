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

// Variáveis padrão a partir de rental/charge/payment.
function buildVars({ rental, charge, payment } = {}) {
  const veic = rental ? [rental.vehicle_brand, rental.vehicle_model].filter(Boolean).join(' ') : '';
  return {
    nome_cliente: (rental && (rental.client_name)) || (charge && charge.client_name) || 'cliente',
    numero_locacao: (rental && rental.rental_number) || '',
    veiculo: veic + (rental && rental.vehicle_plate ? ` (${rental.vehicle_plate})` : ''),
    placa: (rental && rental.vehicle_plate) || '',
    valor: fmtMoney((charge && charge.amount) || (rental && rental.total_amount) || 0),
    vencimento: fmtDate(charge && charge.due_date),
    codigo_pix: (charge && charge.pix_code) || '',
    data_pagamento: fmtDate((payment && payment.payment_date) || new Date()),
  };
}

module.exports = { render, buildVars, fmtMoney, fmtDate };
