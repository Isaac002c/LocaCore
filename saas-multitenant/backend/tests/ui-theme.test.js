'use strict';
// =============================================================================
// UI / TEMA (§23) — valida os tokens semânticos, a estrutura do login e do
// AppShell, e a persistência do tema. São testes de CONTRATO sobre os arquivos
// de estilo/componentes: falham se a fundação visual regredir.
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const globals = ler('app', 'globals.css');
const shell = ler('app', 'telun-shell.css');
const login = ler('app', 'login', 'page.jsx');
const layout = ler('app', 'layout.jsx');
const toggle = ler('app', 'components', 'ThemeToggle.jsx');

test('tema escuro: tokens semânticos exatos (§8)', () => {
  const esperado = {
    '--background': '#090811', '--sidebar': '#0A0912', '--surface': '#11101A',
    '--surface-secondary': '#15131F', '--surface-hover': '#1C1828', '--border': '#2B2738',
    '--text-primary': '#F7F5FA', '--text-secondary': '#AAA4B8', '--text-muted': '#777184',
    '--primary': '#A56BFF', '--primary-hover': '#B783FF',
  };
  for (const [token, hex] of Object.entries(esperado)) {
    assert.match(globals, new RegExp(`${token}:\\s*${hex}`, 'i'), `${token} deve ser ${hex}`);
  }
});

test('tema claro: tokens semânticos exatos (§9)', () => {
  const bloco = globals.match(/:root\[data-theme='light'\][\s\S]*?\n}/);
  assert.ok(bloco, 'bloco do tema claro deve existir');
  const esperado = {
    '--background': '#F6F5F8', '--sidebar': '#FFFFFF', '--surface': '#FFFFFF',
    '--surface-secondary': '#F1EFF5', '--surface-hover': '#EAE6F1', '--border': '#DDD8E5',
    '--text-primary': '#17131D', '--text-secondary': '#5E5868', '--text-muted': '#817A8C',
    '--primary': '#7C3FE4', '--primary-hover': '#6A2FD1',
  };
  for (const [token, hex] of Object.entries(esperado)) {
    assert.match(bloco[0], new RegExp(`${token}:\\s*${hex}`, 'i'), `claro: ${token} deve ser ${hex}`);
  }
});

test('ponte: tokens legados --nx-* derivam do tema (não fixam hex)', () => {
  for (const t of ['--nx-bg', '--nx-surface', '--nx-border', '--nx-ink', '--nx-muted']) {
    assert.match(globals, new RegExp(`${t}:\\s*var\\(--`), `${t} deve apontar para um token de tema`);
  }
  // O bloco legado do fim do arquivo não pode voltar a fixar cor clara.
  assert.ok(!/--nx-bg:\s*#f6f7f9/i.test(globals), '--nx-bg não pode ter hex fixo (quebra o tema)');
  assert.ok(!/--nx-surface:\s*#ffffff/i.test(globals), '--nx-surface não pode ter hex fixo');
});

test('tema: persistência, preferência do sistema e padrão escuro (§7)', () => {
  assert.match(toggle, /locacore-theme/, 'usa chave de persistência');
  assert.match(toggle, /localStorage\.setItem/, 'persiste a escolha');
  assert.match(toggle, /prefers-color-scheme/, 'considera a preferência do SO');
  assert.match(toggle, /\['dark',\s*'light',\s*'system'\]/, 'oferece os três modos');
  // Bootstrap anti-flash no layout, com fallback escuro.
  assert.match(layout, /localStorage\.getItem\('locacore-theme'\)/, 'aplica antes da 1ª pintura');
  assert.match(layout, /setAttribute\('data-theme'/, 'define data-theme no <html>');
  assert.match(layout, /catch\(e\)\{document\.documentElement\.setAttribute\('data-theme','dark'\)/, 'fallback escuro');
});

test('login: composição institucional 52/48 (§2)', () => {
  assert.match(shell, /\.tl-login__brandside[\s\S]*?flex:\s*0 0 52%/, 'área institucional 52%');
  assert.match(shell, /\.tl-login__formside[\s\S]*?flex:\s*1 1 48%/, 'área de autenticação 48%');
  assert.match(shell, /\.tl-login__form[\s\S]*?max-width:\s*360px/, 'form entre 320-380px');
  // Conteúdo exigido
  assert.match(login, /Gestão que <em>move<\/em> sua operação/);
  assert.match(login, /Clareza para conduzir sua frota/);
  assert.match(login, /PROPÓSITO/);
  assert.match(login, /Acessar o \{BRAND\.productName\}/, 'título usa o nome do produto');
  assert.match(login, /Entre com suas credenciais para continuar/);
  // Mostrar/ocultar senha + bloqueio de múltiplos envios
  assert.match(login, /showPassword/, 'alterna visibilidade da senha');
  assert.match(login, /if \(loading\) return;/, 'bloqueia envio duplicado');
  assert.match(login, /tl-btn--block/, 'botão ocupa a largura do formulário');
});

test('login: coluna única no mobile, sem card flutuante', () => {
  const mq = shell.match(/@media \(max-width: 900px\)[\s\S]*?\n}/);
  assert.ok(mq, 'breakpoint mobile do login deve existir');
  assert.match(mq[0], /\.tl-login\s*\{\s*flex-direction:\s*column/, 'vira coluna');
  assert.match(mq[0], /\.tl-login__brandside\s*\{\s*display:\s*none/, 'esconde o painel lateral');
  assert.match(mq[0], /\.tl-login__mobilebrand/, 'mostra a marca no topo');
});

test('AppShell: topbar em largura total e sidebar abaixo (referência)', () => {
  assert.match(shell, /grid-template-areas:\s*'topbar topbar'\s*'sidebar main'/, 'topbar ocupa a largura toda');
  assert.match(shell, /\.tl-topbar__brand/, 'marca fica na topbar');
});

test('sidebar: item ativo destacado com barra indicadora (§4)', () => {
  assert.match(shell, /\.tl-navitem\.is-active[\s\S]*?background:\s*var\(--primary-soft\)/, 'fundo lilás discreto');
  assert.match(shell, /\.tl-navitem\.is-active[\s\S]*?color:\s*var\(--primary\)/, 'texto na cor da marca');
  assert.match(shell, /\.tl-navitem\.is-active::before/, 'barra indicadora à esquerda');
  assert.match(shell, /\.tl-sidebar--collapsed/, 'suporta recolhimento');
});

test('abas: texto simples com linha inferior roxa (§5)', () => {
  assert.match(shell, /\.tl-tab\.is-active[\s\S]*?border-bottom-color:\s*var\(--primary\)/);
  assert.match(shell, /\.tl-tabs[\s\S]*?overflow-x:\s*auto/, 'rola no mobile');
});

test('componentes usam tokens, não hex de marca', () => {
  // Nenhum hex do roxo institucional fixo direto nos componentes .tl-
  const hexMarca = shell.match(/#(a56bff|7c3fe4|0b0b12|090811)/gi) || [];
  assert.deepEqual(hexMarca, [], `use var(--primary)/var(--background), não hex: ${hexMarca.join(', ')}`);
});

test('acessibilidade: foco visível e rótulos em botões de ícone (§20)', () => {
  assert.match(shell, /:focus-visible[\s\S]*?box-shadow:\s*0 0 0 3px var\(--focus-ring\)/, 'anel de foco');
  assert.match(toggle, /aria-label=/, 'toggle de tema tem rótulo');
  assert.match(login, /aria-label=\{showPassword/, 'botão de senha tem rótulo');
  assert.match(login, /role="alert"/, 'erro é anunciado');
});
