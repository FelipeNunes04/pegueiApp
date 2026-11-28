// Renderiza HTML em PNG ou PDF com o Chrome headless (substitui o Playwright).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
export const TPL = join(ROOT, 'marketing/templates');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = mkdtempSync(join(tmpdir(), 'peguei-mkt-'));
let n = 0;

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** "[texto]" vira destaque laranja. */
export const hl = s => esc(s).replace(/\[([^\]]+)\]/g, '<span class="a">$1</span>');

/** Página HTML com o CSS da marca, servida de um arquivo temporário. */
export function page(body, css = '', { width, height } = {}) {
  const size = width ? `html,body{width:${width}px;height:${height}px}` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${TPL}/brand.css"><style>${size}${css}</style></head><body>${body}</body></html>`;
}

function tmpHtml(html) {
  const file = join(WORK, `p${++n}.html`);
  writeFileSync(file, html);
  return file;
}

const BASE = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--allow-file-access-from-files', '--virtual-time-budget=5000'];

export function png(html, out, width, height) {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync(CHROME, [...BASE, `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${tmpHtml(html)}`], { stdio: 'ignore' });
  console.log(`ok ${out.replace(ROOT + '/', '')}`);
}

export function pdf(html, out) {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync(CHROME, [...BASE, '--no-pdf-header-footer', `--print-to-pdf=${out}`, `file://${tmpHtml(html)}`], { stdio: 'ignore' });
  console.log(`ok ${out.replace(ROOT + '/', '')}`);
}
