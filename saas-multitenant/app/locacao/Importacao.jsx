'use client';

import { useState } from 'react';
import { previewImport, commitImport } from '../lib/importAPI';
import { InlineError } from '../components/states';

const ENTITIES = [
  ['clientes', 'Clientes', 'name, cpf, cnh, phone, email, address, birth_date, status'],
  ['veiculos', 'Veículos', 'plate, brand, model, year, color, category, daily_rate, odometer, status'],
];

export default function Importacao() {
  const [entity, setEntity] = useState('clientes');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const cols = ENTITIES.find(([v]) => v === entity)?.[2];

  const onFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result || '')); setPreview(null); setResult(null); };
    reader.readAsText(file, 'utf-8');
  };

  const doPreview = async () => {
    if (!csv.trim()) { setError('Cole ou selecione um arquivo CSV.'); return; }
    try { setBusy(true); setError(null); setResult(null); setPreview(await previewImport(entity, csv)); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!preview || preview.valid_count === 0) return;
    if (!confirm(`Importar ${preview.valid_count} ${entity}? Linhas inválidas são ignoradas.`)) return;
    try { setBusy(true); setError(null); setResult(await commitImport(entity, csv)); setPreview(null); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const reset = () => { setCsv(''); setPreview(null); setResult(null); setError(null); };

  return (
    <div className="clients-page">
      <InlineError message={error} onDismiss={() => setError(null)} />

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 16 }}>
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group"><label>O que importar</label>
            <select value={entity} onChange={(e) => { setEntity(e.target.value); setPreview(null); setResult(null); }}>
              {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}><label>Arquivo CSV</label><input type="file" accept=".csv,text/csv" onChange={onFile} /></div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 8px' }}>Colunas reconhecidas: <code>{cols}</code>. Primeira linha = cabeçalho. Separador <code>;</code> ou <code>,</code>. O tenant é sempre o seu — nunca vem da planilha.</p>
        <div className="form-group"><label>Ou cole o conteúdo CSV</label>
          <textarea rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); setResult(null); }} placeholder={entity === 'clientes' ? 'name;cpf;phone\nMaria Silva;12345678900;11999990000' : 'plate;brand;model;daily_rate\nABC1D23;Fiat;Argo;120'} style={{ fontFamily: 'monospace', fontSize: 13 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" onClick={doPreview} disabled={busy}>{busy ? 'Processando...' : 'Pré-visualizar'}</button>
          <button className="btn-secondary" onClick={reset} disabled={busy}>Limpar</button>
        </div>
      </div>

      {preview && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 16 }}>
          <div className="clients-summary" style={{ marginBottom: 14 }}>
            <div className="clients-summary-card all"><span className="summary-number">{preview.total}</span><span className="summary-label">Linhas</span></div>
            <div className="clients-summary-card fechado"><span className="summary-number">{preview.valid_count}</span><span className="summary-label">Válidas</span></div>
            <div className="clients-summary-card nego"><span className="summary-number">{preview.error_count}</span><span className="summary-label">Com erro</span></div>
          </div>

          {preview.errors?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Erros (ignorados na importação)</div>
              <div className="clients-table-wrap" style={{ maxHeight: 180, overflow: 'auto' }}><table className="data-table">
                <thead><tr><th style={{ width: 70 }}>Linha</th><th>Motivo</th></tr></thead>
                <tbody>{preview.errors.map((e, i) => <tr key={i}><td>{e.line}</td><td style={{ color: '#b91c1c' }}>{e.message}</td></tr>)}</tbody>
              </table></div>
            </div>
          )}

          {preview.sample?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Amostra ({preview.sample.length} de {preview.valid_count})</div>
              <div className="clients-table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}><table className="data-table">
                <thead><tr>{Object.keys(preview.sample[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>{preview.sample.map((row, i) => <tr key={i}>{Object.keys(preview.sample[0]).map((k) => <td key={k}>{String(row[k] ?? '') || '—'}</td>)}</tr>)}</tbody>
              </table></div>
            </div>
          )}

          <button className="btn-primary" onClick={doImport} disabled={busy || preview.valid_count === 0}>{busy ? 'Importando...' : `Importar ${preview.valid_count} registro(s)`}</button>
        </div>
      )}

      {result && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#15803d', marginBottom: 8 }}>Importação concluída</div>
          <div style={{ display: 'flex', gap: 24, fontSize: 14 }}>
            <span><strong style={{ color: '#15803d', fontSize: 20 }}>{result.imported}</strong> importados</span>
            <span><strong style={{ color: '#b45309', fontSize: 20 }}>{result.skipped}</strong> já existentes (ignorados)</span>
            <span><strong style={{ color: '#b91c1c', fontSize: 20 }}>{result.error_count}</strong> com erro</span>
          </div>
          {result.errors?.length > 0 && (
            <div className="clients-table-wrap" style={{ maxHeight: 160, overflow: 'auto', marginTop: 12 }}><table className="data-table">
              <thead><tr><th style={{ width: 70 }}>Linha</th><th>Motivo</th></tr></thead>
              <tbody>{result.errors.map((e, i) => <tr key={i}><td>{e.line}</td><td style={{ color: '#b91c1c' }}>{e.message}</td></tr>)}</tbody>
            </table></div>
          )}
          <button className="btn-secondary" style={{ marginTop: 12 }} onClick={reset}>Nova importação</button>
        </div>
      )}
    </div>
  );
}
