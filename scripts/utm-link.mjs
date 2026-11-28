#!/usr/bin/env node
// Monta links com UTM no padrão comum de Peguei e Pesca Certa (marketing/utm.md).
//
//   node scripts/utm-link.mjs <destino> <utm_source> <utm_medium> <utm_campaign> [utm_content]
//   destino: site | appstore | play | peguei (deep link) | qualquer URL https
//
//   node scripts/utm-link.mjs play instagram bio lancamento_2026_12
//   node scripts/utm-link.mjs site parceiro onepager parceiro_pesqueiro_do_ze
//
// Também exporta utmLink() para os outros scripts (marketing-assets.mjs).
export const SOURCES = ['instagram', 'tiktok', 'whatsapp', 'site', 'parceiro', 'qrcode', 'youtube'];
export const MEDIUMS = ['post', 'story', 'reels', 'bio', 'grupo', 'onepager', 'landing', 'video'];
const CAMPAIGN = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export const DESTINATIONS = {
  site: 'https://felipenunes04.github.io/pegueiApp/',
  appstore: 'https://apps.apple.com/br/app/peguei/id6790596334',
  play: 'https://play.google.com/store/apps/details?id=com.felipenunes.pegueiapp',
  peguei: 'peguei://camera',
};

export function utmLink(dest, source, medium, campaign, content) {
  if (!SOURCES.includes(source)) throw new Error(`utm_source inválido: ${source} (use ${SOURCES.join(' | ')})`);
  if (!MEDIUMS.includes(medium)) throw new Error(`utm_medium inválido: ${medium} (use ${MEDIUMS.join(' | ')})`);
  if (!CAMPAIGN.test(campaign)) throw new Error(`utm_campaign inválido: ${campaign} (minúsculas, números e _)`);
  if (content !== undefined && !CAMPAIGN.test(content)) throw new Error(`utm_content inválido: ${content}`);
  const base = DESTINATIONS[dest] ?? dest;
  if (!DESTINATIONS[dest] && !/^https:\/\//.test(base)) throw new Error(`destino inválido: ${dest}`);
  const utm = new URLSearchParams({ utm_source: source, utm_medium: medium, utm_campaign: campaign });
  if (content) utm.set('utm_content', content);
  const url = new URL(base);
  if (dest === 'play') {
    // A Play repassa o "referrer" para o Firebase (first_open: source/medium/campaign).
    url.searchParams.set('referrer', utm.toString());
  } else if (dest === 'appstore') {
    // App Store Connect → Analytics → Fontes → Links de campanha: ct (até 40 caracteres)
    // e pt (token do provedor, em App Store Connect → Analytics). Sem pt, o ct é ignorado.
    url.searchParams.set('ct', `${source}_${medium}_${campaign}`.slice(0, 40));
    if (process.env.PEGUEI_APPLE_PT) url.searchParams.set('pt', process.env.PEGUEI_APPLE_PT);
    url.searchParams.set('mt', '8');
  } else {
    utm.forEach((v, k) => url.searchParams.set(k, v));
  }
  return url.toString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dest, source, medium, campaign, content] = process.argv.slice(2);
  if (!campaign) {
    console.error('uso: node scripts/utm-link.mjs <site|appstore|play|peguei|https://...> <source> <medium> <campaign> [content]');
    process.exit(2);
  }
  try {
    console.log(utmLink(dest, source, medium, campaign, content));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
