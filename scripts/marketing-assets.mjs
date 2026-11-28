#!/usr/bin/env node
// Peças de marketing do Peguei, renderizadas com o Chrome headless:
//   marketing/instagram/carrossel/01..09.png (1080x1350)
//   marketing/instagram/stories/01..06.png   (1080x1920)
//   marketing/parceiros/one-pager.pdf (+ .png de prévia)
//   marketing/media-kit/media-kit.pdf e relatórios (scripts/media-kit.mjs)
//   site/og.png (1200x630, prévia do link da landing)
// As telas do app vêm de marketing/screenshots/raw/iphone-6.9 (scripts/store-assets.sh capture).
// Onde precisa de foto real de pescaria há um placeholder marcado "FOTO REAL DE PESCARIA AQUI".
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, esc, hl, page, pdf, png } from './lib/render.mjs';
import { utmLink } from './utm-link.mjs';

const RAW = join(ROOT, 'marketing/screenshots/raw/iphone-6.9');
const OUT = join(ROOT, 'marketing');
const ICON = `file://${ROOT}/marketing/templates/icon-1024.png`;
const shot = name => {
  const f = join(RAW, `${name}.png`);
  if (!existsSync(f)) throw new Error(`falta ${f}: rode scripts/store-assets.sh capture`);
  return `file://${f}`;
};
// Foto real de pescaria (quando Felipe fornecer): marketing/footage/foto-<n>.jpg
const photo = (n, label = 'FOTO REAL DE PESCARIA AQUI') => {
  const f = join(ROOT, `marketing/footage/foto-${n}.jpg`);
  return existsSync(f)
    ? `<div class="photo" style="background-image:url('file://${f}')"></div>`
    : `<div class="photo placeholder"><span>${esc(label)}<small>marketing/footage/foto-${n}.jpg</small></span></div>`;
};

const SOCIAL_CSS = `
body{position:relative;display:flex;flex-direction:column}
.brand{position:absolute;left:64px;bottom:56px;display:flex;align-items:center;gap:18px;font-weight:800;font-size:34px}
.brand img{width:64px;height:64px;border-radius:16px}
.handle{position:absolute;right:64px;bottom:66px;font-size:28px;color:var(--muted)}
.n{position:absolute;right:64px;top:56px;font-size:26px;color:var(--muted);font-weight:800}
h1{margin:0;font-weight:800;letter-spacing:-.02em;line-height:1.05;text-wrap:balance}
p{margin:0;color:var(--muted);line-height:1.32;text-wrap:balance}
.phone{background:#050a0a;padding:12px;border-radius:56px;box-shadow:0 30px 90px rgba(0,0,0,.55),0 0 0 2px rgba(255,255,255,.08)}
.phone img{display:block;width:100%;border-radius:44px}
.photo{background-size:cover;background-position:center;border-radius:36px;height:100%}
.photo.placeholder span{display:flex;flex-direction:column;gap:14px;font-size:38px;padding:30px}
.photo.placeholder small{font-size:20px;color:var(--text-dark);font-weight:400;letter-spacing:0}
.tl{display:flex;align-items:center;gap:0;margin-top:40px}
.tl div{height:64px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;border-radius:14px}
.tl .before{flex:3;background:var(--primary-light);color:#062626}
.tl .tap{width:64px;background:var(--accent);color:#2b1a00;border-radius:50%;margin:0 -10px;z-index:1}
.tl .after{flex:2;background:var(--secondary)}
table{border-collapse:collapse;width:100%;font-size:29px}
td{padding:18px 14px;border-bottom:2px solid rgba(255,255,255,.1);vertical-align:top;line-height:1.25}
td:first-child{color:var(--muted);width:30%}
th{font-size:30px;text-align:left;padding:0 14px 16px}
th.p{color:var(--accent)}
`;

const footer = (n, total) =>
  `<div class="brand"><img src="${ICON}" alt="">Peguei</div><div class="handle">@pegueiapp</div>${n ? `<div class="n">${n}/${total}</div>` : ''}`;

