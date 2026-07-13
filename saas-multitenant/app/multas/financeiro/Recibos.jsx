'use client';

// =============================================================================
// Recibos — gestão de emissão, reemissão e cancelamento.
// Cancelar exige confirmação + motivo obrigatório (fica no histórico e no PDF).
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getReceipts, cancelReceipt, reissueReceipt, receiptPdfUrl,
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
} from '../../lib/financialAPI';
import { formatBRL, formatDate, isAdmin, AccessDenied, StatusBadge, Feedback } from './financeShared';
import { PageHead, Pagination, SkeletonRows, EmptyState, ConfirmDialog, Drawer } from '../../components/ui';

export default function Recibos() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [filters, setFilters] = useState({ status: '', payment_method: '', search: '', date_from: '', date_to: '', page: 1 });
  const [viewing, setViewing] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [confirmReissue, setConfirmReissue] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await getReceipts({ ...filters, limit: 20 });
      setRows(res.data || []);
      setPagination(res.pagination || { page: 1, pages: 1, total: 0 });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { if (isAdmin()) load(); else setLoading(false); }, [load]);
  if (!isAdmin()) return <AccessDenied />;

  const setF = (k) => (e) => setFilters((p) => ({ ...p, [k]: e.target.value, page: 1 }));
  const openPdf = (r, download = false) => window.open(receiptPdfUrl(r.id, download), '_blank');
  const hasFilters = filters.status || filters.payment_method || filters.search || filters.date_from || filters.date_to;

  const doCancel = async (reason) => {
    try {
      setBusy(true);
      await cancelReceipt(confirmCancel.id, reason);
      setConfirmCancel(null); setViewing(null);
      setFeedback({ type: 'success', message: 'Recibo cancelado — permanece visível no histórico.' });
      load();
    } catch (err) { setError(err.message); setConfirmCancel(null); }
    finally { setBusy(false); }
  };

  const doReissue = async () => {
    try {
      setBusy(true);
      const rec = await reissueReceipt(confirmReissue.id);
      setConfirmReissue(null); setViewing(null);
      setFeedback({ type: 'success', message: `Recibo reemitido como ${rec.full_number}.` });
      load();
      window.open(receiptPdfUrl(rec.id), '_blank');
    } catch (err) { setError(err.message); setConfirmReissue(null); }
    finally { setBusy(false); }
  };

  return (
    <div className="clients-page">
      <Feedback {...(feedback || {})} onClose={() => setFeedback(null)} />
      <PageHead
        title="Recibos"
        subtitle="Recibos são emitidos a partir de pagamentos confirmados (Faturamentos ou Pagamentos)"
        actions={<button className="btn-primary" onClick={() => router.push('/dashboard?module=financeiro&tab=pagamentos')}>Ir para Pagamentos</button>}
      />

      {error && (
        <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span>{error}</span><button onClick={() => setError(null)} className="btn-close" aria-label="Fechar erro">✕</button>
        </div>
      )}

      <div className="nx-filterbar">
        <div className="clients-search" style={{ flex: '1 1 200px' }}>
          <input type="text" placeholder="Buscar por número ou cliente..." value={filters.search}
            onChange={setF('search')} className="clients-search-input" aria-label="Buscar recibo" />
        </div>
        <select value={filters.status} onChange={setF('status')} className="clients-filter-select" aria-label="Status">
          <option value="">Todos</option>
          <option value="emitido">Emitidos</option>
          <option value="cancelado">Cancelados</option>
        </select>
        <select value={filters.payment_method} onChange={setF('payment_method')} className="clients-filter-select" aria-label="Forma de pagamento">
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
          <button className="btn-secondary" onClick={() => setFilters({ status: '', payment_method: '', search: '', date_from: '', date_to: '', page: 1 })}>
            Limpar
          </button>
        )}
      </div>

      {loading ? <SkeletonRows rows={6} height={52} /> : rows.length === 0 ? (
        <EmptyState
          title="Nenhum recibo encontrado"
          description={hasFilters ? 'Nenhum recibo corresponde aos filtros selecionados.' : 'Emita o primeiro recibo a partir de um pagamento confirmado.'}
          actionLabel="Abrir Pagamentos"
          onAction={() => router.push('/dashboard?module=financeiro&tab=pagamentos')}
        />
      ) : (
        <>
          <div className="clients-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Número</th><th>Data</th><th>Cliente</th><th>Processo</th><th>Forma</th>
                  <th style={{ textAlign: 'right' }}>Valor</th><th>Status</th><th style={{ width: 170 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setViewing(r)} className="clickable-row" style={{ opacity: r.status === 'cancelado' ? 0.6 : 1 }}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.full_number}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.issue_date)}</td>
                    <td style={{ color: 'var(--nx-ink-2)' }}>{r.client_name || '—'}</td>
                    <td style={{ color: 'var(--nx-ink-2)' }}>{r.fine_number || '—'}</td>
                    <td style={{ color: 'var(--nx-ink-2)' }}>{PAYMENT_METHOD_LABELS[r.payment_method] || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatBRL(r.amount)}</td>
                    <td><StatusBadge status={r.status} label={r.status === 'emitido' ? 'Emitido' : 'Cancelado'} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="actions-cell">
                        <button className="btn-icon" title="Ver / imprimir PDF" aria-label="Ver PDF" onClick={() => openPdf(r)}>👁</button>
                        <button className="btn-icon" title="Baixar PDF" aria-label="Baixar PDF" onClick={() => openPdf(r, true)}>⬇</button>
                        {r.status === 'emitido' && <button className="btn-icon" title="Reemitir (cancela e gera novo número)" aria-label="Reemitir" onClick={() => setConfirmReissue(r)}>↻</button>}
                        {r.status === 'emitido' && <button className="btn-icon danger" title="Cancelar recibo" aria-label="Cancelar recibo" onClick={() => setConfirmCancel(r)}>✕</button>}
                      </div>
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

      {/* Detalhe do recibo (drawer) */}
      <Drawer
        open={!!viewing}
        title={viewing ? `Recibo ${viewing.full_number}` : ''}
        subtitle={viewing ? `Emitido em ${formatDate(viewing.issue_date)}${viewing.issued_by_name || viewing.created_by_name ? ` · por ${viewing.issued_by_name || viewing.created_by_name}` : ''}` : ''}
        onClose={() => setViewing(null)}
        footer={viewing && (
          <>
            {viewing.billing_id && (
              <button className="btn-secondary" onClick={() => router.push('/dashboard?module=financeiro&tab=faturamentos')}>Abrir faturamentos</button>
            )}
            <button className="btn-secondary" onClick={() => openPdf(viewing, true)}>Baixar PDF</button>
            <button className="btn-primary" onClick={() => openPdf(viewing)}>Ver / Imprimir</button>
          </>
        )}
      >
        {viewing && (
          <>
            {viewing.status === 'cancelado' && (
              <div className="error-message" style={{ marginBottom: 14 }} role="status">
                Recibo cancelado{viewing.cancel_reason ? ` — motivo: ${viewing.cancel_reason}` : ''}. Mantido no histórico.
              </div>
            )}
            <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
              <Row label="Cliente" value={viewing.client_name} />
              <Row label="CPF/CNPJ" value={viewing.client_document} />
              <Row label="Serviço" value={viewing.service_description} />
              <Row label="Processo" value={viewing.fine_number} />
              <Row label="Valor" value={formatBRL(viewing.amount)} />
              <Row label="Forma de pagamento" value={PAYMENT_METHOD_LABELS[viewing.payment_method] || viewing.payment_method} />
              <Row label="Emitente" value={viewing.issuer_name} />
              <Row label="Responsável" value={viewing.issued_by_name || viewing.created_by_name} />
              {viewing.notes && <Row label="Observações" value={viewing.notes} />}
            </div>
            {viewing.status === 'emitido' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn-secondary" onClick={() => setConfirmReissue(viewing)}>↻ Reemitir</button>
                <button className="btn-secondary" style={{ color: 'var(--nx-red)', borderColor: 'rgba(185,28,28,.35)' }} onClick={() => setConfirmCancel(viewing)}>
                  Cancelar recibo
                </button>
              </div>
            )}
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!confirmCancel}
        title={`Cancelar recibo ${confirmCancel?.full_number || ''}`}
        message="O recibo será marcado como cancelado, permanecerá visível no histórico e o PDF passará a indicar o cancelamento. Para corrigir dados, use a reemissão."
        confirmLabel="Cancelar recibo"
        danger requireReason reasonLabel="Motivo do cancelamento"
        busy={busy}
        onConfirm={doCancel}
        onClose={() => setConfirmCancel(null)}
      />

      <ConfirmDialog
        open={!!confirmReissue}
        title={`Reemitir recibo ${confirmReissue?.full_number || ''}`}
        message="O recibo atual será cancelado e um novo será emitido com o próximo número da sequência, mantendo os dados do pagamento."
        confirmLabel="Reemitir"
        busy={busy}
        onConfirm={doReissue}
        onClose={() => setConfirmReissue(null)}
      />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--nx-border)', paddingBottom: 6 }}>
      <span style={{ color: 'var(--nx-muted)' }}>{label}</span>
      <span style={{ color: 'var(--nx-ink)', fontWeight: 600, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  );
}
