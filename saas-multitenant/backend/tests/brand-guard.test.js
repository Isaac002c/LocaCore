'use strict';
// =============================================================================
// GUARDA DE MARCA (§22) — impede que a marca antiga volte à experiência pública.
//
// Falha se "Chronostek / ChronosTek / Chronos Tech / Chronos Tek" aparecer em
// superfícies visíveis ao usuário: telas, componentes, textos de interface,
// metadados, manifest, assets públicos, PDFs, e-mails e branding do backend.
//
// EXCEÇÕES EXPLÍCITAS (permitidas, documentadas):
//   • migrations históricas — alterar muda o checksum e provoca drift;
//   • documentação de migração/compatibilidade;
//   • aliases controlados de compatibilidade (masterModels);
//   • os próprios testes de migração/guarda;
//   • infraestrutura legada não servida ao usuário (nginx antigo, composes).
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');            // saas-multitenant/
const OLD_BRAND = /chronos\s?te(k|ch)/i;

// Caminhos (relativos a saas-multitenant/) isentos — com o porquê.
const EXCECOES = [
  'backend/migrations/',            // histórico: checksum do runner
  'backend/tests/brand-guard',      // este teste
  'backend/models/masterModels.js', // alias controlado (MASTER_SLUG_ALIASES)
  'deploy/DEPLOY.md',               // runbook histórico do deploy anterior
  'README.md',                      // doc: menciona a migração
  'FINANCEIRO_MVP.md',              // doc histórica
  'backend/RELATORIO_CICLO5.md',    // relatório histórico
  'nginx/api.conf',                 // legado marcado, não servido ao usuário
  'nginx/api-init.conf',            // idem
  'docker-compose.yml',             // compose legado do deploy anterior
  'deploy/docker-compose.yml',      // idem
  'node_modules/', '.next/', '.git/',
];

const isento = (rel) => EXCECOES.some((e) => rel.replace(/\\/g, '/').includes(e));

// Varre um diretório coletando arquivos que importam para a experiência pública.
function varrer(dir, exts, encontrados = []) {
  let itens;
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return encontrados; }
  for (const it of itens) {
    const full = path.join(dir, it.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (isento(rel)) continue;
    if (it.isDirectory()) varrer(full, exts, encontrados);
    else if (exts.some((e) => it.name.endsWith(e))) encontrados.push({ full, rel });
  }
  return encontrados;
}

function ocorrencias(dirs, exts) {
  const achados = [];
  for (const d of dirs) {
    for (const { full, rel } of varrer(path.join(ROOT, d), exts)) {
      let txt;
      try { txt = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
      const linhas = txt.split('\n');
      linhas.forEach((l, i) => { if (OLD_BRAND.test(l)) achados.push(`${rel}:${i + 1}: ${l.trim().slice(0, 100)}`); });
    }
  }
  return achados;
}

test('frontend: nenhuma tela/componente exibe a marca antiga', () => {
  const a = ocorrencias(['app'], ['.jsx', '.js', '.tsx', '.ts', '.css']);
  assert.deepEqual(a, [], `Marca antiga na interface:\n${a.join('\n')}`);
});

test('assets públicos: nenhum arquivo da marca antiga no bundle', () => {
  const pub = path.join(ROOT, 'public');
  const nomes = [];
  const walk = (d, base = '') => {
    let itens; try { itens = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const it of itens) {
      const rel = base ? `${base}/${it.name}` : it.name;
      if (it.isDirectory()) walk(path.join(d, it.name), rel);
      else if (OLD_BRAND.test(it.name)) nomes.push(rel);
    }
  };
  walk(pub);
  assert.deepEqual(nomes, [], `Assets da marca antiga em public/:\n${nomes.join('\n')}`);
});

test('metadados e manifest usam LocaCore/TELUN', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.jsx'), 'utf8');
  assert.ok(!OLD_BRAND.test(layout), 'layout.jsx contém a marca antiga');

  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(mf.short_name, 'LocaCore');
  assert.match(mf.name, /LocaCore/);
  assert.match(mf.description, /TELUN/, 'manifest deve citar TELUN');
  assert.ok(!OLD_BRAND.test(JSON.stringify(mf)), 'manifest contém a marca antiga');
  assert.equal(mf.theme_color, '#0B0B12', 'theme_color = Cosmic');
});

test('config de marca: identidade e paleta oficiais', () => {
  const brand = fs.readFileSync(path.join(ROOT, 'app', 'lib', 'brand.js'), 'utf8');
  assert.match(brand, /companyName:\s*'TELUN'/);
  assert.match(brand, /productName:\s*'LocaCore'/);
  assert.match(brand, /productSignature:\s*'Um produto TELUN'/);
  for (const cor of ['#0B0B12', '#3B1F6A', '#A56BFF', '#FF8A3D', '#FFD8A6']) {
    assert.ok(brand.includes(cor), `paleta TELUN deve conter ${cor}`);
  }
});

test('paleta TELUN aplicada nas variáveis CSS', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');
  // Constantes da marca continuam declaradas...
  assert.match(css, /--telun-cosmic:\s*#0B0B12/);
  assert.match(css, /--telun-electric-lilac:\s*#A56BFF/);
  // ...e a cadeia agora passa pela camada SEMÂNTICA (permite tema claro/escuro):
  //   --nx-primary → --primary → #A56BFF (escuro) / #7C3FE4 (claro)
  assert.match(css, /--nx-primary:\s*var\(--primary\)/, 'primary deve vir do token semântico');
  assert.match(css, /--primary:\s*#A56BFF/i, 'tema escuro usa Electric Lilac');
  assert.match(css, /--primary:\s*#7C3FE4/i, 'tema claro usa o roxo de contraste');
  // Status permanecem semânticos (§8)
  assert.match(css, /--nx-green:\s*#15803d/, 'sucesso permanece verde');
  assert.match(css, /--nx-red:\s*#b91c1c/, 'perigo permanece vermelho');
});

test('backend: branding institucional sem a marca antiga', () => {
  const a = ocorrencias(
    ['backend/services', 'backend/routes', 'backend/models', 'backend/middlewares', 'backend/scripts'],
    ['.js']
  );
  assert.deepEqual(a, [], `Marca antiga no backend:\n${a.join('\n')}`);
});

test('backend: DEFAULT_BRANDING assina "Um produto TELUN"', () => {
  delete require.cache[require.resolve('../services/finance/constants')];
  const { DEFAULT_BRANDING } = require('../services/finance/constants');
  assert.equal(DEFAULT_BRANDING.name, 'LocaCore');
  assert.equal(DEFAULT_BRANDING.signature, 'Um produto TELUN');
  assert.equal(DEFAULT_BRANDING.company, 'TELUN');
  assert.ok(!OLD_BRAND.test(JSON.stringify(DEFAULT_BRANDING)), 'branding contém a marca antiga');
});

test('PDF de contrato: rodapé institucional usa a marca nova', () => {
  const pdf = fs.readFileSync(
    path.join(ROOT, 'backend', 'services', 'finance', 'rentalContractPdf.js'), 'utf8');
  assert.ok(!OLD_BRAND.test(pdf), 'gerador de contrato contém a marca antiga');
});

test('alias do operador master é controlado e reversível', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend', 'models', 'masterModels.js'), 'utf8');
  assert.match(src, /MASTER_SLUG_ALIASES\s*=\s*\['chronostek'\]/, 'alias deve ser explícito');
  assert.match(src, /MASTER_TENANT_SLUG.*\|\|\s*'telun'/, 'slug novo é o padrão');
});