// ------------------------------------------------------------ carrossel 1080x1350
const W = 1080, H = 1350;
const C = [
  // 1 capa
  () => `${photo(1)}<style>.photo{position:absolute;inset:0;border-radius:0;opacity:.95}</style>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,20,20,.1) 30%,rgba(10,20,20,.92) 75%)"></div>
    <div style="position:absolute;left:64px;right:64px;bottom:170px"><h1 style="font-size:104px">${hl('Nunca mais perca a [fisgada]')}</h1>
    <p style="font-size:38px;margin-top:24px">O app que guarda os segundos antes do seu toque. Grátis para Android e iPhone.</p></div>`,
  // 2 problema
  () => `<div style="padding:150px 64px 0"><h1 style="font-size:84px">${hl('O peixe fisgou. Você ainda estava [procurando o botão de gravar].')}</h1>
    <p style="font-size:38px;margin-top:36px">Quando você aperta, a melhor parte já passou.</p></div>
    <div style="margin:50px 64px 0;height:470px">${photo(2, 'FOTO REAL: PESCADOR COM O CELULAR NA MÃO, PEIXE JÁ FISGADO')}</div>`,
  // 3 como funciona
  () => `<div style="display:flex;gap:56px;padding:120px 64px 0;align-items:center">
    <div style="flex:1"><h1 style="font-size:76px">${hl('O Peguei fica [sempre gravando]')}</h1>
    <p style="font-size:36px;margin-top:30px">E guarda só os últimos segundos, sem encher a memória do celular.</p></div>
    <div class="phone" style="width:400px"><img src="${shot('01-buffering')}"></div></div>`,
  // 4 toque
  () => `<div style="padding:120px 64px 0"><h1 style="font-size:80px">${hl('Fisgou? [Toque na tela.]')}</h1>
    <p style="font-size:38px;margin-top:26px">O vídeo salvo já começa antes do toque.</p>
    <div class="tl"><div class="before">até 60 s antes</div><div class="tap">●</div><div class="after">depois do toque</div></div></div>
    <div class="phone" style="width:360px;margin:56px auto 0"><img src="${shot('02-recording')}" style="height:620px;object-fit:cover;object-position:bottom"></div>`,
  // 5 buffer
  () => `<div style="display:flex;gap:56px;padding:120px 64px 0;align-items:center">
    <div class="phone" style="width:400px"><img src="${shot('03-settings')}"></div>
    <div style="flex:1"><h1 style="font-size:80px">${hl('Até [60 segundos] de buffer')}</h1>
    <p style="font-size:36px;margin-top:30px">Você escolhe de 15 a 60 s, e a qualidade do vídeo conforme a câmera do seu celular.</p></div></div>`,
  // 6 lente
  () => `<div style="display:flex;gap:56px;padding:120px 64px 0;align-items:center">
    <div style="flex:1"><h1 style="font-size:80px">${hl('Lente [0,5x] para pegar a cena toda')}</h1>
    <p style="font-size:36px;margin-top:30px">Barco, vara e peixe no mesmo quadro, nos celulares com ultra-angular.</p></div>
    <div class="phone" style="width:400px"><img src="${shot('04-wide')}"></div></div>`,
  // 7 export
  () => `<div style="display:flex;gap:56px;padding:120px 64px 0;align-items:center">
    <div class="phone" style="width:400px"><img src="${shot('05-export')}"></div>
    <div style="flex:1"><h1 style="font-size:80px">${hl('Pronto para [Reels e TikTok]')}</h1>
    <p style="font-size:36px;margin-top:30px">Exporta em 9:16 com a espécie e o peso no vídeo. O original fica guardado.</p></div></div>`,
  // 8 comparativo (só texto, sem logo nem imagem de terceiros)
  () => `<div style="padding:110px 64px 0"><h1 style="font-size:68px">${hl('Peguei ou GoPro? Para quem [já tem um celular com boa câmera]')}</h1>
    <table style="margin-top:44px"><tr><th></th><th class="p">Peguei</th><th>GoPro</th></tr>
    <tr><td>Custo</td><td>Grátis, usa o celular que você já tem</td><td>Mais um aparelho para comprar</td></tr>
    <tr><td>Antes do toque</td><td>15 a 60 s, você escolhe</td><td>HindSight em alguns modelos</td></tr>
    <tr><td>Para postar</td><td>Já está no celular, 9:16 pronto</td><td>Passa da câmera para o celular</td></tr>
    <tr><td>Água e pancada</td><td>Use capa ou suporte</td><td>Feita para isso</td></tr></table>
    <p style="font-size:30px;margin-top:34px">Já tem o celular? Comece pelo Peguei. Dá para usar os dois.</p></div>`,
  // 9 CTA
  () => `<div style="margin:120px 64px 0;height:540px">${photo(3, 'VÍDEO/FOTO REAL DE PESCARIA AQUI')}</div>
    <div style="padding:56px 64px 0"><h1 style="font-size:92px">${hl('Baixe [grátis]')}</h1>
    <p style="font-size:38px;margin-top:24px">Android e iPhone. Sem assinatura. Link na bio.</p></div>`,
];

