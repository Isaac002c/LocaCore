'use client';

// =============================================================================
// Faturamentos — tela de GESTÃO de cobranças.
// Indicadores no topo (respeitam os filtros), tabela enxuta, detalhe em painel
// lateral (drawer) com pagamentos/recibos/histórico e ação principal evidente.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getBillings, getBillingStats, getBilling, createBilling, updateBilling, cancelBilling,
  registerPayment, cancelPayment, issueReceipt, receiptPdfUrl,
  BILLING_STATUS, BILLING_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
} from '../../lib/financialAPI';
import { getClients } from '../../lib/clientsAPI';
import { getFinesByClient } from '../../lib/finesAPI';
import {
  formatBRL, formatDate, isAdmin, AccessDenied, StatusBadge, Feedback,
  maskMoney, moneyToNumber, numberToMask, toInputDate,
} from './financeShared';
import {
  PageHead, MetricCard, Drawer, ConfirmDialog, Pagination,
  SkeletonRows, Skeleton, EmptyState, ErrorState, FormSection,
} from '../../components/ui';

const EMPTY = {
  client_id: '', fine_id: '', description: '', original_amount: '', discount: '', surcharge: '',
  installments: '1', due_date: '', payment_method: '', notes: '',
};

const finalPreview = (f) =>
  moneyToNumber(f.original_amount) - moneyToNumber(f.discount) + moneyToNumber(f.surcharge);

