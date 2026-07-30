'use client';

import { useState, useEffect } from 'react';
import { getClientFinance, receiptPdfUrl, BILLING_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '../../lib/financialAPI';
import { formatBRL, formatDate, StatusBadge } from './financeShared';

// Seção de histórico financeiro na página do cliente (somente admin).
// Falha em silêncio se o backend negar acesso.
export default function ClientFinanceSection({ clientId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    getClientFinance(clientId)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setFailed(true); setLoading(false); });
  }, [clientId]);

  if (failed) return null;

  return (
    <div className="cd-services-section" style={{ marginTop: 24 }}>
      <div className="cd-services-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="cd-services-title">Financeiro</h2>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', padding: '16px 0' }}>Carregando dados financeiros...</p>
      ) : !data ? null : (
        <>
          <div className="clients-summary" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 16 }}>
            <Tile label="Total faturado" value={formatBRL(data.summary.total_billed)} />
            <Tile label="Pago" value={formatBRL(data.summary.total_paid)} color="#15803d" />
            <Tile label="Saldo pendente" value={formatBRL(data.summary.total_pending)} color="#b45309" />
            <Tile label="Faturamentos" value={data.summary.total_billings} />
          </div>

          <Block title="Faturamentos">
            {data.billings.length === 0 ? <Empty /> : (
              <table className="data-table">
                <thead><tr><th>Descrição</th><th>Processo</th><th style={{ textAlign: 'right' }}>Final</th><th style={{ textAlign: 'right' }}>Pago</th><th>Status</th></tr></thead>
                <tbody>
                  {data.billings.map((b) => (
                    <tr key={b.id}>
                      <td style={{ color: 'var(--text-secondary)' }}>{b.description || '—'}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{b.fine_number || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatBRL(b.final_amount)}</td>
                      <td style={{ textAlign: 'right', color: '#15803d' }}>{formatBRL(b.paid_amount)}</td>
                      <td><StatusBadge status={b.financial_status} label={BILLING_STATUS_LABELS[b.financial_status]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Block>

          <Block title="Pagamentos e parcelas">
            {data.payments.length === 0 ? <Empty /> : (
              <table className="data-table">
                <thead><tr><th>Data</th><th>Parcela</th><th>Forma</th><th style={{ textAlign: 'right' }}>Valor</th><th>Status</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id} style={{ opacity: p.status === 'cancelado' ? 0.5 : 1 }}>
                      <td>{formatDate(p.payment_date)}</td>
                      <td>{p.is_deposit ? 'Sinal' : `${p.installment_number}/${p.installments_total}`}</td>
                      <td>{PAYMENT_METHOD_LABELS[p.payment_method] || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatBRL(p.amount)}</td>
                      <td><StatusBadge status={p.status === 'confirmado' ? 'pago' : 'cancelado'} label={p.status === 'confirmado' ? 'Confirmado' : 'Cancelado'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Block>

          <Block title="Recibos">
            {data.receipts.length === 0 ? <Empty /> : (
              <table className="data-table">
                <thead><tr><th>Número</th><th>Data</th><th style={{ textAlign: 'right' }}>Valor</th><th>Status</th><th>PDF</th></tr></thead>
                <tbody>
                  {data.receipts.map((r) => (
                    <tr key={r.id} style={{ opacity: r.status === 'cancelado' ? 0.6 : 1 }}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.full_number}</td>
                      <td>{formatDate(r.issue_date)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatBRL(r.amount)}</td>
                      <td><StatusBadge status={r.status} label={r.status === 'emitido' ? 'Emitido' : 'Cancelado'} /></td>
                      <td><button className="btn-icon" title="Ver PDF" onClick={() => window.open(receiptPdfUrl(r.id), '_blank')}>👁</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Block>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, color = 'var(--text-primary)' }) {
  return (
    <div className="clients-summary-card">
      <span className="summary-number" style={{ fontSize: 17, color }}>{value}</span>
      <span className="summary-label">{label}</span>
    </div>
  );
}
function Block({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '10px 0' }}>{title.toUpperCase()}</h3>
      <div className="clients-table-wrap">{children}</div>
    </div>
  );
}
function Empty() {
  return <div className="empty-state" style={{ padding: '20px 0' }}><p style={{ color: 'var(--text-muted)' }}>Nenhum registro</p></div>;
}
