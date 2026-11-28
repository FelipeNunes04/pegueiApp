#!/usr/bin/env node
// Media kit e relatório mensal do parceiro, preenchidos com as métricas reais.
//
//   node scripts/media-kit.mjs --bq PROJETO.analytics_XXXX --mes 2026-12
//       roda as consultas de marketing/media-kit/queries/ (derivadas de docs/metricas.md)
//       com o CLI `bq` (Google Cloud SDK, login feito) e grava marketing/media-kit/metricas.json
//   node scripts/media-kit.mjs
//       só renderiza a partir do metricas.json atual
//
// Saídas: marketing/media-kit/media-kit.pdf (+ .png de prévia) e
// marketing/parceiros/relatorio-<sponsor_id>.pdf para cada patrocinador do JSON.
// Campo null aparece como "[a preencher]": nada de número inventado.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, esc, page, pdf, png } from './lib/render.mjs';
import { utmLink } from './utm-link.mjs';

const DIR = join(ROOT, 'marketing/media-kit');
const JSON_PATH = join(DIR, 'metricas.json');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function runBq(table, mes) {
  const q = name => {
    const sql = readFileSync(join(DIR, 'queries', `${name}.sql`), 'utf8')
      .replaceAll('{{TABELA}}', table)
      .replaceAll('{{MES}}', mes);
    const out = execFileSync('bq', ['query', '--nouse_legacy_sql', '--format=json', '--max_rows=1000', sql], { encoding: 'utf8' });
    return JSON.parse(out || '[]').map(row =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v !== null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v])),
    );
  };
  const total = q('usuarios_ativos_total')[0] ?? {};
  return {
    mes,
    fonte: `bigquery ${table}`,
    gerado_em: new Date().toISOString(),
    usuarios_ativos_total: total.usuarios_ativos_total ?? null,
    dau_medio: total.dau_medio ?? null,
    usuarios_ativos_por_uf: q('usuarios_ativos_por_uf'),
    sessoes: q('sessoes')[0] ?? {},
    compartilhamentos_por_destino: q('compartilhamentos_por_destino'),
    patrocinadores: q('patrocinadores'),
  };
}

const fmt = (v, kind) => {
  if (v === null || v === undefined) return '<span class="ph">[a preencher]</span>';
  if (kind === 'pct') return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: kind === 'dec' ? 1 : 0 });
};

const CSS = `
@page{size:A4;margin:0}
html,body{width:210mm;overflow:visible}
body{background:#fff;color:var(--text-light);font-size:10pt}
.top{background:var(--brand-bg);color:#fff;padding:10mm 16mm 8mm}
.top .b{display:flex;align-items:center;gap:5mm}.top img{width:16mm;border-radius:4mm}
.top h1{margin:0;font-size:24pt;font-weight:800}.top p{margin:3mm 0 0;color:var(--muted)}
main{padding:5mm 16mm}
h2{font-size:12pt;color:var(--primary);margin:5mm 0 2mm;font-weight:800}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.kpi{border:1px solid #dfe7e6;border-radius:3mm;padding:4mm}.kpi b{display:block;font-size:18pt;font-weight:800;color:var(--primary)}
.kpi small{color:#4b5d5c}
table{width:100%;border-collapse:collapse}td,th{padding:1.4mm 1mm;border-bottom:1px solid #e6eceb;text-align:left}th{font-size:9pt;color:#4b5d5c}
td:last-child,th:last-child{text-align:right}
.ph{color:#a35f00;background:#fff4e0;border:1px dashed #F5A623;border-radius:1.5mm;padding:0 1.5mm;font-size:9pt}
.note{font-size:9pt;color:#4b5d5c;margin-top:6mm;line-height:1.45}
`;

function header(title, sub) {
  return `<div class="top"><div class="b"><img src="file://${ROOT}/marketing/templates/icon-1024.png" alt=""><h1>${esc(title)}</h1></div><p>${esc(sub)}</p></div>`;
}

