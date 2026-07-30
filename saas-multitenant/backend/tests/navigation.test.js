'use strict';
// =============================================================================
// NAVEGAÇÃO / APPSHELL (§2, §21) — testes de CONTRATO sobre o roteamento de telas.
//
// Existem porque a área central ficou EM BRANCO em produção: a sidebar tinha
// itens (Painel, Importação) apontando para tabs que o roteador de telas não
// conhecia, e o roteador simplesmente não renderizava nada.
//
// Estes testes quebram o build se:
//   • um item de menu não tiver tela correspondente;
//   • um alias de tab apontar para uma tela inexistente;
//   • a tab padrão de uma área não existir;
//   • o roteador voltar a renderizar vazio quando a tab é desconhecida;
//   • as telas voltarem a ter fontes de verdade duplicadas.
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const navSrc = ler('app', 'lib', 'navigation.js');
const pageSrc = ler('app', 'dashboard', 'page.jsx');
const sidebarSrc = ler('app', 'components', 'Sidebar.jsx');
const headerSrc = ler('app', 'components', 'PageHeader.jsx');
const statesSrc = ler('app', 'components', 'states.jsx');

// ── Carrega navigation.js (ESM) sem bundler: transforma export → CommonJS ────
function loadNavigation() {
  const cjs = navSrc
    .replace(/^export const /gm, 'const ')
    .replace(/^export /gm, '');
  const names = [
    'NAV_MODULES', 'NAV_ITEMS', 'MODULE_ALIASES', 'TAB_ALIASES', 'SIDEBAR_MODULE_KEYS',
    'getModuleItems', 'canSeeItem', 'getVisibleItems', 'resolveModule', 'getDefaultTab',
    'resolveTab', 'getPageInfo', 'tabExists', 'canAccessTab',
  ];
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${cjs}\n; return { ${names.join(', ')} };`);
  return factory();
}

const nav = loadNavigation();

// ── Extrai as telas registradas no roteador (app/dashboard/page.jsx) ─────────
// Formato: modulePages = { <modulo>: { pages: { <tab>: Componente, ... } }, ... }
function extractModulePages(src) {
  const start = src.indexOf('const modulePages = {');
  assert.ok(start > -1, 'modulePages deve existir em app/dashboard/page.jsx');
  // Varre equilibrando chaves a partir do primeiro '{'.
  const from = src.indexOf('{', start);
  let depth = 0;
  let end = from;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  const block = src.slice(from, end + 1);

  const result = {};
  const moduleRe = /(\w+):\s*\{\s*pages:\s*\{/g;
  let m;
  while ((m = moduleRe.exec(block)) !== null) {
    const moduleKey = m[1];
    // Delimita o objeto `pages` deste módulo.
    const pagesStart = block.indexOf('{', m.index + m[0].length - 1);
    let d = 0;
    let pagesEnd = pagesStart;
    for (let i = pagesStart; i < block.length; i += 1) {
      if (block[i] === '{') d += 1;
      else if (block[i] === '}') {
        d -= 1;
        if (d === 0) { pagesEnd = i; break; }
      }
    }
    const pagesBlock = block.slice(pagesStart + 1, pagesEnd);
    // Chaves de 1º nível apenas (ignora o corpo das arrow functions inline).
    const keys = [];
    let depth2 = 0;
    let buf = '';
    for (let i = 0; i < pagesBlock.length; i += 1) {
      const ch = pagesBlock[i];
      if (ch === '{' || ch === '(' || ch === '[') depth2 += 1;
      if (ch === '}' || ch === ')' || ch === ']') depth2 -= 1;
      if (ch === ',' && depth2 === 0) { buf = ''; continue; }
      if (ch === ':' && depth2 === 0) {
        const key = buf.trim().split('\n').pop().trim();
        if (/^\w+$/.test(key)) keys.push(key);
        buf = '';
        // pula até a próxima vírgula de 1º nível
        let d3 = 0;
        for (let j = i + 1; j < pagesBlock.length; j += 1) {
          const c = pagesBlock[j];
          if (c === '{' || c === '(' || c === '[') d3 += 1;
          if (c === '}' || c === ')' || c === ']') d3 -= 1;
          if (c === ',' && d3 === 0) { i = j; break; }
          if (j === pagesBlock.length - 1) i = j;
        }
        continue;
      }
      buf += ch;
    }
    result[moduleKey] = keys;
  }
  return result;
}

const modulePages = extractModulePages(pageSrc);

// =============================================================================
test('roteador: todo módulo da navegação tem telas registradas', () => {
  for (const moduleKey of Object.keys(nav.NAV_ITEMS)) {
    assert.ok(
      Array.isArray(modulePages[moduleKey]) && modulePages[moduleKey].length,
      `módulo "${moduleKey}" existe em navigation.js mas não tem pages no roteador`,
    );
  }
});

test('P0: todo item de menu aponta para uma tela que existe (causa da tela em branco)', () => {
  const faltando = [];
  for (const [moduleKey, items] of Object.entries(nav.NAV_ITEMS)) {
    const pages = modulePages[moduleKey] || [];
    for (const item of items) {
      if (!pages.includes(item.tab)) faltando.push(`${moduleKey}/${item.tab} (${item.label})`);
    }
  }
  assert.deepEqual(faltando, [], `itens de menu sem tela no roteador: ${faltando.join(', ')}`);
});

test('P0: todo alias de tab aponta para uma tela que existe', () => {
  const quebrados = [];
  for (const [moduleKey, aliases] of Object.entries(nav.TAB_ALIASES)) {
    const pages = modulePages[moduleKey] || [];
    for (const [de, para] of Object.entries(aliases)) {
      if (!pages.includes(para)) quebrados.push(`${moduleKey}: ${de} → ${para}`);
    }
  }
  assert.deepEqual(quebrados, [], `aliases apontando para telas inexistentes: ${quebrados.join(', ')}`);
});

test('regressão: alias de tab é POR MÓDULO, nunca global', () => {
  // Um alias global painel→dashboard fazia o Painel da Locação sumir.
  for (const [moduleKey, aliases] of Object.entries(nav.TAB_ALIASES)) {
    assert.equal(typeof aliases, 'object', `TAB_ALIASES.${moduleKey} deve ser um objeto de aliases`);
  }
  assert.equal(nav.resolveTab('locacao', 'painel', 'admin'), 'painel', 'locacao/painel NÃO pode virar dashboard');
  assert.equal(nav.resolveTab('multas', 'painel', 'admin'), 'dashboard', 'multas/painel continua indo para dashboard (link legado)');
  assert.equal(nav.resolveTab('locacao', 'dashboard', 'admin'), 'painel', 'links antigos de locacao/dashboard caem no Painel');
});

test('todo alias de módulo aponta para um módulo existente', () => {
  for (const [de, para] of Object.entries(nav.MODULE_ALIASES)) {
    assert.ok(nav.NAV_ITEMS[para], `alias de módulo ${de} → ${para} aponta para módulo inexistente`);
  }
  // 'agenda' era alias de módulo e colidia com a tab 'agenda' da Locação.
  assert.equal(nav.MODULE_ALIASES.agenda, undefined, 'agenda não pode ser alias de módulo (é uma tela da Locação)');
});

test('tab padrão de cada módulo existe e respeita a role', () => {
  const roles = ['admin', 'manager', 'operator', 'seller', 'viewer'];
  for (const moduleKey of Object.keys(nav.NAV_ITEMS)) {
    const pages = modulePages[moduleKey] || [];
    for (const role of roles) {
      const tab = nav.getDefaultTab(moduleKey, role);
      assert.ok(pages.includes(tab), `tab padrão ${moduleKey}/${tab} (role=${role}) não existe no roteador`);
    }
  }
});

test('tab padrão nunca cai numa tela sem permissão para a role', () => {
  // Antes, o seletor de área usava items[0] fixo (Painel, admin-only): um
  // consultor trocava de área e caía numa tela que ele não pode ver.
  for (const moduleKey of ['locacao', 'multas']) {
    for (const role of ['admin', 'manager', 'operator', 'seller', 'viewer']) {
      const visiveis = nav.getVisibleItems(moduleKey, role);
      if (!visiveis.length) continue;
      const tab = nav.getDefaultTab(moduleKey, role);
      assert.ok(
        nav.canAccessTab(moduleKey, tab, role),
        `${moduleKey}: role=${role} cairia em "${tab}", que ela não pode ver`,
      );
    }
  }
});

test('Locação: menu cobre os módulos operacionais do produto', () => {
  const tabs = nav.NAV_ITEMS.locacao.map((i) => i.tab);
  for (const esperada of [
    'painel', 'locacoes', 'frota', 'manutencoes', 'multas', 'estoque',
    'agenda', 'relatorios', 'importacao', 'clients', 'automacoes', 'usuarios', 'history',
  ]) {
    assert.ok(tabs.includes(esperada), `Locação deve ter a tela "${esperada}"`);
  }
});

test('todo item de menu tem título e subtítulo para a topbar', () => {
  for (const [moduleKey, items] of Object.entries(nav.NAV_ITEMS)) {
    for (const item of items) {
      const info = nav.getPageInfo(moduleKey, item.tab);
      assert.ok(info && info.title, `${moduleKey}/${item.tab} sem título`);
      assert.ok(info.subtitle && info.subtitle.length > 10, `${moduleKey}/${item.tab} sem subtítulo útil`);
    }
  }
});

test('topbar não mostra mais o texto de despachante nas telas da Locação', () => {
  // Sintoma original: toda tela da Locação exibia "Dashboard — Visão geral de
  // clientes, serviços, prazos e etapas." (texto do módulo despachante).
  for (const item of nav.NAV_ITEMS.locacao) {
    const info = nav.getPageInfo('locacao', item.tab);
    assert.doesNotMatch(info.subtitle, /prazos e etapas/i, `${item.tab} herdou o subtítulo do despachante`);
  }
});

test('roteador NUNCA renderiza vazio: tab desconhecida cai em ScreenNotFound', () => {
  assert.match(pageSrc, /ScreenNotFound/, 'page.jsx deve usar ScreenNotFound');
  assert.match(pageSrc, /if\s*\(!known\)/, 'page.jsx deve tratar tab desconhecida explicitamente');
  assert.match(pageSrc, /ModuleUnavailable/, 'page.jsx deve tratar módulo não habilitado');
  assert.match(pageSrc, /PermissionDenied/, 'page.jsx deve tratar falta de permissão');
});

test('cada tela é isolada por ErrorBoundary (erro de render não apaga o conteúdo)', () => {
  assert.match(pageSrc, /<ErrorBoundary/, 'as telas devem ser envolvidas por ErrorBoundary');
  assert.match(statesSrc, /class ErrorBoundary/, 'states.jsx deve exportar a classe ErrorBoundary');
  assert.match(statesSrc, /getDerivedStateFromError/, 'ErrorBoundary precisa capturar erros de render');
  assert.match(statesSrc, /componentDidCatch/, 'ErrorBoundary precisa registrar o erro técnico');
});

test('states.jsx expõe todos os estados padrão exigidos', () => {
  for (const nome of [
    'PageLoading', 'PageError', 'EmptyState', 'ErrorBoundary',
    'RetryButton', 'PermissionDenied', 'ModuleUnavailable', 'ScreenNotFound',
  ]) {
    assert.match(statesSrc, new RegExp(`\\b${nome}\\b`), `states.jsx deve exportar ${nome}`);
  }
});

test('fonte única: sidebar e topbar leem de lib/navigation (sem listas duplicadas)', () => {
  assert.match(sidebarSrc, /from '\.\.\/lib\/navigation'/, 'Sidebar deve importar de lib/navigation');
  assert.match(headerSrc, /from '\.\.\/lib\/navigation'/, 'PageHeader deve importar de lib/navigation');
  assert.doesNotMatch(sidebarSrc, /const sidebarConfig = \{/, 'Sidebar não pode voltar a ter sua própria lista de telas');
  assert.doesNotMatch(headerSrc, /const pageInfo = \{/, 'PageHeader não pode voltar a ter sua própria lista de títulos');
  assert.doesNotMatch(pageSrc, /const TAB_ALIASES = \{/, 'page.jsx não pode voltar a ter aliases globais de tab');
});

test('seletor de área usa a primeira tela VISÍVEL para a role', () => {
  assert.match(sidebarSrc, /getDefaultTab\(m\.key, userRole\)/, 'o botão de área deve usar getDefaultTab com a role');
  assert.doesNotMatch(sidebarSrc, /items\[0\]\?\.tab/, 'não pode voltar a usar items[0] fixo');
});
