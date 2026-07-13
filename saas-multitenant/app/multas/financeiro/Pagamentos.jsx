'use client';

// =============================================================================
// Pagamentos — gestão de todos os pagamentos registrados (parcelas, sinais).
// Registrar um pagamento acontece no contexto do Faturamento (ação principal lá);
// aqui é a visão transversal: filtrar, conferir, emitir recibo e cancelar.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getPayments, cancelPayment, issueReceipt, receiptPdfUrl,
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
} from '../../lib/financialAPI';
import { formatBRL, formatDate, isAdmin, AccessDenied, StatusBadge, Feedback } from './financeShared';
import { PageHead, Pagination, SkeletonRows, EmptyState, ErrorState, ConfirmDialog } from '../../components/ui';

export default function Pagamentos() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [filters, setFilters] = useState({ status: '', payment_method: '', date_from: '', date_to: '', page: 1 });
  const [confirmCancel, setConfirmCancel] = useState(null); // payment a cancelar
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await getPayments({ ...filters, limit: 20 });
      setRows(res.data || []);
      setPagination(res.pagination || { page: 1, pages: 1, total: 0 });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { if (isAdmin()) load(); else setLoading(false); }, [load]);
  if (!isAdmin()) return <AccessDenied />;

  const setF = (key) => (e) => setFilters((p) => ({ ...p, [key]: e.target.value, page: 1 }));

  const doCancel = async (reason) => {
    try {
      setBusy(true);
      await cancelPayment(confirmCancel.id, reason);
      setConfirmCancel(null);
      setFeedback({ type: 'success', message: 'Pagamento cancelado. Faturamento e caixa recalculados.' });
      load();
    } catch (err) { setError(err.message); setConfirmCancel(null); }
    finally { setBusy(false); }
  };

  const emitReceipt = async (p) => {
    try {
      const rec = await issueReceipt({ payment_id: p.id });
      setFeedback({ type: 'success', message: `Recibo ${rec.full_number} emitido.` });
      window.open(receiptPdfUrl(rec.id), '_blank');
      load();
    } catch (err) { setError(err.message); }
  };

  const hasFilters = filters.status || filters.payment_method || filters.date_from || filters.date_to;

  return (
    <div className="clients-page">
      <Feedback {...(feedback || {})} onClose={() => setFeedback(null)} />
      <PageHead
        title="Pagamentos"
        subtitle="Pagamentos registrados — para registrar um novo, abra o faturamento correspondente"
        actions={<button className="btn-primary" onClick={() => router.push('/dashboard?module=financeiro&tab=faturamentos')}>Ir para Faturamentos</button>}
      />

      {error && (
        <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span>{error}</span><button onClick={() => setError(null)} className="btn-close" aria-label="Fechar erro">✕</button>
        </div>
      )}

      <div className="nx-filterbar">
        <select value={filters.status} onChange={setF('status')} className="clients-filter-select" aria-label="Filtrar por status">
          <option value="">Todos os status</option>
          <option value="confirmado">Confirmados</option>
          <option value="cancelado">Cancelados</option>
        </select>
        <select value={filters.payment_method} onChange={setF('payment_method')} className="clients-filter-select" aria-label="Filtrar por forma de pagamento">
          <option value="">Todas as formas</option>
          {PAYMENT_METHODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label style={{ fontSize: 12.5, color: 'var(--nx-ink-2)', fontWeight: 600 }}>
          De <input type="date" value={filters.date_from} onChange={setF('date_from')} />
        </label>
        <label style={{ fontSize: 12.5, color: 'var(--nx-ink-2)', fontWeight: 600 }}>
          até <input type="date" value={filters.date_to} onChange={setF('date_to')} />
        </label>
        {hasFilters && (
          <button className="btn-secondary" onClick={() => setFilters({ status: '', payment_method: '', date_from: '', date_to: '', page: 1 })}>
            Limpar filtros
          </button>
        )}
      </div>

      {loading ? <SkeletonRows rows={6} height={52} /> : rows.length === 0 ? (
        <EmptyState
          title="Nenhum pagamento encontrado"
          description={hasFilters ? 'Nenhum pagamento corresponde aos filtros selecionados.' : 'Os pagamentos aparecem aqui quando você os registra em um faturamento.'}
          actionLabel="Abrir Faturamentos"
          onAction={() => router.push('/dashboard?module=financeiro&tab=faturamentos')}
        />
      ) : (
        <>
          <div className="clients-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th><th>Cliente</th><th>Processo</th><th>Parcela</th><th>Forma</th>
                  <th style={{ textAlign: 'right' }}>Valor</th><th>Status</th><th style={{ width: 120 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} style={{ opacity: p.status === 'cancelado' ? 0.55 : 1 }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(p.payment_date)}</td>
                    <td><strong style={{ color: 'var(--nx-ink)' }}>{p.client_name || '—'}</strong></td>
                    <td style={{ color: 'var(--nx-ink-2)' }}>{p.fine_number || '—'}</td>
                    <td style={{ color: 'var(--nx-ink-2)' }}>{p.is_deposit ? 'Sinal' : `${p.installment_number}/${p.installments_total}`}</td>
                    <td style={{ color: 'var(--nx-ink-2)' }}>{PAYMENT_METHOD_LABELS[p.payment_method] || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--nx-green)' }}>{formatBRL(p.amount)}</td>
                    <td><StatusBadge status={p.status === 'confirmado' ? 'pago' : 'cancelado'} label={p.status === 'confirmado' ? 'Confirmado' : 'Cancelado'} /></td>
                    <td>
                      {p.status === 'confirmado' && (
                        <div className="actions-cell">
                          {p.receipt_id
                            ? <button className="btn-icon" title="Ver recibo (PDF)" aria-label="Ver recibo" onClick={() => window.open(receiptPdfUrl(p.receipt_id), '_blank')}>🧾</button>
                            : <button className="btn-icon" title="Emitir recibo" aria-label="Emitir recibo" onClick={() => emitReceipt(p)}>+🧾</button>}
                          <button className="btn-icon danger" title="Cancelar pagamento" aria-label="Cancelar pagamento" onClick={() => setConfirmCancel(p)}>✕</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={pagination.page} pages={pagination.pages} total={pagination.total}
            onPage={(page) => setFilters((p) => ({ ...p, page }))} />
        </>
      )}

      <ConfirmDialog
        open={!!confirmCancel}
        title="Cancelar pagamento"
        message={confirmCancel ? `Cancelar o pagamento de ${formatBRL(confirmCancel.amount)} de ${confirmCancel.client_name || 'cliente'}? O faturamento e a entrada no caixa serão recalculados. O registro permanece no histórico.` : ''}
        confirmLabel="Cancelar pagamento"
        danger requireReason reasonLabel="Motivo do cancelamento"
        busy={busy}
        onConfirm={doCancel}
        onClose={() => setConfirmCancel(null)}
      />
    </div>
  );
}