export default function Faturamentos() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [filters, setFilters] = useState({ financial_status: '', client_id: '', search: '', date_from: '', date_to: '', page: 1 });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmCancelBilling, setConfirmCancelBilling] = useState(false);
  const [busyCancel, setBusyCancel] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const query = { ...filters, limit: 20 };
      const [res, statsRes] = await Promise.all([
        getBillings(query),
        getBillingStats(query).catch(() => null),
      ]);
      setRows(res.data || []);
      setPagination(res.pagination || { page: 1, pages: 1, total: 0 });
      setStats(statsRes);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => {
    if (!isAdmin()) { setLoading(false); return; }
    getClients().then((c) => setClients(c || [])).catch(() => {});
  }, []);
  useEffect(() => { if (isAdmin()) load(); }, [load]);

  if (!isAdmin()) return <AccessDenied />;

  const setFilter = (k) => (e) => setFilters((p) => ({ ...p, [k]: e.target.value, page: 1 }));
  const hasFilters = filters.financial_status || filters.client_id || filters.search || filters.date_from || filters.date_to;

  const openDetail = async (b) => {
    setDetailId(b.id); setDetail(null); setLoadingDetail(true);
    try { setDetail(await getBilling(b.id)); }
    catch (e) { setError(e.message); setDetailId(null); }
    finally { setLoadingDetail(false); }
  };
  const refreshDetail = async () => {
    if (detailId) { try { setDetail(await getBilling(detailId)); } catch (_) { /* mantém estado */ } }
    load();
  };
  const closeDetail = () => { setDetailId(null); setDetail(null); setConfirmCancelBilling(false); };

  const doCancelBilling = async () => {
    try {
      setBusyCancel(true);
      await cancelBilling(detailId);
      setFeedback({ type: 'success', message: 'Faturamento cancelado (preservado no histórico).' });
      closeDetail(); load();
    } catch (err) { setError(err.message); setConfirmCancelBilling(false); }
    finally { setBusyCancel(false); }
  };

  return (
    <div className="clients-page">
      <Feedback {...(feedback || {})} onClose={() => setFeedback(null)} />
      <PageHead
        title="Faturamentos"
        subtitle="Cobranças por processo ou serviço — os indicadores respeitam os filtros aplicados"
        actions={<button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ Novo faturamento</button>}
      />

      {error && (
        <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span>{error}</span><button onClick={() => setError(null)} className="btn-close" aria-label="Fechar erro">✕</button>
        </div>
      )}

      {/* Indicadores (respeitam os filtros) */}
      {loading && !stats ? (
        <div className="nx-kpi-grid">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={92} />)}</div>
      ) : stats && (
        <div className="nx-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <MetricCard title="Faturado" value={formatBRL(stats.faturado)} subtitle={`${stats.total_count} faturamento${stats.total_count !== 1 ? 's' : ''}`} tooltip="Total faturado no filtro atual" />
          <MetricCard title="Recebido" value={formatBRL(stats.recebido)} tooltip="Total já pago dos faturamentos filtrados" />
          <MetricCard title="Pendente" value={formatBRL(stats.pendente)} tooltip="Saldo a receber — não é receita" />
          <MetricCard title="Vencido" value={formatBRL(stats.vencido)} tooltip="Saldo vencido — prioridade de cobrança" />
        </div>
      )}

      {/* Filtros */}
      <div className="nx-filterbar">
        <div className="clients-search" style={{ flex: '1 1 220px' }}>
          <input type="text" placeholder="Buscar por cliente ou descrição..." value={filters.search}
            onChange={setFilter('search')} className="clients-search-input" aria-label="Buscar" />
        </div>
        <select value={filters.financial_status} onChange={setFilter('financial_status')} className="clients-filter-select" aria-label="Status">
          <option value="">Todos os status</option>
          {BILLING_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.client_id} onChange={setFilter('client_id')} className="clients-filter-select" aria-label="Cliente">
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label style={{ fontSize: 12.5, color: 'var(--nx-ink-2)', fontWeight: 600 }}>
          De <input type="date" value={filters.date_from} onChange={setFilter('date_from')} />
        </label>
        <label style={{ fontSize: 12.5, color: 'var(--nx-ink-2)', fontWeight: 600 }}>
          até <input type="date" value={filters.date_to} onChange={setFilter('date_to')} />
        </label>
        {hasFilters && (
          <button className="btn-secondary" onClick={() => setFilters({ financial_status: '', client_id: '', search: '', date_from: '', date_to: '', page: 1 })}>
            Limpar
          </button>
        )}
      </div>

      {loading ? <SkeletonRows rows={6} height={52} /> : rows.length === 0 ? (
        <EmptyState
          title="Nenhum faturamento encontrado"
          description={hasFilters ? 'Nenhum faturamento corresponde aos filtros. Ajuste o período ou o status.' : 'Crie o primeiro faturamento para começar a controlar as cobranças.'}
          actionLabel="Criar faturamento"
          onAction={() => { setEditing(null); setShowForm(true); }}
        />
      ) : (
        <>
          <div className="clients-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th><th>Processo / serviço</th>
                  <th style={{ textAlign: 'right' }}>Valor final</th>
                  <th style={{ textAlign: 'right' }}>Pago</th>
                  <th style={{ textAlign: 'right' }}>Saldo</th>
                  <th>Vencimento</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} onClick={() => openDetail(b)} className="clickable-row">
                    <td><strong style={{ color: 'var(--nx-ink)' }}>{b.client_name || '—'}</strong></td>
                    <td style={{ color: 'var(--nx-ink-2)' }}>
                      {b.description || '—'}
                      {b.fine_number && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--nx-muted)' }}>Proc. {b.fine_number}</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatBRL(b.final_amount)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--nx-green)' }}>{formatBRL(b.paid_amount)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--nx-amber)' }}>{formatBRL(Number(b.final_amount) - Number(b.paid_amount))}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--nx-ink-2)' }}>{b.due_date ? formatDate(b.due_date) : '—'}</td>
                    <td><StatusBadge status={b.financial_status} label={BILLING_STATUS_LABELS[b.financial_status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={pagination.page} pages={pagination.pages} total={pagination.total}
            onPage={(page) => setFilters((p) => ({ ...p, page }))} />
        </>
      )}

      {/* Formulário criar/editar (modal com seções) */}
      {showForm && (
        <BillingForm
          editing={editing}
          clients={clients}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={(msg) => {
            setShowForm(false); setEditing(null);
            setFeedback({ type: 'success', message: msg });
            load(); if (detailId) refreshDetail();
          }}
        />
      )}

      {/* Detalhe em drawer */}
      <Drawer
        open={!!detailId}
        title={detail ? (detail.client_name || 'Faturamento') : 'Faturamento'}
        subtitle={detail ? [detail.description, detail.fine_number && `Processo ${detail.fine_number}`].filter(Boolean).join(' · ') : ''}
        onClose={closeDetail}
        footer={detail && detail.financial_status !== 'cancelado' && (
          <>
            {detail.client_id && (
              <button className="btn-secondary" onClick={() => router.push(`/multas/clients/${detail.client_id}`)}>Abrir cliente</button>
            )}
            {Number(detail.paid_amount) === 0 && (
              <>
                <button className="btn-secondary" onClick={() => { setEditing(detail); setShowForm(true); }}>Editar</button>
                <button
                  className="btn-secondary"
                  style={{ color: 'var(--nx-red)', borderColor: 'rgba(185,28,28,.35)' }}
                  onClick={() => setConfirmCancelBilling(true)}
                >
                  Cancelar faturamento
                </button>
              </>
            )}
          </>
        )}
      >
        {loadingDetail || !detail ? <SkeletonRows rows={5} height={56} /> : (
          <BillingDetailBody
            detail={detail}
            onChanged={refreshDetail}
            setFeedback={setFeedback}
            setError={setError}
          />
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmCancelBilling}
        title="Cancelar faturamento"
        message="O faturamento será marcado como cancelado e preservado no histórico. Esta ação não apaga registros."
        confirmLabel="Cancelar faturamento"
        danger requireReason={false}
        busy={busyCancel}
        onConfirm={doCancelBilling}
        onClose={() => setConfirmCancelBilling(false)}
      />
    </div>
  );
}

