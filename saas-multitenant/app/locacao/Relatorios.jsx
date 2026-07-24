'use client';

import { useState, useEffect, useCallback } from 'react';
import { getRevenue, getRentalsReport, getFleetUtilization, revenueCsvUrl, rentalsCsvUrl } from '../lib/reportsAPI';
import { apiRequest } from '../lib/api';
import { fmtMoney, fmtDate, RENTAL_STATUS, rentalStatusLabel } from './shared';

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().substring(0, 10); };
const todayISO = () => new Date().toISOString().substring(0, 10);

const TABS = [['revenue', 'Faturamento'], ['rentals', 'Locações'], ['fleet', 'Frota']];

// Exporta CSV autenticado (o proxy /api injeta o token; usamos fetch p/ baixar blob).
async function downloadCsv(url, filename) {
  try {
    const res = await apiRequest(url, { raw: true });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  } catch (_) { window.open(url, '_blank'); }
}

export default function Relatorios() {
  const [tab, setTab] = useState('revenue');
  const [range, setRange] = useState({ from: monthStart(), to: todayISO() });
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      if (tab === 'revenue') setData(await getRevenue(range));
      else if (tab === 'rentals') setData(await getRentalsReport({ ...range, status }));
      else setData(await getFleetUtilization());
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [tab, range.from, range.to, status]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="clients-page">
      <div className="clients-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(([v, l]) => (
            <button key={v} className={tab === v ? 'btn-primary' : 'btn-secondary'} style={{ padding: '5px 14px' }} onClick={() => setTab(v)}>{l}</button>
          ))}
        </div>
        {tab !== 'fleet' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="clients-search-input" style={{ width: 150 }} />
            <span style={{ color: '#94a3b8' }}>até</span>
            <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="clients-search-input" style={{ width: 150 }} />
          </div>
        )}
        {tab === 'rentals' && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="clients-search-input" style={{ width: 160 }}>
            <option value="">Todos os status</option>
            {RENTAL_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        {tab === 'revenue' && <button className="btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => downloadCsv(revenueCsvUrl(range), 'faturamento.csv')}>Exportar CSV</button>}
        {tab === 'rentals' && <button className="btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => downloadCsv(rentalsCsvUrl({ ...range, status }), 'locacoes.csv')}>Exportar CSV</button>}
      </div>

      {error && <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}><span>{error}</span><button className="btn-close" onClick={() => setError(null)}>✕</button></div>}

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>Carregando...</div>
      ) : tab === 'revenue' ? (
        <RevenueTable data={data} />
      ) : tab === 'rentals' ? (
        <RentalsTable data={data} />
      ) : (
        <FleetView data={data} />
      )}
    </div>
  );
}

function RevenueTable({ data }) {
  if (!data) return null;
  return (
    <>
      <div className="clients-summary" style={{ marginBottom: 14 }}>
        <div className="clients-summary-card fechado"><span className="summary-number" style={{ fontSize: 20 }}>{fmtMoney(data.totals?.faturado || 0)}</span><span className="summary-label">Faturado</span></div>
        <div className="clients-summary-card all"><span className="summary-number" style={{ fontSize: 20 }}>{fmtMoney(data.totals?.recebido || 0)}</span><span className="summary-label">Recebido</span></div>
      </div>
      <div className="clients-table-wrap"><table className="data-table">
        <thead><tr><th>Data</th><th>Locação</th><th>Cliente</th><th>Placa</th><th>Faturado</th><th>Recebido</th><th>Status</th></tr></thead>
        <tbody>
          {(!data.rows || data.rows.length === 0) ? <tr><td colSpan="7"><div className="empty-state" style={{ padding: '40px 0' }}><p style={{ color: '#94a3b8' }}>Sem faturamento no período</p></div></td></tr>
            : data.rows.map((r) => (
              <tr key={r.id}><td>{fmtDate(r.data)}</td><td>{r.rental_number || '—'}</td><td>{r.client_name || '—'}</td><td>{r.vehicle_plate || '—'}</td><td>{fmtMoney(r.final_amount)}</td><td>{fmtMoney(r.paid_amount)}</td><td>{r.financial_status || '—'}</td></tr>
            ))}
        </tbody>
      </table></div>
    </>
  );
}

function RentalsTable({ data }) {
  if (!data) return null;
  return (
    <>
      <div className="clients-summary" style={{ marginBottom: 14 }}>
        <div className="clients-summary-card all"><span className="summary-number">{data.rows?.length || 0}</span><span className="summary-label">Locações</span></div>
        <div className="clients-summary-card fechado"><span className="summary-number" style={{ fontSize: 20 }}>{fmtMoney(data.total || 0)}</span><span className="summary-label">Total</span></div>
      </div>
      <div className="clients-table-wrap"><table className="data-table">
        <thead><tr><th>Locação</th><th>Status</th><th>Início</th><th>Fim</th><th>Cliente</th><th>Placa</th><th>Total</th></tr></thead>
        <tbody>
          {(!data.rows || data.rows.length === 0) ? <tr><td colSpan="7"><div className="empty-state" style={{ padding: '40px 0' }}><p style={{ color: '#94a3b8' }}>Nenhuma locação no período</p></div></td></tr>
            : data.rows.map((r, i) => (
              <tr key={i}><td><strong>{r.rental_number || '—'}</strong></td><td>{rentalStatusLabel(r.status)}</td><td>{fmtDate(r.start_date)}</td><td>{fmtDate(r.end_date)}</td><td>{r.client_name || '—'}</td><td>{r.vehicle_plate || '—'}</td><td>{fmtMoney(r.total_amount)}</td></tr>
            ))}
        </tbody>
      </table></div>
    </>
  );
}

function FleetView({ data }) {
  if (!data) return null;
  const LABELS = { disponivel: 'Disponíveis', alugado: 'Alugados', manutencao: 'Manutenção', inativo: 'Inativos' };
  return (
    <>
      <div className="clients-summary" style={{ marginBottom: 14 }}>
        <div className="clients-summary-card all"><span className="summary-number">{data.total || 0}</span><span className="summary-label">Veículos</span></div>
        <div className="clients-summary-card fechado"><span className="summary-number">{data.taxa_ocupacao ?? 0}%</span><span className="summary-label">Taxa de ocupação</span></div>
      </div>
      <div className="clients-table-wrap"><table className="data-table">
        <thead><tr><th>Status</th><th>Veículos</th><th>%</th></tr></thead>
        <tbody>
          {(data.rows || []).map((r) => (
            <tr key={r.status}><td>{LABELS[r.status] || r.status}</td><td>{r.n}</td><td>{data.total ? Math.round((Number(r.n) / data.total) * 100) : 0}%</td></tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
