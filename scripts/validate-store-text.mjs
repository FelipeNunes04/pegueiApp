#!/usr/bin/env node
// Confere os limites dos textos das lojas em fastlane/metadata (fonte: marketing/README.md).
// App Store: nome 30, subtítulo 30, palavras-chave 100 BYTES, promocional 170, descrição 4000,
// novidades 4000. Play: título 30, descrição curta 80, descrição completa 4000, novidades 500.
// Sai com código 1 se algum campo passar do limite ou estiver vazio.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const META = new URL('../fastlane/metadata/', import.meta.url).pathname;
const chars = s => [...s].length;
const bytes = s => Buffer.byteLength(s, 'utf8');

const IOS = {
  'name.txt': { max: 30 },
  'subtitle.txt': { max: 30 },
  'keywords.txt': { max: 100, unit: 'bytes' },
  'promotional_text.txt': { max: 170 },
  'description.txt': { max: 4000 },
  'release_notes.txt': { max: 4000 },
};
const PLAY = {
  'title.txt': { max: 30 },
  'short_description.txt': { max: 80 },
  'full_description.txt': { max: 4000 },
  'changelogs/default.txt': { max: 500 },
};

let failed = false;
const rows = [];

function check(dir, file, rule, store) {
  const path = join(dir, file);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8').replace(/\n+$/, '');
  const size = rule.unit === 'bytes' ? bytes(text) : chars(text);
  const ok = size > 0 && size <= rule.max;
  if (!ok) failed = true;
  rows.push(`${ok ? 'ok  ' : 'ERRO'} ${store} ${path.replace(META, '')}: ${size}/${rule.max} ${rule.unit ?? 'caracteres'}`);
  if (file === 'keywords.txt') {
    const words = text.split(',');
    const bad = words.filter(w => w.trim() !== w || w.length < 2);
    if (bad.length) {
      failed = true;
      rows.push(`ERRO   palavras-chave com espaço extra ou curtas demais: ${bad.join(' | ')}`);
    }
    const dup = words.filter((w, i) => words.indexOf(w) !== i);
    if (dup.length) {
      failed = true;
      rows.push(`ERRO   palavras-chave repetidas: ${dup.join(', ')}`);
    }
    // Palavra que já está no nome ou subtítulo é desperdício: a Apple já indexa os dois.
    const name = readFileSync(join(dir, 'name.txt'), 'utf8') + ' ' + readFileSync(join(dir, 'subtitle.txt'), 'utf8');
    const norm = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const inName = words.filter(w => norm(name).split(/[^a-z0-9]+/).includes(norm(w)));
    if (inName.length) rows.push(`aviso  já estão no nome/subtítulo: ${inName.join(', ')}`);
  }
}

for (const locale of readdirSync(META)) {
  if (locale === 'android') continue;
  for (const [file, rule] of Object.entries(IOS)) check(join(META, locale), file, rule, 'App Store');
}
const android = join(META, 'android');
if (existsSync(android)) {
  for (const locale of readdirSync(android)) {
    for (const [file, rule] of Object.entries(PLAY)) check(join(android, locale), file, rule, 'Play');
  }
}

console.log(rows.join('\n'));
if (failed) {
  console.error('\nHá campos fora do limite.');
  process.exit(1);
}
console.log('\nTodos os campos dentro dos limites.');