// ── Formulário de faturamento (seções lógicas + validação em tempo real) ─────
function BillingForm({ editing, clients, onClose, onSaved }) {
  const [form, setForm] = useState(() => editing ? {
    client_id: editing.client_id || '', fine_id: editing.fine_id || '', description: editing.description || '',
    original_amount: numberToMask(editing.original_amount), discount: numberToMask(editing.discount),
    surcharge: numberToMask(editing.surcharge), installments: String(editing.installments || 1),
    due_date: toInputDate(editing.due_date), payment_method: editing.payment_method || '', notes: editing.notes || '',
  } : EMPTY);
  const [fines, setFines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (form.client_id) getFinesByClient(form.client_id).then((f) => setFines(f || [])).catch(() => setFines([]));
    else setFines([]);
  }, [form.client_id]);

  const set = (k) => (e) => {
    let v = e.target.value;
    if (['original_amount', 'discount', 'surcharge'].includes(k)) v = maskMoney(v);
    setForm((p) => ({ ...p, [k]: v }));
  };

  const finalValue = finalPreview(form);
  const finalNegative = finalValue < 0;

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!form.client_id && !form.fine_id) return setFormError('Selecione um cliente ou processo.');
    if (finalNegative) return setFormError('Valor final não pode ser negativo — reduza o desconto.');
    try {
      setSaving(true);
      const payload = {
        client_id: form.client_id || undefined, fine_id: form.fine_id || undefined,
        description: form.description,
        original_amount: moneyToNumber(form.original_amount),
        discount: moneyToNumber(form.discount), surcharge: moneyToNumber(form.surcharge),
        installments: parseInt(form.installments, 10) || 1,
        due_date: form.due_date || undefined, payment_method: form.payment_method || undefined,
        notes: form.notes,
      };
      if (editing) { await updateBilling(editing.id, payload); onSaved('Faturamento atualizado.'); }
      else { await createBilling(payload); onSaved('Faturamento criado.'); }
    } catch (err) { setFormError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editing ? 'Editar faturamento' : 'Novo faturamento'}>
        <div className="modal-header">
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>{editing ? 'Editar faturamento' : 'Novo faturamento'}</h2>
            <p style={{ fontSize: 12, color: 'var(--nx-muted)', marginTop: 2 }}>
              {editing ? 'Recalcula valor final e status automaticamente' : 'Fature um serviço ou processo para controlar a cobrança'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-close" aria-label="Fechar">✕</button>
        </div>

        {formError && <div className="error-message" style={{ margin: '0 0 12px', fontSize: 13 }} role="alert">{formError}</div>}

        <form onSubmit={submit} className="modal-form">
          <FormSection title="Identificação">
            <div className="form-row">
              <div className="form-group">
                <label>Cliente <span className="nx-required">*</span></label>
                <select value={form.client_id} onChange={set('client_id')} disabled={!!editing}>
                  <option value="">Selecione...</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.cpf ? ` — ${c.cpf}` : ''}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Processo (opcional)</label>
                <select value={form.fine_id} onChange={set('fine_id')} disabled={!!editing}>
                  <option value="">—</option>
                  {fines.map((f) => <option key={f.id} value={f.id}>{f.fine_number || f.plate || f.organ || f.id.slice(0, 8)}</option>)}
                </select>
                {!editing && <div className="nx-help">Vincule ao processo para o histórico aparecer na página dele.</div>}
              </div>
            </div>
            <div className="form-group">
              <label>Descrição do serviço</label>
              <input type="text" value={form.description} onChange={set('description')} placeholder="Ex.: Defesa prévia de multa" />
            </div>
          </FormSection>

          <FormSection title="Valores">
            <div className="form-row">
              <div className="form-group">
                <label>Valor original (R$)</label>
                <input type="text" inputMode="numeric" value={form.original_amount} onChange={set('original_amount')} placeholder="0,00" />
              </div>
              <div className="form-group">
                <label>Desconto (R$)</label>
                <input type="text" inputMode="numeric" value={form.discount} onChange={set('discount')} placeholder="0,00" />
              </div>
              <div className="form-group">
                <label>Acréscimo (R$)</label>
                <input type="text" inputMode="numeric" value={form.surcharge} onChange={set('surcharge')} placeholder="0,00" />
              </div>
            </div>
            <div style={{
              padding: '10px 12px', background: finalNegative ? 'rgba(185,28,28,.07)' : 'var(--nx-bg)',
              border: `1px solid ${finalNegative ? 'rgba(185,28,28,.3)' : 'var(--nx-border)'}`,
              borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ color: 'var(--nx-ink-2)', fontWeight: 600, fontSize: 13 }}>Valor final</span>
              <strong style={{ color: finalNegative ? 'var(--nx-red)' : 'var(--nx-ink)', fontSize: 16 }}>{formatBRL(finalValue)}</strong>
            </div>
            {finalNegative && <div className="nx-field-error">O desconto é maior que o valor original.</div>}
          </FormSection>

          <FormSection title="Pagamento">
            <div className="form-row">
              <div className="form-group">
                <label>Nº de parcelas</label>
                <input type="number" min="1" value={form.installments} onChange={set('installments')} />
              </div>
              <div className="form-group">
                <label>Vencimento</label>
                <input type="date" value={form.due_date} onChange={set('due_date')} />
              </div>
              <div className="form-group">
                <label>Forma prevista</label>
                <select value={form.payment_method} onChange={set('payment_method')}>
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </FormSection>

          <FormSection title="Observações">
            <div className="form-group">
              <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Informações complementares (opcional)" aria-label="Observações" />
            </div>
          </FormSection>

          <div className="form-actions">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving || finalNegative}>
              {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar faturamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Corpo do drawer: composição do valor, pagamentos, recibos, novo pagamento ─
function BillingDetailBody({ detail, onChanged, setFeedback, setError }) {
  const [pay, setPay] = useState({
    amount: '', payment_method: detail.payment_method || '', installment_number: '1',
    installments_total: String(detail.installments || 1), is_deposit: false,
    payment_date: new Date().toISOString().substring(0, 10), notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [confirmPayCancel, setConfirmPayCancel] = useState(null);
  const [busyPayCancel, setBusyPayCancel] = useState(false);

  const balance = Number(detail.final_amount || 0) - Number(detail.paid_amount || 0);
  const canPay = !['pago', 'cancelado'].includes(detail.financial_status) && balance > 0;

  // Pré-visualização em tempo real: saldo restante e novo status após o pagamento.
  const payValue = moneyToNumber(pay.amount);
  const remaining = Math.max(0, Math.round((balance - payValue) * 100) / 100);
  const overpay = payValue > balance + 0.001;
  const nextStatus = payValue <= 0 ? null : remaining <= 0 ? 'pago' : 'parcialmente_pago';

  const setP = (k) => (e) => {
    let v = k === 'is_deposit' ? e.target.checked : e.target.value;
    if (k === 'amount') v = maskMoney(v);
    setPay((p) => ({ ...p, [k]: v }));
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    if (payValue <= 0) { setError('Informe um valor de pagamento válido.'); return; }
    if (overpay) { setError('Valor maior que o saldo pendente.'); return; }
    try {
      setBusy(true);
      await registerPayment({
        billing_id: detail.id, amount: payValue,
        payment_method: pay.payment_method || undefined,
        installment_number: parseInt(pay.installment_number, 10) || 1,
        installments_total: parseInt(pay.installments_total, 10) || 1,
        is_deposit: pay.is_deposit, payment_date: pay.payment_date, notes: pay.notes,
      });
      setPay((p) => ({ ...p, amount: '', notes: '' }));
      setFeedback({ type: 'success', message: 'Pagamento registrado — entrada criada no caixa. Você já pode emitir o recibo.' });
      onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const doCancelPayment = async (reason) => {
    try {
      setBusyPayCancel(true);
      await cancelPayment(confirmPayCancel.id, reason);
      setConfirmPayCancel(null);
      setFeedback({ type: 'success', message: 'Pagamento cancelado. Valores recalculados.' });
      onChanged();
    } catch (err) { setError(err.message); setConfirmPayCancel(null); }
    finally { setBusyPayCancel(false); }
  };

  const emitReceipt = async (p) => {
    try {
      const rec = await issueReceipt({ payment_id: p.id });
      setFeedback({ type: 'success', message: `Recibo ${rec.full_number} emitido.` });
      window.open(receiptPdfUrl(rec.id), '_blank');
      onChanged();
    } catch (err) { setError(err.message); }
  };

  return (
    <>
      {/* Composição do valor */}
      <FormSection title="Composição do valor">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          <InfoTile label="Original" value={formatBRL(detail.original_amount)} />
          <InfoTile label="Desconto" value={`− ${formatBRL(detail.discount)}`} />
          <InfoTile label="Acréscimo" value={`+ ${formatBRL(detail.surcharge)}`} />
          <InfoTile label="Final" value={formatBRL(detail.final_amount)} strong />
          <InfoTile label="Pago" value={formatBRL(detail.paid_amount)} color="var(--nx-green)" />
          <InfoTile label="Saldo" value={formatBRL(balance)} color={balance > 0 ? 'var(--nx-amber)' : 'var(--nx-green)'} strong />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <StatusBadge status={detail.financial_status} label={BILLING_STATUS_LABELS[detail.financial_status]} />
          {detail.due_date && <span style={{ fontSize: 12.5, color: 'var(--nx-ink-2)' }}>Vencimento: <strong>{formatDate(detail.due_date)}</strong></span>}
          {detail.installments > 1 && <span style={{ fontSize: 12.5, color: 'var(--nx-ink-2)' }}>{detail.installments} parcelas</span>}
          {detail.payment_method && <span style={{ fontSize: 12.5, color: 'var(--nx-ink-2)' }}>{PAYMENT_METHOD_LABELS[detail.payment_method]}</span>}
        </div>
        {detail.notes && <p style={{ fontSize: 12.5, color: 'var(--nx-ink-2)', marginTop: 8 }}>{detail.notes}</p>}
      </FormSection>

      {/* Registrar pagamento — ação principal */}
      {canPay && (
        <FormSection title="Registrar pagamento">
          <form onSubmit={submitPayment}>
            <div className="form-row">
              <div className="form-group">
                <label>Valor (R$) <span className="nx-required">*</span></label>
                <input type="text" inputMode="numeric" value={pay.amount} onChange={setP('amount')} placeholder="0,00" required />
                {overpay && <div className="nx-field-error">Maior que o saldo de {formatBRL(balance)}.</div>}
              </div>
              <div className="form-group">
                <label>Forma de pagamento</label>
                <select value={pay.payment_method} onChange={setP('payment_method')}>
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Data</label>
                <input type="date" value={pay.payment_date} onChange={setP('payment_date')} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Parcela nº</label>
                <input type="number" min="1" value={pay.installment_number} onChange={setP('installment_number')} />
              </div>
              <div className="form-group">
                <label>Total de parcelas</label>
                <input type="number" min="1" value={pay.installments_total} onChange={setP('installments_total')} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={pay.is_deposit} onChange={setP('is_deposit')} style={{ width: 'auto' }} /> É sinal
                </label>
              </div>
            </div>

            {/* Pré-visualização imediata */}
            {payValue > 0 && !overpay && (
              <div style={{
                display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
                background: 'var(--nx-bg)', border: '1px solid var(--nx-border)',
                borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontSize: 12.5,
              }}>
                <span>Saldo restante: <strong style={{ color: remaining > 0 ? 'var(--nx-amber)' : 'var(--nx-green)' }}>{formatBRL(remaining)}</strong></span>
                <span>Novo status: <StatusBadge status={nextStatus} label={BILLING_STATUS_LABELS[nextStatus]} /></span>
                <span style={{ color: 'var(--nx-muted)' }}>Após confirmar, você poderá emitir o recibo.</span>
              </div>
            )}

            <div className="form-actions" style={{ marginTop: 0 }}>
              <button type="submit" className="btn-primary" disabled={busy || overpay || payValue <= 0}>
                {busy ? 'Registrando...' : 'Registrar pagamento'}
              </button>
            </div>
          </form>
        </FormSection>
      )}

      {/* Pagamentos e parcelas */}
      <FormSection title={`Pagamentos e parcelas (${(detail.payments || []).length})`}>
        {(detail.payments || []).length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--nx-muted)' }}>Nenhum pagamento registrado ainda.</p>
        ) : (
          <div className="clients-table-wrap">
            <table className="data-table">
              <thead><tr><th>Data</th><th>Parcela</th><th>Forma</th><th style={{ textAlign: 'right' }}>Valor</th><th>Status</th><th style={{ width: 96 }}>Ações</th></tr></thead>
              <tbody>
                {detail.payments.map((p) => (
                  <tr key={p.id} style={{ opacity: p.status === 'cancelado' ? 0.5 : 1 }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(p.payment_date)}</td>
                    <td>{p.is_deposit ? 'Sinal' : `${p.installment_number}/${p.installments_total}`}</td>
                    <td>{PAYMENT_METHOD_LABELS[p.payment_method] || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatBRL(p.amount)}</td>
                    <td><StatusBadge status={p.status === 'confirmado' ? 'pago' : 'cancelado'} label={p.status === 'confirmado' ? 'Confirmado' : 'Cancelado'} /></td>
                    <td>
                      {p.status === 'confirmado' && (
                        <div className="actions-cell">
                          {p.receipt_id
                            ? <button className="btn-icon" title="Ver recibo (PDF)" aria-label="Ver recibo" onClick={() => window.open(receiptPdfUrl(p.receipt_id), '_blank')}>🧾</button>
                            : <button className="btn-icon" title="Emitir recibo" aria-label="Emitir recibo" onClick={() => emitReceipt(p)}>+🧾</button>}
                          <button className="btn-icon danger" title="Cancelar pagamento" aria-label="Cancelar pagamento" onClick={() => setConfirmPayCancel(p)}>✕</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FormSection>

      {/* Recibos vinculados */}
      <FormSection title={`Recibos (${(detail.receipts || []).length})`}>
        {(detail.receipts || []).length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--nx-muted)' }}>Nenhum recibo emitido para este faturamento.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.receipts.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, opacity: r.status === 'cancelado' ? 0.6 : 1 }}>
                <strong style={{ fontFamily: 'monospace' }}>{r.full_number}</strong>
                <span style={{ color: 'var(--nx-ink-2)' }}>{formatDate(r.issue_date)} · {formatBRL(r.amount)}</span>
                <StatusBadge status={r.status} label={r.status === 'emitido' ? 'Emitido' : 'Cancelado'} />
                <button className="btn-icon" title="Ver PDF" aria-label="Ver PDF do recibo" onClick={() => window.open(receiptPdfUrl(r.id), '_blank')}>👁</button>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <ConfirmDialog
        open={!!confirmPayCancel}
        title="Cancelar pagamento"
        message={confirmPayCancel ? `Cancelar o pagamento de ${formatBRL(confirmPayCancel.amount)}? O faturamento e o caixa serão recalculados; o registro permanece no histórico.` : ''}
        confirmLabel="Cancelar pagamento"
        danger requireReason reasonLabel="Motivo do cancelamento"
        busy={busyPayCancel}
        onConfirm={doCancelPayment}
        onClose={() => setConfirmPayCancel(null)}
      />
    </>
  );
}

function InfoTile({ label, value, color, strong }) {
  return (
    <div style={{ background: 'var(--nx-bg)', border: '1px solid var(--nx-border)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--nx-muted)', textTransform: 'uppercase', letterSpacing: '.3px' }}>{label}</div>
      <div style={{ fontSize: strong ? 15 : 13.5, fontWeight: strong ? 800 : 600, color: color || 'var(--nx-ink)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
