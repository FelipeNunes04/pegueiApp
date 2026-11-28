# Kit para parceiros (pesqueiros, lojas de pesca, pousadas)

| Arquivo | O que é |
|---|---|
| `one-pager.pdf` | Uma página explicando o que o parceiro ganha, com exemplo do relatório mensal (números marcados como ilustrativos). Regenera com `node scripts/marketing-assets.mjs`. |
| `relatorio-<sponsor_id>.pdf` | Relatório mensal real de cada patrocinador do `marketing/media-kit/metricas.json` (`node scripts/media-kit.mjs --bq ... --mes AAAA-MM`). |
| `../media-kit/media-kit.pdf` | Media kit geral do Peguei, com as métricas reais do mês. |

Antes de mandar: troque `[a combinar]`, `[WhatsApp]` e `[e-mail]` no one-pager (em `scripts/marketing-assets.mjs`, função `onePager`), crie a campanha `parceiro_<slug>` (minúsculas, sem acento, ex.: `parceiro_pesqueiro_do_ze`) e gere o QR code a partir de `node scripts/utm-link.mjs site qrcode onepager parceiro_<slug>`.

O que o app entrega hoje para o parceiro (Remote Config, sem nova versão na loja; ver `docs/analytics.md`): `sponsor_id`, marca d'água no canto (`sponsor_position`), logo no cartão de espécie e peso (`overlay_sponsor_logo_url`) e o link "Conheça o patrocinador" (`sponsor_link_url`). É um patrocinador por vez. Não prometa segmentação por cidade antes de testar uma condição de Remote Config por região.

## Mensagem de abordagem (WhatsApp)

Primeiro contato, curto, sem anexo:

```
Oi, [nome]! Tudo bem? Sou o Felipe, criei o Peguei, um app grátis de câmera para pescaria: ele fica gravando e salva a fisgada que aconteceu antes do pescador tocar na tela.

Os pescadores aqui da região exportam esses vídeos para o WhatsApp e o Instagram. Estou procurando um parceiro para ter a marca nesses vídeos e no nosso grupo de pescadores.

Posso te mandar uma página explicando como funciona?
```

Se a pessoa responder que sim:

```
Aqui está: [one-pager.pdf]
Resumo: sua marca vai nos vídeos que os pescadores exportam no Peguei, com um botão que abre o seu [Instagram/WhatsApp/site], e todo mês eu te mando quantos vídeos saíram com a sua marca e quantas pessoas tocaram no seu link. Sem inventar número: é o que o app mede.
Se quiser, passo aí essa semana para mostrar no celular. Que dia fica bom?
```

Acompanhamento (uma vez só, depois de 5 a 7 dias sem resposta):

```
Oi, [nome]! Passando só para saber se você conseguiu ver a página do Peguei. Se não for o momento, sem problema, é só me avisar. Boa pescaria! 🎣
```

## Mensagem do relatório mensal

```
Oi, [nome]! Segue o relatório do Peguei de [mês]: [relatorio-<sponsor_id>.pdf]
• [N] vídeos saíram com a sua marca
• [N] foram enviados para WhatsApp, Instagram ou TikTok
• [N] toques no seu link
Lembrando: não é visualização nas redes, é o que saiu do app com a sua marca. Qualquer dúvida, me chama.
```
