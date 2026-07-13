'use client';

// =============================================================================
// Caixa — tela operacional do movimento semanal.
// Navegação entre semanas, totais agregados no backend, comparação com a
// semana anterior e linha cronológica dos lançamentos (ícone + rótulo + badge,
// nunca dependendo apenas de cor).
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getCashbox, getCategories,
  TRANSACTION_STATUS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, TRANSACTION_STATUS_LABELS,
} from '../../lib/financialAPI';
import { formatBRL, formatDate, isAdmin, AccessDenied, StatusBadge } from './financeShared';
import { PageHead, Skeleton, EmptyState, ErrorState } from '../../components/ui';

// Variação % vs semana anterior (null = não comparável)
function delta(cur, prev) {
  const c = Number(cur) || 0; const p = Number(prev) || 0;
  if (p === 0) return c === 0 ? 0 : null;
  return Math.round(((c - p) / Math.abs(p)) * 100);
}

function SummaryTile({ label, value, color, prev, direction = 'up' }) {
  const d = prev !== undefined ? delta(value, prev) : undefined;
  let deltaEl = null;
  if (d !== undefined) {
    const growing = (d ?? 0) > 0;
    const good = direction === 'up' ? growing : !growing;
    const cls = d === null || d === 0 ? 'nx-kpi-delta--neutral' : good ? 'nx-kpi-delta--pos' : 'nx-kpi-delta--neg';
    deltaEl = (
      <span className={`nx-kpi-delta ${cls}`} title="Comparação com a semana anterior">
        {d === null ? 'novo' : `${d > 0 ? '↑' : d < 0 ? '↓' : '→'} ${Math.abs(d)}%`}
      </span>
    );
  }
  return (
    <div className="nx-kpi" style={{ borderTop: `3px solid ${color}` }}>
      <div className="nx-kpi-title">{label}</div>
      <div className="nx-kpi-value" style={{ fontSize: 18 }}>{value !== undefined ? formatBRL(value) : '—'}</div>
      {deltaEl}
    </div>
  );
}

const TX_ICONS = {
  entrada: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
    </svg>
  ),
  saida: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
    </svg>
  ),
};

