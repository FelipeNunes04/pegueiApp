# Padrão de UTM (Peguei e Pesca Certa)

O mesmo padrão vale para os dois apps, para que as consultas do BigQuery (`install_source`, consulta 1 de `docs/metricas.md`) e o Firebase comparem as fontes entre eles. **Todo link publicado leva UTM.** Monte sempre com o script, que recusa valores fora da lista:

```bash
node scripts/utm-link.mjs <destino> <utm_source> <utm_medium> <utm_campaign> [utm_content]
```

`destino`: `site` (landing page), `appstore`, `play`, `peguei` (deep link `peguei://camera`) ou qualquer URL `https://`.

## Valores permitidos

| Parâmetro | Valores |
|---|---|
| `utm_source` | `instagram` · `tiktok` · `whatsapp` · `site` · `parceiro` · `qrcode` · `youtube` |
| `utm_medium` | `post` · `story` · `reels` · `bio` · `grupo` · `onepager` · `landing` · `video` |
| `utm_campaign` | `lancamento_2026_12` (lançamento), `parceiro_<slug>` (um por parceiro, ex.: `parceiro_pesqueiro_do_ze`), outras em minúsculas com `_` |
| `utm_content` (opcional) | qual peça: `carrossel_01`, `story_03`, `roteiro_07`, `botao_play` |

Nada de maiúsculas, acento ou espaço. Uma campanha nova vira uma linha nesta tabela antes de ser usada:

| Campanha | Uso |
|---|---|
| `lancamento_2026_12` | Lançamento em dezembro de 2026: posts, stories, Reels, TikTok, grupo de WhatsApp |
| `parceiro_<slug>` | Material de cada parceiro (one-pager, QR code no balcão, mensagem de WhatsApp) |
| `app_store_suporte`, `app_store_marketing` | URLs de suporte e marketing da ficha da App Store (`fastlane/metadata/*/support_url.txt`) |

## Como cada loja recebe a UTM

- **Google Play**: o script põe a UTM dentro de `referrer=` (`...details?id=com.felipenunes.pegueiapp&referrer=utm_source%3D...`). A Play repassa o referrer para o Firebase, que preenche `source`, `medium` e `campaign` no `first_open`.
- **App Store**: a Apple não lê UTM. O script gera um link de campanha com `ct=<source>_<medium>_<campaign>` (até 40 caracteres) e, se a variável `PEGUEI_APPLE_PT` estiver definida, o `pt` (token do provedor, em App Store Connect → Analytics → Fontes). Os números aparecem em App Store Connect → Analytics → Campanhas, não no Firebase.
- **Landing page** (`site/`): a página copia a UTM que recebeu para os botões das lojas, então quem chega por `?utm_source=instagram&utm_medium=bio` e toca em "Google Play" leva a mesma UTM.
- **Deep link** `peguei://camera?utm_source=...`: o app lê `utm_source` e `utm_campaign` (`src/analytics/lifecycle.ts`) e grava `install_source` na primeira abertura.

## Exemplos prontos

| Peça | Link |
|---|---|
| Bio do Instagram | `node scripts/utm-link.mjs site instagram bio lancamento_2026_12` |
| Link no story | `node scripts/utm-link.mjs site instagram story lancamento_2026_12 story_06` |
| Descrição do TikTok | `node scripts/utm-link.mjs site tiktok video lancamento_2026_12 roteiro_01` |
| Vídeo do YouTube | `node scripts/utm-link.mjs site youtube video lancamento_2026_12` |
| Grupo de WhatsApp | `node scripts/utm-link.mjs site whatsapp grupo lancamento_2026_12` |
| One-pager de um parceiro | `node scripts/utm-link.mjs site parceiro onepager parceiro_<slug>` |
| QR code no balcão do parceiro | `node scripts/utm-link.mjs site qrcode onepager parceiro_<slug>` |
| Botão da Play na landing | gerado pela própria página com `utm_source=site&utm_medium=landing` quando a visita não trouxe UTM |
