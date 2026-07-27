'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getFinanceDashboard } from '../../lib/financialAPI';
import { formatBRL } from './financeShared';

// Faixa compacta de indicadores financeiros no Dashboard de Despachantes (admin).
// É uma leitura rápida — a gestão completa fica no módulo Financeiro.
// Falha em silêncio (não quebra o dashboard) se o usuário não tiver acesso.
export default function DashboardFinanceCards() {
  const router = useRouter();
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getFinanceDashboard().then(setD).catch(() => setFailed(true));
  }, []);

  if (failed || !d) return null;
  const go = (tab) => router.push(`/dashboard?module=financeiro&tab=${tab}`);

  const cards = [
    { t: 'ENTRADAS (SEMANA)', v: formatBRL(d.week.entradas), c: '#15803d', tab: 'caixa' },
    { t: 'SAÍDAS (SEMANA)', v: formatBRL(d.week.saidas), c: '#b45309', tab: 'caixa' },
    { t: 'SALDO (SEMANA)', v: formatBRL(d.week.saldo), c: d.week.saldo >= 0 ? '#16324f' : '#b91c1c', tab: 'caixa' },
    { t: 'RECEBIDO (MÊS)', v: formatBRL(d.month.recebidos), c: '#15803d', tab: 'visao' },
    { t: 'PENDENTE', v: formatBRL(d.month.pendentes), c: '#b45309', tab: 'faturamentos' },
    { t: 'VENCIDO', v: formatBRL(d.month.vencidos), c: '#b91c1c', tab: 'faturamentos' },
  ];

  return (
    <div className="md-section-card" style={{ marginTop: 16 }}>
      <div className="md-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="md-section-title">Financeiro (resumo)</h3>
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nx-primary)', fontWeight: 600, fontSize: 13 }}
          onClick={() => go('visao')}
        >
          Abrir Financeiro →
        </button>
      </div>
      <div className="md-section-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {cards.map((c) => (
            <div key={c.t} className="md-metric-card md-metric-card--clickable" style={{ '--accent': c.c }} onClick={() => go(c.tab)}>
              <div className="md-metric-inner">
                <div className="md-metric-body">
                  <span className="md-metric-title" style={{ fontSize: 11 }}>{c.t}</span>
                  <span className="md-metric-value" style={{ fontSize: 18 }}>{c.v}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