// ------------------------------------------------------------ stories 1080x1920
const SW = 1080, SH = 1920;
const S = [
  () => `<div style="padding:300px 72px 0"><h1 style="font-size:104px">${hl('Você já perdeu a [fisgada] por não estar gravando?')}</h1></div>
    <div class="photo placeholder" style="margin:90px 72px 0;height:420px;border-radius:40px"><span>ÁREA DA ENQUETE (SIM / NÃO)<small>adicionar o adesivo de enquete no Instagram</small></span></div>`,
  () => `<div style="padding:260px 72px 0"><h1 style="font-size:96px">${hl('Como o Peguei [funciona]')}</h1>
    <p style="font-size:46px;margin-top:70px;color:#fff;line-height:1.5">1. Abra e apoie o celular.<br>2. Ele fica gravando sozinho.<br>3. Fisgou? Toque na tela.<br>4. O vídeo já vem com o antes.</p></div>`,
  () => `<div style="padding:190px 72px 0"><h1 style="font-size:92px">${hl('Toque quando [fisgar]')}</h1></div>
    <div class="phone" style="width:640px;margin:80px auto 0"><img src="${shot('02-recording')}"></div>`,
  () => `<div style="padding:300px 72px 0"><h1 style="font-size:100px">${hl('Até [60 s] antes do toque')}</h1>
    <div class="tl" style="margin-top:90px"><div class="before" style="height:96px;font-size:34px">antes</div><div class="tap" style="width:96px;height:96px">●</div><div class="after" style="height:96px;font-size:34px">depois</div></div>
    <p style="font-size:44px;margin-top:70px">Você escolhe de 15 a 60 s em Configurações.</p></div>`,
  () => `<div style="padding:300px 72px 0"><h1 style="font-size:92px">${hl('Já tem um celular com [boa câmera]?')}</h1>
    <p style="font-size:48px;margin-top:60px;color:#fff">Antes de comprar uma câmera de ação, teste o Peguei: é grátis e guarda até 60 s antes do seu toque.</p></div>`,
  () => `<div style="margin:180px 72px 0;height:820px">${photo(4, 'VÍDEO REAL DE PESCARIA AQUI')}</div>
    <div style="padding:70px 72px 0"><h1 style="font-size:100px">${hl('Baixe [grátis]')}</h1>
    <div class="photo placeholder" style="margin-top:50px;height:150px;border-radius:30px"><span style="font-size:30px">ADESIVO DE LINK AQUI<small>${esc(utmLink('site', 'instagram', 'story', 'lancamento_2026_12', 'story_06'))}</small></span></div></div>`,
];

