'use strict';
// =============================================================================
// TEMA — nenhuma cor do tema CLARO pode voltar fixa no código.
//
// Regressão real: o formulário de locação tinha `background: '#f8fafc'` fixo com
// texto em var(--text-primary). No tema escuro isso virava um bloco branco com
// texto quase branco — o "Total da locação", o número mais importante da tela,
// ficava invisível. As pílulas de status tinham o mesmo problema, escondidas em
// objetos { bg, text } dentro de arquivos .js.
//
// Este teste falha se alguém reintroduzir a paleta clara fixa. Cores devem vir
// SEMPRE dos tokens: var(--surface), var(--text-primary), var(--success)...
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'app');

// Paleta do tema claro que NÃO pode aparecer fixa em componente.
const PROIBIDAS = [
  '#f8fafc', '#f1f5f9', '#f9fafb', '#e2e8f0', '#e5e7eb', '#cbd5e1',
  '#dcfce7', '#d1fae5', '#fee2e2', '#dbeafe', '#fef3c7', '#ede9fe',
  '#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8',
];

// globals.css define os TOKENS (é onde os hex devem morar) e o bootstrap de
// tema; ali a paleta é legítima.
const IGNORAR = new Set(['globals.css', 'telun-shell.css']);

function listarArquivos(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...listarArquivos(p)); continue; }
    if (!/\.(jsx?|css)$/.test(entry.name)) continue;
    if (IGNORAR.has(entry.name)) continue;
    out.push(p);
  }
  return out;
}

test('nenhum componente usa a paleta do tema claro fixa', () => {
  const ofensores = [];
  for (const arquivo of listarArquivos(APP)) {
    const src = fs.readFileSync(arquivo, 'utf8');
    const linhas = src.split('\n');
    linhas.forEach((linha, i) => {
      // Comentários explicando a regressão podem citar o hex.
      const semComentario = linha.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const hex of PROIBIDAS) {
        if (semComentario.toLowerCase().includes(hex)) {
          ofensores.push(`${path.relative(APP, arquivo)}:${i + 1} → ${hex}`);
        }
      }
    });
  }
  assert.deepEqual(
    ofensores, [],
    `cores do tema claro fixas (use tokens var(--...)):\n  ${ofensores.join('\n  ')}`,
  );
});

test('o formulário de locação mostra a CONTA, não só o total', () => {
  const src = fs.readFileSync(path.join(APP, 'locacao', 'Locacoes.jsx'), 'utf8');
  assert.match(src, /nx-resumo-linhas/, 'deve detalhar diárias × valor');
  assert.match(src, /nx-resumo-total/, 'deve destacar o total');
  assert.match(src, /nx-resumo-nota/, 'deve separar a caução (reembolsável)');
  assert.match(src, /de cau/, 'deve explicar que a caução é cobrada à parte');
  // O total não pode voltar a ser um retângulo com fundo fixo.
  assert.doesNotMatch(src, /background: '#/, 'sem fundo fixo no formulário');
});

test('"Diárias" é valor derivado, não input readOnly disfarçado', () => {
  const src = fs.readFileSync(path.join(APP, 'locacao', 'Locacoes.jsx'), 'utf8');
  assert.match(src, /nx-derivado/, 'deve usar o estilo de valor derivado');
  assert.doesNotMatch(src, /value=\{formTotals\.days\} readOnly/, 'não pode voltar a ser input readOnly');
});

test('a vistoria usa fieldset com legenda e grade estável', () => {
  const src = fs.readFileSync(path.join(APP, 'locacao', 'Vistoria.jsx'), 'utf8');
  assert.match(src, /<fieldset className="nx-vistoria">/, 'bloco semântico');
  assert.match(src, /<legend>/, 'legenda de verdade');
  assert.match(src, /nx-vistoria-grade/, 'itens em grade (não flex que quebra palavra)');
  assert.match(src, /nx-vistoria-item/, 'cada item com célula própria');
});

test('os estilos novos existem no CSS e derivam de tokens', () => {
  const css = fs.readFileSync(path.join(APP, 'telun-shell.css'), 'utf8');
  for (const classe of ['.nx-resumo', '.nx-resumo-total', '.nx-derivado', '.nx-vistoria', '.nx-vistoria-grade', '.nx-vistoria-item']) {
    assert.ok(css.includes(classe), `${classe} deve existir no CSS`);
  }
  // O bloco do resumo precisa usar tokens, não hex.
  const bloco = css.slice(css.indexOf('.nx-resumo {'), css.indexOf('.nx-vistoria {'));
  assert.doesNotMatch(bloco, /#[0-9a-f]{6}/i, 'o resumo não pode ter hex fixo');
});
