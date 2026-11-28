#!/usr/bin/env node
// Monta as páginas estáticas de site/ (GitHub Pages) que vêm de outros arquivos:
//   legal/*.md → site/privacidade.html, termos.html, privacy.html, terms.html
//   fontes, ícone e a tela do app (marketing/screenshots/raw) → site/fonts, site/img
// site/index.html é escrito à mão. Publicação: .github/workflows/pages.yml.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const SITE = join(ROOT, 'site');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Markdown mínimo usado em legal/: títulos, parágrafos, listas, tabelas, negrito, itálico, código e links.
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, '$1<a href="mailto:$2">$2</a>');
}

export function markdown(md) {
  const out = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      i--;
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      const [head, , ...body] = rows;
      out.push(`<table><tr>${cells(head).map(c => `<th>${c}</th>`).join('')}</tr>${body
        .map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      i--;
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(it => `<li>${inline(it)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||\s*([-*]|\d+\.)\s)/.test(lines[i + 1])) para.push(lines[++i]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const PAGES = [
  ['privacy-policy-pt-BR.md', 'privacidade.html', 'pt-BR', 'Voltar'],
  ['terms-of-use-pt-BR.md', 'termos.html', 'pt-BR', 'Voltar'],
  ['privacy-policy-en-US.md', 'privacy.html', 'en', 'Back'],
  ['terms-of-use-en-US.md', 'terms.html', 'en', 'Back'],
];

for (const [src, dst, lang, back] of PAGES) {
  const md = readFileSync(join(ROOT, 'legal', src), 'utf8');
  const title = md.match(/^#\s+(.*)/m)?.[1] ?? 'Peguei';
  writeFileSync(join(SITE, dst), `<!doctype html>
<!-- Gerado por scripts/build-site.mjs a partir de legal/${src}. Não edite aqui. -->
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="img/icon-192.png"><meta name="theme-color" content="#0A1414">
<style>
@font-face{font-family:Inter;font-weight:400;src:url("fonts/Inter_400Regular.ttf")}
@font-face{font-family:Inter;font-weight:800;src:url("fonts/Inter_800ExtraBold.ttf")}
*{box-sizing:border-box}body{margin:0;background:#0A1414;color:#F2F5F5;font-family:Inter,-apple-system,sans-serif;line-height:1.6}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}a{color:#F5A623}h1{font-size:30px;line-height:1.15}h2{margin-top:32px;font-size:22px}
table{width:100%;border-collapse:collapse;display:block;overflow-x:auto}th,td{border-bottom:1px solid rgba(255,255,255,.12);padding:8px;text-align:left;vertical-align:top}
code{background:#14201F;padding:1px 5px;border-radius:4px;word-break:break-all}
</style></head><body><main><p><a href="./">← ${back}</a></p>
${markdown(md)}
</main></body></html>
`);
  console.log(`ok site/${dst}`);
}

mkdirSync(join(SITE, 'fonts'), { recursive: true });
mkdirSync(join(SITE, 'img'), { recursive: true });
for (const f of ['Inter_400Regular.ttf', 'Inter_800ExtraBold.ttf']) copyFileSync(join(ROOT, 'marketing/templates/fonts', f), join(SITE, 'fonts', f));
const sips = (...a) => execFileSync('sips', a, { stdio: 'ignore' });
sips('-z', '192', '192', join(ROOT, 'marketing/templates/icon-1024.png'), '--out', join(SITE, 'img/icon-192.png'));
sips('--resampleWidth', '440', join(ROOT, 'marketing/screenshots/raw/iphone-6.9/01-buffering.png'), '--out', join(SITE, 'img/app-buffering.png'));
writeFileSync(join(SITE, '.nojekyll'), '');
console.log('ok site/fonts site/img site/.nojekyll');
