'use client';

import { useState, useEffect } from 'react';
import { getAllContracts } from '../lib/contractsAPI';

const STATUS_COLORS = {
  'APRS DEFESA PREVIA':      '#6366f1',
  'DEFESA PREVIA - ANALISE': '#8b5cf6',
  'APRS 1 INSTANCIA':        '#f59e0b',
  '1 INSTANCIA - ANALISE':   '#f97316',
  'APRS 2 INSTANCIA':        '#ef4444',
  '2 INSTANCIA - ANALISE':   '#dc2626',
};

const SERVICE_TYPES = ['CRCI', 'MULTA', 'SUSPENSAO', 'CASSACAO', 'REVISAO DE ATOS'];
const ORGANS = ['DETRAN', 'DER', 'DNIT', 'SMTR', 'RENAINF', 'PMRJ', 'PRF', 'PREFEITURA UF'];

const PAGE_SIZE = 20;

export default function MultasHistory() {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [page, setPage]           = useState(1);
  const [filters, setFilters]     = useState({ status: '', serviceType: '', organ: '', days: '30' });

  useEffect(() => { loadContracts(); }, []);

  const loadContracts = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getAllContracts();
      setContracts(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => { setFilters({ status: '', serviceType: '', organ: '', days: '30' }); setPage(1); };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(filters.days || 30));

  const filteredContracts = contracts.filter(c => {
    const matchStatus      = !filters.status      || c.status === filters.status;
    const matchServiceType = !filters.serviceType || (c.service_name || '').toUpperCase() === filters.serviceType.toUpperCase();
    const matchOrgan       = !filters.organ       || (c.organ || '').toUpperCase() === filters.organ.toUpperCase();
    const matchDate        = !c.created_at        || new Date(c.created_at) >= cutoff;
    return matchStatus && matchServiceType && matchOrgan && matchDate;
  });

  const totalPages = Math.max(1, Math.ceil(filteredContracts.length / PAGE_SIZE));
  const paginated  = filteredContracts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const allStatuses = [...new Set(contracts.map(c => c.status).filter(Boolean))];

  if (loading) return (
    <div className="loading-container">
      <div className="loading-spinner"></div>
      <p>Carregando historico...</p>
    </div>
  );

  return (
    <div className="multas-history">

      {/* Filtros */}
      <div className="filters-section">
        <div className="filter-group">
          <label>Andamento</label>
          <select value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}>
            <option value="">Todos</option>
            {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Tipo de Servico</label>
          <select value={filters.serviceType} onChange={(e) => { setFilters({ ...filters, serviceType: e.target.value }); setPage(1); }}>
            <option value="">Todos</option>
            {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Orgao</label>
          <select value={filters.organ} onChange={(e) => { setFilters({ ...filters, organ: e.target.value }); setPage(1); }}>
            <option value="">Todos</option>
            {ORGANS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Periodo</label>
          <select value={filters.days} onChange={(e) => { setFilters({ ...filters, days: e.target.value }); setPage(1); }}>
            <option value="7">Ultimos 7 dias</option>
            <option value="30">Ultimos 30 dias</option>
            <option value="90">Ultimos 90 dias</option>
            <option value="365">Ultimo ano</option>
          </select>
        </div>
        <button onClick={clearFilters} className="btn-reset">Limpar</button>
      </div>

      {/* Erro */}
      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      {/* Resumo */}
      <div style={{ marginBottom: 16, color: '#6b7280', fontSize: 14 }}>
        {filteredContracts.length} contrato{filteredContracts.length !== 1 ? 's' : ''} encontrado{filteredContracts.length !== 1 ? 's' : ''}
      </div>

      {/* Lista */}
      <div className="activity-list">
        {paginated.length === 0 ? (
          <div className="empty-state">
            <p>Nenhum contrato encontrado no periodo</p>
          </div>
        ) : (
          paginated.map((contract) => (
            <div key={contract.id} className="activity-card">
              <div
                className="activity-icon"
                style={{
                  backgroundColor: `${STATUS_COLORS[contract.status] || '#6b7280'}20`,
                  color: STATUS_COLORS[contract.status] || '#6b7280',
                  minWidth: 36, height: 36, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700
                }}
              >
                {contract.service_name?.[0] || 'C'}
              </div>
              <div className="activity-content" style={{ flex: 1 }}>
                <div className="activity-header" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {contract.client_name || 'Cliente'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    â€¢ {contract.service_name || '-'}
                  </span>
                  {contract.organ && (
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      â€¢ {contract.organ}
                    </span>
                  )}
                  {contract.numero_multa && (
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      â€¢ N {contract.numero_multa}
                    </span>
                  )}
                  {contract.vehicle_plate && (
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      â€¢ {contract.vehicle_plate}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    background: STATUS_COLORS[contract.status] ? `${STATUS_COLORS[contract.status]}20` : 'var(--surface-secondary)',
                    color: STATUS_COLORS[contract.status] || 'var(--text-secondary)',
                  }}>
                    {contract.status || '-'}
                  </span>
                </div>
                <div className="activity-meta" style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12, color: '#9ca3af' }}>
                  <span>ðŸ• {formatDate(contract.created_at)}</span>
                  {contract.updated_at && contract.updated_at !== contract.created_at && (
                    <span>Atualizado: {formatDate(contract.updated_at)}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Paginacao */}
      {totalPages > 1 && (
        <div className="pagination" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 24, justifyContent: 'center' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-pagination">
            â† Anterior
          </button>
          <span className="page-info">Pagina {page} de {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-pagination">
            Proxima â†’
          </button>
        </div>
      )}
    </div>
  );
}
