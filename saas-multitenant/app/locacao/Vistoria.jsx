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
    <fieldset className="nx-vistoria">
      <legend>Vistoria de retirada</legend>
      <p className="nx-vistoria-hint">
        Registre o estado do veículo na entrega. Serve de prova na devolução.
      </p>
      <div className="form-row">
        <div className="form-group"><label>Combustível</label><select value={v.fuel} onChange={(e) => set({ fuel: e.target.value })}><option value="">—</option>{FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
        <div className="form-group"><label>Estado geral</label><select value={v.condition} onChange={(e) => set({ condition: e.target.value })}><option value="">—</option>{CONDITIONS.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></div>
      </div>
      <div className="nx-vistoria-itens">
        <span className="nx-vistoria-itens-label">Itens conferidos</span>
        <div className="nx-vistoria-grade">
          {ACCESSORIES.map(([key, l]) => (
            <label key={key} className={`nx-vistoria-item${v.items[key] ? ' is-ok' : ''}`}>
              <input type="checkbox" checked={!!v.items[key]} onChange={() => toggle(key)} />
              <span>{l}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="form-group"><label>Avarias / observações da vistoria</label><textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Riscos, amassados, faltas..." /></div>
    </fieldset>
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
      {present.length > 0 && <div style={{ color: 'var(--success)' }}>✓ {present.join(', ')}</div>}
      {missing.length > 0 && <div style={{ color: 'var(--danger)' }}>✗ Faltando: {missing.join(', ')}</div>}
      {d.notes && <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{d.notes}</div>}
    </div>
  );
}

function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
