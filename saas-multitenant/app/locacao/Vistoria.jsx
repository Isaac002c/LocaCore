'use client';

// Vistoria (§8) — checklist de retirada/devolução, reutilizável. Armazenado como
// JSONB na própria locação (rentals.pickup_inspection / return_inspection).

export const FUEL_LEVELS = ['vazio', '1/4', '1/2', '3/4', 'cheio'];
export const CONDITIONS = [
  ['otimo', 'Ótimo'], ['bom', 'Bom'], ['regular', 'Regular'], ['ruim', 'Ruim'],
];
export const ACCESSORIES = [
  ['estepe', 'Estepe'], ['macaco', 'Macaco'], ['chave_roda', 'Chave de roda'],
  ['triangulo', 'Triângulo'], ['extintor', 'Extintor'], ['documento', 'Documento (CRLV)'],
  ['tapetes', 'Tapetes'],
];

export const EMPTY_VISTORIA = { fuel: '', condition: '', items: {}, notes: '' };

// True quando a vistoria tem algum dado preenchido (evita salvar JSON vazio).
export const vistoriaHasContent = (v) =>
  !!v && (!!v.fuel || !!v.condition || !!(v.notes && String(v.notes).trim()) || Object.values(v.items || {}).some(Boolean));

const condLabel = (c) => CONDITIONS.find(([v]) => v === c)?.[1] || c || '—';

// Formulário compacto. value = objeto vistoria; onChange recebe o objeto atualizado.
export function VistoriaFields({ value = EMPTY_VISTORIA, onChange }) {
  const v = { ...EMPTY_VISTORIA, ...value, items: { ...(value?.items || {}) } };
  const set = (patch) => onChange({ ...v, ...patch });
  const toggle = (key) => onChange({ ...v, items: { ...v.items, [key]: !v.items[key] } });
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>Vistoria</div>
      <div className="form-row">
        <div className="form-group"><label>Combustível</label><select value={v.fuel} onChange={(e) => set({ fuel: e.target.value })}><option value="">—</option>{FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
        <div className="form-group"><label>Estado geral</label><select value={v.condition} onChange={(e) => set({ condition: e.target.value })}><option value="">—</option>{CONDITIONS.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '6px 0 10px' }}>
        {ACCESSORIES.map(([key, l]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!v.items[key]} onChange={() => toggle(key)} />{l}
          </label>
        ))}
      </div>
      <div className="form-group"><label>Avarias / observações da vistoria</label><textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Riscos, amassados, faltas..." /></div>
    </div>
  );
}

// Visualização read-only. data = objeto vistoria (ou null).
export function VistoriaView({ data, title = 'Vistoria' }) {
  const d = typeof data === 'string' ? safeParse(data) : data;
  if (!vistoriaHasContent(d)) return null;
  const present = ACCESSORIES.filter(([k]) => d.items && d.items[k]).map(([, l]) => l);
  const missing = ACCESSORIES.filter(([k]) => d.items && d.items[k] === false).map(([, l]) => l);
  return (
    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{title}</div>
      {d.fuel && <span style={{ marginRight: 12 }}>Combustível: <strong>{d.fuel}</strong></span>}
      {d.condition && <span>Estado: <strong>{condLabel(d.condition)}</strong></span>}
      {present.length > 0 && <div style={{ color: '#15803d' }}>✓ {present.join(', ')}</div>}
      {missing.length > 0 && <div style={{ color: '#b91c1c' }}>✗ Faltando: {missing.join(', ')}</div>}
      {d.notes && <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{d.notes}</div>}
    </div>
  );
}

function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