// ------------------------------------------------------------ one-pager A4
function onePager() {
  const qr = utmLink('site', 'qrcode', 'onepager', 'parceiro_slug');
  const site = utmLink('site', 'parceiro', 'onepager', 'parceiro_slug');
  return page(`
<div class="top"><div class="b"><img src="${ICON}" alt=""><div><h1>Seja parceiro do Peguei</h1>
<p>Para pesqueiros, lojas de pesca e pousadas da região</p></div></div></div>
<main>
<p class="lead">O Peguei é um app grátis que deixa a câmera do celular sempre gravando e salva a fisgada que aconteceu antes do toque. Os pescadores exportam o vídeo em 9:16 e mandam para o WhatsApp, o Instagram e o TikTok. Sua marca pode ir junto.</p>
<h2>O que você ganha</h2>
<ul>
<li><b>Sua marca nos vídeos de pesca.</b> No período combinado, os vídeos exportados pelos pescadores saem com a sua marca d'água num canto do vídeo, e o app avisa o pescador antes de exportar. Um patrocinador por vez.</li>
<li><b>Link para o seu negócio.</b> Na tela de exportar aparece "Conheça o patrocinador", que abre o seu site, Instagram ou WhatsApp.</li>
<li><b>Destaque na comunidade.</b> Post de parceiro no @pegueiapp e apresentação no grupo de WhatsApp regional de pescadores.</li>
<li><b>QR code no balcão.</b> Um cartaz com QR code que leva ao Peguei com o seu código de parceiro. Assim sabemos quantas pessoas chegaram por você.</li>
<li><b>Relatório mensal.</b> Números reais tirados do app, sem enfeite (veja o exemplo abaixo).</li>
</ul>
<h2>Exemplo do relatório mensal</h2>
<p class="ex">Exemplo ilustrativo do formato. <b>Os números abaixo não são dados reais.</b></p>
<table>
<tr><th>Indicador</th><th>O que é</th><th>Exemplo</th></tr>
<tr><td>Vídeos com a sua marca</td><td>Vídeos exportados no Peguei com a sua marca d'água</td><td><span class="ph">000</span></td></tr>
<tr><td>Compartilhados com a marca</td><td>Desses, quantos o pescador enviou para algum app</td><td><span class="ph">000</span></td></tr>
<tr><td>Pescadores diferentes</td><td>Quantas pessoas exportaram com a sua marca</td><td><span class="ph">00</span></td></tr>
<tr><td>Contatos</td><td>Toques em "Conheça o patrocinador"</td><td><span class="ph">00</span></td></tr>
<tr><td>Chegadas pelo QR code</td><td>Visitas e instalações pelo seu cartaz</td><td><span class="ph">00</span></td></tr>
</table>
<p class="note">Não contamos visualizações nas redes: o Peguei não sabe quantas pessoas viram o vídeo depois de enviado. O app não tem login, não usa ID de publicidade e não rastreia o pescador entre apps.</p>
<h2>Como começar</h2>
<p>Valor: <span class="ph">[a combinar]</span>. Mande o seu logo (PNG com fundo transparente) e o link que o botão deve abrir. Em poucos dias a marca entra no app, sem precisar de atualização da loja.</p>
<div class="contact"><div><b>Felipe · Peguei</b><br><span class="ph">[WhatsApp]</span> · <span class="ph">[e-mail]</span><br><small>${esc(site)}</small></div>
<div class="qr placeholder"><span>QR CODE<small>gerar a partir de:<br>${esc(qr)}</small></span></div></div>
</main>`, `
@page{size:A4;margin:0}
html,body{width:210mm;overflow:visible}
body{background:#fff;color:var(--text-light);font-size:9.6pt;line-height:1.38}
.top{background:var(--brand-bg);color:#fff;padding:9mm 14mm}
.b{display:flex;align-items:center;gap:6mm}.b img{width:20mm;border-radius:5mm}
.top h1{margin:0;font-size:24pt;font-weight:800}.top p{margin:1mm 0 0;color:var(--muted);font-size:12pt}
main{padding:4mm 14mm}
.lead{font-size:11pt;margin:0}
h2{font-size:12pt;color:var(--primary);margin:4mm 0 1.5mm;font-weight:800}
ul{margin:0;padding-left:5mm}li{margin-bottom:1.2mm}
table{width:100%;border-collapse:collapse;font-size:9.5pt}td,th{padding:1.8mm 1.5mm;border-bottom:1px solid #e6eceb;text-align:left}th{color:#4b5d5c;font-size:9pt}
.ph{color:#a35f00;background:#fff4e0;border:1px dashed #F5A623;border-radius:1.5mm;padding:0 1.5mm}
.ex{margin:0 0 2mm;color:#a35f00;font-size:9.5pt}
.note{font-size:9pt;color:#4b5d5c}
.contact{display:flex;justify-content:space-between;align-items:center;margin-top:5mm;padding:4mm;border:1px solid #dfe7e6;border-radius:3mm}
.contact small{color:#4b5d5c;font-size:7.5pt;word-break:break-all}
.qr{width:28mm;height:28mm;border-width:2px;font-size:9pt;flex:none;border-radius:2mm}.qr span{display:flex;flex-direction:column;gap:1mm}
.qr small{font-size:5.5pt;font-weight:400;color:#14201F;word-break:break-all;letter-spacing:0}
.placeholder{color:#a35f00}
`);
}

// ------------------------------------------------------------ og image 1200x630
const og = () => page(`<div style="display:flex;align-items:center;gap:60px;padding:0 80px;height:100%">
  <div style="flex:1"><div style="display:flex;align-items:center;gap:20px;font-weight:800;font-size:44px"><img src="${ICON}" style="width:96px;border-radius:22px">Peguei</div>
  <h1 style="font-size:76px;margin-top:30px">${hl('Nunca mais perca a [fisgada]')}</h1>
  <p style="font-size:30px;margin-top:20px">Grátis para Android e iPhone</p></div>
  <div class="phone" style="width:300px;transform:rotate(-4deg);margin-top:180px"><img src="${shot('01-buffering')}"></div></div>`,
  SOCIAL_CSS, { width: 1200, height: 630 });

C.forEach((fn, i) => png(page(fn() + footer(i + 1, C.length), SOCIAL_CSS, { width: W, height: H }),
  join(OUT, 'instagram/carrossel', `${String(i + 1).padStart(2, '0')}.png`), W, H));
S.forEach((fn, i) => png(page(fn() + footer(0, 0), SOCIAL_CSS, { width: SW, height: SH }),
  join(OUT, 'instagram/stories', `${String(i + 1).padStart(2, '0')}.png`), SW, SH));
const op = onePager();
pdf(op, join(OUT, 'parceiros/one-pager.pdf'));
png(op.replace('html,body{width:210mm;overflow:visible}', 'html,body{width:794px;overflow:hidden}'), join(OUT, 'parceiros/one-pager-preview.png'), 794, 1123);
png(og(), join(ROOT, 'site/og.png'), 1200, 630);
execFileSync('node', [join(ROOT, 'scripts/media-kit.mjs')], { stdio: 'inherit' });
