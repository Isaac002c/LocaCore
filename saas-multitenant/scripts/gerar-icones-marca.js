#!/usr/bin/env node
'use strict';
// =============================================================================
// gerar-icones-marca.js — Gera os ícones da marca a partir da logo oficial.
//
//   node scripts/gerar-icones-marca.js [caminho-da-logo]
//   padrão: ../img/logo_telun.jpeg
//
// A logo oficial da TELUN é um símbolo luminoso sobre fundo Cosmic (#0B0B12).
// Como o fundo é parte da arte, os ícones são gerados COM fundo (sem tentar
// recortar transparência, o que destruiria o brilho das trilhas).
//
// Rode de novo sempre que a logo oficial mudar; os PNGs são versionados.
// =============================================================================

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'public', 'brand');
const ORIGEM = process.argv[2] || path.join(RAIZ, '..', 'img', 'logo_telun.jpeg');

const COSMIC = { r: 11, g: 11, b: 18, alpha: 1 }; // #0B0B12

// A arte tem margem generosa; um leve corte central dá mais presença no favicon.
const RECORTE = 0.86;

const SAIDAS = [
  { arquivo: 'favicon-16.png',        tamanho: 16 },
  { arquivo: 'favicon-32.png',        tamanho: 32 },
  { arquivo: 'favicon-48.png',        tamanho: 48 },
  { arquivo: 'apple-touch-icon.png',  tamanho: 180 },
  { arquivo: 'icon-192.png',          tamanho: 192 },
  { arquivo: 'icon-512.png',          tamanho: 512 },
  { arquivo: 'telun-symbol.png',      tamanho: 256 },
  { arquivo: 'telun-logo.png',        tamanho: 512, recorte: 1 },
];

(async () => {
  if (!fs.existsSync(ORIGEM)) {
    console.error(`Logo não encontrada: ${ORIGEM}`);
    process.exit(1);
  }
  fs.mkdirSync(DESTINO, { recursive: true });

  const meta = await sharp(ORIGEM).metadata();
  const lado = Math.min(meta.width, meta.height);
  console.log(`Origem: ${path.relative(RAIZ, ORIGEM)} (${meta.width}x${meta.height} ${meta.format})\n`);

  for (const { arquivo, tamanho, recorte = RECORTE } of SAIDAS) {
    const corte = Math.round(lado * recorte);
    const left = Math.round((meta.width - corte) / 2);
    const top = Math.round((meta.height - corte) / 2);

    await sharp(ORIGEM)
      .extract({ left, top, width: corte, height: corte })
      .resize(tamanho, tamanho, { fit: 'cover', kernel: 'lanczos3' })
      .flatten({ background: COSMIC })
      .png({ compressionLevel: 9, palette: tamanho <= 48 })
      .toFile(path.join(DESTINO, arquivo));

    const kb = (fs.statSync(path.join(DESTINO, arquivo)).size / 1024).toFixed(1);
    console.log(`  ✓ ${arquivo.padEnd(24)} ${tamanho}x${tamanho}  ${kb} KB`);
  }

  // Open Graph: 1200x630 com o símbolo centralizado sobre o fundo da marca.
  const corteOg = Math.round(lado * RECORTE);
  const simbolo = await sharp(ORIGEM)
    .extract({
      left: Math.round((meta.width - corteOg) / 2),
      top: Math.round((meta.height - corteOg) / 2),
      width: corteOg,
      height: corteOg,
    })
    .resize(520, 520, { fit: 'cover', kernel: 'lanczos3' })
    .toBuffer();

  await sharp({ create: { width: 1200, height: 630, channels: 4, background: COSMIC } })
    .composite([{ input: simbolo, top: 55, left: 340 }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(DESTINO, 'og-locacore.png'));
  console.log(`  ✓ ${'og-locacore.png'.padEnd(24)} 1200x630`);

  console.log(`\nGerados em ${path.relative(RAIZ, DESTINO)}/`);
})().catch((e) => { console.error('Falhou:', e.message); process.exit(1); });