export default function CaixaSemanal() {
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ type: '', category_id: '', status: '', payment_method: '' });

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await getCashbox({ week_offset: offset, ...filters, limit: 100 });
      setData(res);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [offset, filters]);

  useEffect(() => {
    if (!isAdmin()) { setLoading(false); return; }
    getCategories({ active: true }).then(setCategories).catch(() => {});
  }, []);
  useEffect(() => { if (isAdmin()) load(); }, [load]);

  if (!isAdmin()) return <AccessDenied />;

  const setF = (k) => (e) => setFilters((p) => ({ ...p, [k]: e.target.value }));
  const s = data?.summary || {};
  const prev = data?.previous || {};
  const range = data?.range;
  const go = (tab, extra = '') => router.push(`/dashboard?module=financeiro&tab=${tab}${extra}`);

  // Agrupa os lançamentos por dia para a visão cronológica.
  const byDay = new Map();
  for (const t of data?.transactions || []) {
    const key = String(t.transaction_date).slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  }
  const days = Array.from(byDay.keys()).sort();

  return (
    <div className="clients-page">
      <PageHead
        title="Caixa"
        subtitle={range ? `${formatDate(range.start)} — ${formatDate(range.end)} · segunda a domingo` : '—'}
        actions={
          <>
            <button className="btn-secondary" onClick={() => go('lancamentos')}>+ Nova entrada / saída</button>
            <button className="btn-primary" onClick={() => go('faturamentos')}>Registrar pagamento</button>
          </>
        }
      />

      {/* Navegação entre semanas */}
      <div className="nx-filterbar" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-secondary" onClick={() => setOffset((o) => o - 1)} aria-label="Semana anterior">← Anterior</button>
          <button className="btn-secondary" onClick={() => setOffset(0)} disabled={offset === 0}>Semana atual</button>
          <button className="btn-secondary" onClick={() => setOffset((o) => o + 1)} aria-label="Próxima semana">Próxima →</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filters.type} onChange={setF('type')} className="clients-filter-select" aria-label="Tipo">
            <option value="">Todos os tipos</option>
            <option value="entrada">Entradas</option>
            <option value="saida">Saídas</option>
          </select>
          <select value={filters.category_id} onChange={setF('category_id')} className="clients-filter-select" aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filters.status} onChange={setF('status')} className="clients-filter-select" aria-label="Status">
            <option value="">Todos os status</option>
            {TRANSACTION_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.payment_method} onChange={setF('payment_method')} className="clients-filter-select" aria-label="Forma de pagamento">
            <option value="">Todas as formas</option>
            {PAYMENT_METHODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          {/* Totais da semana (comparados com a anterior) */}
          {loading ? (
            <div className="nx-kpi-grid">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={92} />)}</div>
          ) : (
            <div className="nx-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <SummaryTile label="Entradas" value={s.total_entradas} prev={prev.total_entradas} color="var(--nx-green)" direction="up" />
              <SummaryTile label="Saídas" value={s.total_saidas} prev={prev.total_saidas} color="var(--nx-amber-chart)" direction="down" />
              <SummaryTile label="Saldo" value={s.saldo} prev={prev.saldo} color={Number(s.saldo) >= 0 ? 'var(--nx-navy)' : 'var(--nx-red)'} direction="up" />
              <SummaryTile label="Recebidos" value={s.recebidos} prev={prev.recebidos} color="var(--nx-green)" direction="up" />
              <SummaryTile label="Previstos / pendentes" value={s.pendentes} prev={prev.pendentes} color="var(--nx-amber)" direction="down" />
              <SummaryTile label="Vencidos" value={s.vencidos} prev={prev.vencidos} color="var(--nx-red)" direction="down" />
            </div>
          )}

          {/* Linha cronológica */}
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={56} />)}
            </div>
          ) : days.length === 0 ? (
            <EmptyState
              title="Nenhum lançamento nesta semana"
              description="Entradas e saídas do período aparecem aqui, incluindo as geradas automaticamente por pagamentos."
              actionLabel="Criar lançamento"
              onAction={() => go('lancamentos')}
            />
          ) : (
            <div style={{ border: '1px solid var(--nx-border)', borderRadius: 'var(--nx-radius)', overflow: 'hidden' }}>
              {days.map((day) => (
                <div key={day}>
                  <div style={{
                    padding: '7px 12px', background: 'var(--nx-bg)', borderBottom: '1px solid var(--nx-border)',
                    fontSize: 11.5, fontWeight: 800, color: 'var(--nx-ink-2)', letterSpacing: '.4px', textTransform: 'uppercase',
                  }}>
                    {formatDate(day)}
                  </div>
                  {byDay.get(day).map((t) => {
                    const entrada = t.type === 'entrada';
                    const cor = entrada ? 'var(--nx-green)' : 'var(--nx-amber)';
                    return (
                      <div key={t.id} className="nx-tx-row" style={{ opacity: t.status === 'cancelado' ? 0.55 : 1 }}>
                        <div className="nx-tx-icon" style={{ background: entrada ? 'rgba(21,128,61,.10)' : 'rgba(217,119,6,.12)', color: cor }} aria-hidden="true">
                          {TX_ICONS[t.type]}
                        </div>
                        <div className="nx-tx-main">
                          <div className="nx-tx-desc">
                            {t.description || t.category_name || (entrada ? 'Entrada' : 'Saída')}
                          </div>
                          <div className="nx-tx-meta">
                            <span>{entrada ? 'Entrada' : 'Saída'}</span>
                            {t.category_name && <span>· {t.category_name}</span>}
                            {t.client_name && <span>· {t.client_name}</span>}
                            {t.fine_number && <span>· Proc. {t.fine_number}</span>}
                            {t.payment_method && <span>· {PAYMENT_METHOD_LABELS[t.payment_method]}</span>}
                            <span>· {t.origin === 'pagamento' ? 'Automático (pagamento)' : 'Manual'}</span>
                          </div>
                        </div>
                        <StatusBadge status={t.status} label={TRANSACTION_STATUS_LABELS[t.status]} />
                        <div className="nx-tx-amount" style={{ color: entrada ? 'var(--nx-green)' : 'var(--nx-amber)' }}>
                          {entrada ? '+' : '−'} {formatBRL(t.amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
