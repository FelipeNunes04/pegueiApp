# Lojas e marketing do Peguei

Tudo o que vai para a App Store, a Google Play e as redes. **Nada aqui envia arquivo para loja nenhuma**: o upload só acontece pelos comandos da seção "Enviar para as lojas", depois da confirmação do Felipe.

```bash
scripts/store-assets.sh                 # regenera tudo (footage, build, capture, frame, video, marketing, validate)
scripts/store-assets.sh capture frame   # só recaptura as telas e remonta as artes (a UI mudou)
scripts/store-assets.sh video           # só os vídeos de preview
scripts/swap-footage.sh pescaria.mp4 [foto.jpg] [trilha.m4a]   # troca os placeholders pelo material real
node scripts/validate-store-text.mjs     # limites de caractere dos textos
```

Requisitos: Xcode 26.5 em `/Volumes/DevSSD/Applications/Xcode-26.5.0.app` (o script exporta `DEVELOPER_DIR`, nunca usa `xcode-select`), simulador iOS 26.5, Google Chrome (renderiza os templates HTML no lugar do Playwright), ffmpeg e Node. Sem fastlane instalado: os comandos de upload estão documentados abaixo.

## Limites e tamanhos das lojas (conferidos em 28/11/2026)

### App Store

| Item | Regra | Fonte |
|---|---|---|
| Screenshot iPhone 6,9" | 1320 × 2868 (também aceita 1290 × 2796 e 1260 × 2736) retrato; PNG/JPG sem canal alfa; 1 a 10 por tamanho. Se faltar o 6,5", a Apple reduz o 6,9". | [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications) |
| Screenshot iPad 13" | 2064 × 2752 ou 2048 × 2732. **Obrigatório**, porque o Peguei roda em iPad (`TARGETED_DEVICE_FAMILY = "1,2"` em `ios/Peguei.xcodeproj`). | idem |
| App Preview | 15 a 30 s; H.264 (.mov/.m4v/.mp4) de 10 a 12 Mb/s, High Profile até nível 4.0, no máximo 30 fps; áudio AAC estéreo 256 kb/s, 44,1 ou 48 kHz; até 500 MB; até 3 por tamanho e idioma. Resolução retrato do iPhone 6,9"/6,7"/6,5": **886 × 1920**; iPad 13": 1200 × 1600. | [App preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications) |
| Nome / subtítulo | 30 caracteres cada | [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information); o próprio campo do App Store Connect também mostra o limite |
| Palavras-chave | 100 **bytes** (acento conta 2), separadas por vírgula | [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information) |
| Texto promocional | 170 caracteres (troca sem nova revisão) | idem |
| Descrição / novidades | 4000 caracteres cada | idem |

### Google Play

| Item | Regra | Fonte |
|---|---|---|
| Ícone | PNG 32 bits, 512 × 512, até 1024 KB | [Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) |
| Feature graphic | JPEG ou PNG 24 bits sem alfa, 1024 × 500 | idem |
| Screenshots de telefone | 2 a 8; PNG/JPEG até 8 MB; lados entre 320 e 3840 px; lado maior até 2,3× o menor; recomendado 9:16 com pelo menos 1080 px | idem |
| Vídeo | Um link do YouTube (vídeo, não playlist), público ou não listado, sem anúncios, sem restrição de idade, incorporável. Só os 30 primeiros segundos tocam sozinhos. | idem |
| Título / descrição curta / completa | 30 / 80 / 4000 caracteres | Play Console → Ficha da loja principal (contador em cada campo); a descrição curta de 80 também está na página acima |
| Notas da versão | 500 caracteres por idioma | Play Console → Versão → Notas da versão |

## Onde fica cada coisa

| Caminho | O que é |
|---|---|
| `fastlane/metadata/pt-BR`, `en-US` | Textos da App Store (formato do `deliver`) |
| `fastlane/metadata/android/pt-BR`, `en-US` | Textos da Play e `images/` (ícone, feature graphic, 5 screenshots) no formato do `supply` |
| `fastlane/screenshots/pt-BR` | 5 artes iPhone 6,9" (1320 × 2868) e 5 iPad 13" (2064 × 2752) |
| `marketing/screenshots/raw` | Capturas cruas do simulador, antes da moldura |
| `marketing/video` | `app-preview-ios-886x1920.mp4` (App Store, 28 s), `preview-vertical-1080x1920.mp4` (Shorts/Reels/TikTok), `preview-youtube-1920x1080.mp4` (link da Play) |
| `marketing/footage/placeholder` | Placeholders "VÍDEO REAL DE PESCARIA AQUI" (quadro e clipe de 12 s) |
| `marketing/templates` | Templates HTML (moldura, legendas do vídeo, cartão final, feature graphic) e a marca (`brand.css`, fontes Inter, ícone) |
| `marketing/aso.md` | Palavras-chave com justificativa |
| `marketing/utm.md` | Padrão de UTM (comum ao Pesca Certa) |
| `marketing/instagram` | Carrossel de lançamento (9 × 1080 × 1350), 6 stories (1080 × 1920) e legendas |
| `marketing/peguei-vs-gopro.md` | Comparativo, só texto |
| `marketing/tiktok-reels.md` | 10 roteiros |
| `marketing/whatsapp-grupo.md` | Descrição, regras e boas-vindas do grupo (a previsão de quinta é do Pesca Certa) |
| `marketing/parceiros` | One-pager PDF, mensagens de abordagem e relatórios mensais |
| `marketing/media-kit` | Media kit PDF, `metricas.json` e as consultas do BigQuery |
| `site/` | Landing page (GitHub Pages) |

## Como as telas e os vídeos são capturados

O simulador não tem câmera. Para mostrar a tela real do app, existe um **modo demo** (`src/demo/`):

