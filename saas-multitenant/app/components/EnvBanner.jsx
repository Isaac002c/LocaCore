'use client';

// Aviso visível fora de produção (§5). NEXT_PUBLIC_APP_ENV é injetado no build.
// Em 'production' não renderiza nada.
const ENV = process.env.NEXT_PUBLIC_APP_ENV || 'development';
const LABELS = { development: 'DESENVOLVIMENTO', local: 'LOCAL', test: 'TESTE', homologacao: 'HOMOLOGAÇÃO', homolog: 'HOMOLOGAÇÃO', staging: 'HOMOLOGAÇÃO' };
const COLORS = { development: 'var(--text-secondary)', local: 'var(--text-secondary)', test: '#7c3aed', homologacao: '#b45309', homolog: '#b45309', staging: '#b45309' };

export default function EnvBanner() {
  if (ENV === 'production') return null;
  const label = LABELS[ENV] || ENV.toUpperCase();
  const bg = COLORS[ENV] || 'var(--text-secondary)';
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: bg, color: '#fff', textAlign: 'center', fontSize: 12, fontWeight: 700,
      padding: '3px 8px', letterSpacing: '0.5px',
    }}>
      Ambiente: {label} — dados e integrações podem não ser reais.
    </div>
  );
}
