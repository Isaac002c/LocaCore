// =============================================================================
// rentalContractPdf.js — Contrato de locação em PDF (§7). Reutiliza o MESMO
// motor (PDFKit) e helpers do recibo. Dados reais de tenant/cliente/veículo/
// locação/valores. Cláusulas configuráveis por tenant. Sem 2ª biblioteca.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { formatBRL, formatDateBR } = require('./calc');
const { DEFAULT_BRANDING } = require('./constants');

const COLORS = { ink: '#0f172a', muted: '#64748b', line: '#cbd5e1' };

function resolveLogoPath(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string' || /^https?:\/\//i.test(logoUrl)) return null;
  const clean = logoUrl.replace(/^\/+/, '');
  for (const p of [path.join(__dirname, '../../../public', clean), path.join(__dirname, '../../uploads', clean)]) {
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (_) { /* ignore */ }
  }
  return null;
}

// data: { rental, client, vehicle, extras[], contract, settings, branding }
function buildRentalContractPdf(data = {}) {
  // eslint-disable-next-line global-require
  const PDFDocument = require('pdfkit');
  const { rental = {}, client = {}, vehicle = {}, extras = [], contract = {}, settings = {}, branding = {} } = data;

  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 56, left: 50, right: 50 } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const L = doc.page.margins.left;
  const hr = () => { doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1).strokeColor(COLORS.line).stroke(); doc.moveDown(0.6); };
  const field = (label, value) => { doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text(label, { continued: true }); doc.font('Helvetica').fillColor(COLORS.ink).text('  ' + (value == null || value === '' ? '—' : String(value))); };

  // ── Cabeçalho ────────────────────────────────────────────────────────────────
  const logo = resolveLogoPath(branding.logo_url);
  let hx = L;
  if (logo) { try { doc.image(logo, L, doc.y, { fit: [80, 52] }); hx = L + 92; } catch (_) { /* ignore */ } }
  const top = doc.y;
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(14).text(branding.name || DEFAULT_BRANDING.name, hx, top, { width: W - (hx - L) });
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted);
  if (settings.header) doc.text(settings.header, hx, doc.y, { width: W - (hx - L) });
  if (branding.document) doc.text(`CNPJ/CPF: ${branding.document}`, hx);
  doc.y = Math.max(doc.y, top + 54); doc.moveDown(0.3);
  hr();

  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.ink).text('CONTRATO DE LOCAÇÃO DE VEÍCULO', { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(`${contract.number || ''}  ·  Locação ${rental.rental_number || ''}`, { align: 'center' });
  doc.moveDown(0.6); hr();

  // ── Partes / veículo / período ───────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.ink).text('LOCATÁRIO'); doc.moveDown(0.1);
  field('Nome:', client.name); field('CPF/CNPJ:', client.cpf); field('CNH:', client.cnh); field('Telefone:', client.phone); field('Endereço:', client.address);
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.ink).text('VEÍCULO'); doc.moveDown(0.1);
  field('Marca/Modelo:', `${vehicle.brand || ''} ${vehicle.model || ''}`.trim()); field('Placa:', vehicle.plate); field('Ano/Cor:', `${vehicle.year || ''} ${vehicle.color || ''}`.trim()); field('RENAVAM:', vehicle.renavam); field('Hodômetro (retirada):', rental.pickup_odometer != null ? rental.pickup_odometer : vehicle.odometer);
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.ink).text('PERÍODO E VALORES'); doc.moveDown(0.1);
  field('Retirada:', formatDateBR(rental.start_date)); field('Devolução prevista:', formatDateBR(rental.end_date));
  field('Diária:', `${formatBRL(rental.daily_rate)}  ×  ${rental.days} diária(s)`);
  if (Number(rental.discount_amount) > 0) field('Desconto:', formatBRL(rental.discount_amount));
  if (extras && extras.length) { doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text('Adicionais:'); extras.forEach((e) => doc.font('Helvetica').fillColor(COLORS.ink).text(`  • ${e.category || 'Extra'} — ${formatBRL(e.total_amount)}`)); }
  field('Caução:', formatBRL(rental.deposit_amount));
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text(`VALOR ESTIMADO: ${formatBRL(rental.total_amount)}`);
  doc.moveDown(0.5); hr();

  // ── Cláusulas ────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.ink).text('CONDIÇÕES'); doc.moveDown(0.2);
  const clauses = (settings.clauses || '').split('\n').filter((s) => s.trim());
  doc.font('Helvetica').fontSize(8.7).fillColor(COLORS.ink);
  clauses.forEach((c) => { doc.text(c, { width: W, align: 'justify' }); doc.moveDown(0.2); });
  if (settings.footer) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(settings.footer, { width: W }); }

  // ── Assinaturas ──────────────────────────────────────────────────────────────
  doc.moveDown(2);
  const y = doc.y; const colW = (W - 30) / 2;
  doc.moveTo(L, y).lineTo(L + colW, y).lineWidth(1).strokeColor(COLORS.ink).stroke();
  doc.moveTo(L + colW + 30, y).lineTo(L + W, y).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
    .text('LOCADORA', L, y + 4, { width: colW, align: 'center' })
    .text('LOCATÁRIO', L + colW + 30, y + 4, { width: colW, align: 'center' });

  const footerY = doc.page.height - doc.page.margins.bottom + 8;
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
    .text(`Documento operacional gerado pelo ${DEFAULT_BRANDING.name} · ${DEFAULT_BRANDING.signature} — não substitui contrato jurídico definitivo.`, L, footerY, { width: W, align: 'center' });

  doc.end();
  return done;
}

module.exports = { buildRentalContractPdf };