function mediaKit(d) {
  const uf = (d.usuarios_ativos_por_uf ?? []).map(r => `<tr><td>${esc(r.uf)}</td><td>${fmt(r.usuarios_ativos)}</td></tr>`).join('');
  const share = (d.compartilhamentos_por_destino ?? []).map(r => `<tr><td>${esc(r.destino)}</td><td>${fmt(r.videos_compartilhados)}</td></tr>`).join('');
  const sp = (d.patrocinadores ?? [])
    .map(r => `<tr><td>${esc(r.sponsor_id)}</td><td>${fmt(r.videos_com_a_marca)}</td><td>${fmt(r.compartilhados_com_a_marca)}</td><td>${fmt(r.cliques_no_patrocinador)}</td></tr>`)
    .join('');
  const s = d.sessoes ?? {};
  const site = utmLink('site', 'parceiro', 'onepager', 'lancamento_2026_12', 'media_kit');
  return page(`${header('Peguei · media kit', `Câmera de pesca que guarda os segundos antes do toque. Dados de ${d.mes}.`)}
<main>
<h2>Quem usa</h2>
<div class="grid">
  <div class="kpi"><b>${fmt(d.usuarios_ativos_total)}</b><small>pescadores ativos no mês</small></div>
  <div class="kpi"><b>${fmt(d.dau_medio)}</b><small>ativos por dia, em média</small></div>
  <div class="kpi"><b>${fmt(s.sessoes)}</b><small>sessões de pesca no mês</small></div>
  <div class="kpi"><b>${fmt(s.duracao_media_min)}</b><small>minutos por sessão, em média</small></div>
  <div class="kpi"><b>${fmt(s.capturas_por_sessao, 'dec')}</b><small>vídeos salvos por sessão</small></div>
  <div class="kpi"><b>${fmt(s.pct_sessoes_com_captura, 'pct')}</b><small>das sessões salvam pelo menos 1 vídeo</small></div>
</div>
<h2>Pescadores ativos por estado</h2>
<table><tr><th>UF</th><th>Ativos no mês</th></tr>${uf}</table>
<h2>Vídeos compartilhados por destino</h2>
<table><tr><th>Destino</th><th>Vídeos</th></tr>${share}</table>
<h2>Patrocínio: vídeos com a marca</h2>
<table><tr><th>Patrocinador</th><th>Vídeos com a marca</th><th>Compartilhados com a marca</th><th>Cliques</th></tr>${sp}</table>
<p class="note"><b>Como medimos.</b> Firebase Analytics exportado para o BigQuery, consultas de <code>docs/metricas.md</code> (1 a 5). "Vídeos com a marca" conta exportações com a marca d'água; "compartilhados com a marca" conta quando o pescador escolheu um app para enviar. Não é visualização nas redes: o Peguei não sabe quantas pessoas viram o vídeo depois. A UF vem do cadastro opcional do app. Sem login, sem ID de publicidade, sem rastreamento entre apps.<br>
Fonte: ${esc(d.fonte)}${d.gerado_em ? `, gerado em ${esc(d.gerado_em.slice(0, 10))}` : ''}. Contato: [e-mail/WhatsApp do Felipe] · ${esc(site)}</p>
</main>`, CSS);
}

function report(d, sp) {
  const site = utmLink('site', 'parceiro', 'onepager', `parceiro_${sp.sponsor_id.replace(/[^a-z0-9]+/g, '_')}`, 'relatorio');
  return page(`${header(`Relatório mensal · ${sp.sponsor_id}`, `Seu alcance no Peguei em ${d.mes}.`)}
<main>
<h2>Alcance da sua marca</h2>
<div class="grid">
  <div class="kpi"><b>${fmt(sp.videos_com_a_marca)}</b><small>vídeos exportados com a sua marca</small></div>
  <div class="kpi"><b>${fmt(sp.compartilhados_com_a_marca)}</b><small>desses, enviados para WhatsApp, Instagram, TikTok...</small></div>
  <div class="kpi"><b>${fmt(sp.pescadores)}</b><small>pescadores diferentes</small></div>
</div>
<h2>Contatos</h2>
<div class="grid">
  <div class="kpi"><b>${fmt(sp.cliques_no_patrocinador)}</b><small>toques em "Conheça o patrocinador"</small></div>
  <div class="kpi"><b><span class="ph">[a preencher]</span></b><small>instalações pelo seu QR code (utm_source=qrcode, campanha parceiro_${esc(sp.sponsor_id)})</small></div>
  <div class="kpi"><b><span class="ph">[a preencher]</span></b><small>mensagens recebidas pelo link do grupo (conte no seu WhatsApp)</small></div>
</div>
<p class="note">Consulta 5 de <code>docs/metricas.md</code>. Não é visualização nas redes: contamos vídeos que saíram do Peguei com a sua marca e quantos foram enviados para algum app. ${esc(site)}</p>
</main>`, CSS);
}

const table = arg('bq');
let data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
if (table) {
  data = runBq(table, arg('mes') ?? data.mes);
  writeFileSync(JSON_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`ok ${JSON_PATH.replace(ROOT + '/', '')} (${data.fonte})`);
}
const kit = mediaKit(data);
pdf(kit, join(DIR, 'media-kit.pdf'));
png(kit.replace('html,body{width:210mm;overflow:visible}', 'html,body{width:794px;overflow:hidden}'), join(DIR, 'media-kit-preview.png'), 794, 1123);
for (const sp of data.patrocinadores ?? []) {
  pdf(report(data, sp), join(ROOT, 'marketing/parceiros', `relatorio-${sp.sponsor_id}.pdf`));
}