- Só existe em build de **debug** (`__DEV__`). Em Release o minificador elimina a leitura do argumento `pegueiDemo` (a string nem aparece no bundle de produção), então TestFlight, App Store e Play nunca entram nele.
- Mesmo no debug, só liga com o launch argument `-pegueiDemo 1 -demoScene <cena>` (`xcrun simctl launch`). Sem ele, o app é o normal.
- Em modo demo a câmera **não toca no código nativo**: não abre sessão de câmera, encoder nem buffer. O preview é `DemoCameraPreview` (o quadro de `marketing/footage/frame.jpg`, ou o placeholder) e a gravação é uma máquina de estados em JS que move o mesmo `recordingStore` que a tela real usa. Botões, indicador de buffer, tempo de gravação, pills de zoom e aviso de salvo são os componentes reais do app.
- Cenas: `buffering`, `recording`, `wide` (0,5x), `settings`, `gallery`, `clip` (player do clipe salvo), `export` e `story` (roteiro do preview: espera 6 s, toque, grava 4 s, salva).
- O script copia o clipe de pescaria (placeholder ou real) para `Documents/PegueiClips` do app no simulador, então galeria, player e tela de exportar mostram um vídeo de verdade.

Os vídeos são gravações de tela do simulador (`simctl io recordVideo`) montadas com ffmpeg (`-preset veryfast`, H.264): cena `story` (0 a 12 s), clipe salvo tocando no player do app com a fisgada que veio antes do toque (12 a 24,5 s) e cartão final. Legendas em pt-BR são PNGs transparentes renderizados pelo Chrome (o ffmpeg desta máquina não tem `drawtext`). Áudio: silêncio estéreo, ou `marketing/footage/trilha.*` com fade no fim.

**Android:** o modo demo usa launch arguments do iOS. As 5 artes da Play saem das mesmas capturas do iPhone, com a barra de status do iOS cortada e moldura sem ilha. Quando houver um aparelho Android com a câmera real, troque por capturas dele.

## Enviar para as lojas (só depois da confirmação do Felipe)

Instale o fastlane só nessa hora (`gem install fastlane` ou `bundle exec`, o `Gemfile` já existe). Revise antes com `node scripts/validate-store-text.mjs`.

**App Store** (textos e screenshots; o `deliver` não envia App Preview):

```bash
fastlane deliver --api_key_path <app-store-connect-api-key.json> \
  --app_identifier com.felipenunes.pegueiapp \
  --metadata_path fastlane/metadata --screenshots_path fastlane/screenshots \
  --skip_binary_upload true --overwrite_screenshots true \
  --submit_for_review false --run_precheck_before_submit false --force false
```

O `--force false` mostra a prévia em HTML e pede confirmação antes de enviar. O preview `marketing/video/app-preview-ios-886x1920.mp4` vai à mão em App Store Connect → versão → Pré-visualizações de apps (iPhone 6,9"). Para iPad não há preview: a Apple aceita só screenshots.

**Google Play** (textos, ícone, feature graphic e screenshots, sem binário):

```bash
fastlane supply --json_key google-play-service-account.json \
  --package_name com.felipenunes.pegueiapp --metadata_path fastlane/metadata/android \
  --skip_upload_apk true --skip_upload_aab true --validate_only true   # confere sem publicar
# depois, sem --validate_only, para enviar de verdade
```

O vídeo da Play é o `preview-youtube-1920x1080.mp4` publicado no YouTube (não listado, sem anúncios) e colado no campo "Vídeo de pré-visualização" do Play Console.

## Checklist manual do Felipe

- [ ] Gravar a pescaria real (vertical, 12 a 20 s: espera, fisgada, peixe) e rodar `scripts/swap-footage.sh pescaria.mp4 [foto.jpg] [trilha.m4a]`. Isso regenera screenshots, previews e peças.
- [ ] Fotos reais para o Instagram: `marketing/footage/foto-1.jpg` a `foto-4.jpg`, depois `node scripts/marketing-assets.mjs`.
- [ ] Trilha sem direitos autorais (ou deixar em silêncio).
- [ ] Conferir no site da GoPro os dois pontos marcados em `marketing/peguei-vs-gopro.md` antes de publicar o comparativo.
- [ ] Revisar os textos em `fastlane/metadata` (nome novo "Peguei: câmera de pesca") e confirmar o upload; depois rodar os comandos acima.
- [ ] App Store Connect: subir o App Preview à mão; pegar o token do provedor (`pt`) e usar `PEGUEI_APPLE_PT=<token> node scripts/utm-link.mjs appstore ...` nos links de campanha.
- [ ] YouTube: publicar `preview-youtube-1920x1080.mp4` como não listado e colar o link na Play.
- [ ] GitHub Pages: Settings → Pages → Source "GitHub Actions" e variável de repositório `PAGES_ENABLED=true`; depois rodar o workflow "Landing page".
- [ ] Trocar o link do grupo de WhatsApp em `site/index.html` (`#grupo-whatsapp-link-aqui`) e preencher `[cidade]` em `marketing/whatsapp-grupo.md`.
- [ ] One-pager: preencher `[a combinar]`, `[WhatsApp]`, `[e-mail]` (`scripts/marketing-assets.mjs`, função `onePager`) e gerar o QR code de cada parceiro.
- [ ] Media kit: ligar o export do BigQuery (`docs/metricas.md`), instalar o Google Cloud SDK e rodar `node scripts/media-kit.mjs --bq <PROJETO.analytics_XXXX> --mes AAAA-MM` no começo de cada mês.
- [ ] Criar o perfil @pegueiapp no Instagram e no TikTok (se ainda não existir) com o link da bio de `marketing/instagram/legendas.md`.
- [ ] Screenshots de Android reais quando possível (o modo demo é só iOS).
