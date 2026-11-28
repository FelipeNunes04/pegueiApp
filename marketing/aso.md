# ASO do Peguei

Os textos das lojas ficam em **`fastlane/metadata`** (fonte única; a antiga pasta `store-listing/` foi substituída por ela):

| Campo | App Store (`fastlane/metadata/<idioma>/`) | Google Play (`fastlane/metadata/android/<idioma>/`) |
|---|---|---|
| Nome / título (30) | `name.txt`: **Peguei: câmera de pesca** | `title.txt`: **Peguei: câmera de pesca** |
| Subtítulo (30, só iOS) | `subtitle.txt`: **Grave a fisgada que já passou** | não existe |
| Descrição curta (80, só Play) | não existe | `short_description.txt` |
| Palavras-chave (100 bytes, só iOS) | `keywords.txt` | não existe: a Play indexa título e descrições |
| Texto promocional (170, só iOS) | `promotional_text.txt` (troca sem nova revisão) | não existe |
| Descrição (4000) | `description.txt` | `full_description.txt` |
| Novidades | `release_notes.txt` (4000) | `changelogs/default.txt` (500) |
| URLs | `privacy_url.txt`, `support_url.txt`, `marketing_url.txt` | definidas no Play Console |

Valide antes de enviar: `node scripts/validate-store-text.mjs` (também roda em `scripts/store-assets.sh validate`). Ele conta caracteres, conta **bytes** nas palavras-chave (acento vale 2 bytes, por isso `tucunare` e `tilapia` vão sem acento: a busca da App Store ignora acento) e avisa quando uma palavra-chave repete o nome ou o subtítulo.

## Por que o nome mudou

O nome antigo ("Peguei: sempre gravando") não tinha nenhuma palavra que o pescador digita na busca. "câmera de pesca" no nome e "fisgada" no subtítulo são os termos com maior peso de indexação nas duas lojas. A marca "Peguei" continua na frente.

## Palavras-chave e justificativa

Não temos dados de volume de busca (nenhuma ferramenta paga de ASO e nenhum histórico do app). As justificativas abaixo são de relevância e concorrência, não de volume. Depois do lançamento, confira em App Store Connect → Analytics → Fontes → Busca e no Play Console → Aquisição de usuários → Termos de pesquisa, e troque as palavras que não trouxerem visita.

| Termo | Onde entra | Justificativa |
|---|---|---|
| pesca | nome (iOS e Play) | Termo-raiz do público. No nome tem o maior peso. Concorrência alta (apps de previsão, jogos), mas "câmera de pesca" junto deixa claro que o app é outra coisa. |
| câmera de pesca | nome | Descreve o produto em três palavras. Quem procura isso quer gravar a pescaria, que é exatamente o que o Peguei faz. Pouca concorrência direta em pt-BR. |
| gravar fisgada / fisgada | subtítulo, descrição, texto promocional | É a dor que o app resolve ("o peixe fisgou antes de eu apertar gravar"). "fisgada" quase não aparece em outros apps, então é termo de cauda longa com intenção alta. |
| pescaria | palavras-chave iOS, descrição | Variação muito usada no Brasil ("vídeo de pescaria"). A Apple não junta "pesca" e "pescaria" sozinha. |
| pescar | palavras-chave iOS | Forma verbal ("app para pescar"). Barato em bytes. |
| peixe | palavras-chave iOS, descrição | Busca genérica, ajuda a combinar com "vídeo de peixe" e "câmera peixe". |
| video, gravar, clipe | palavras-chave iOS, descrição | Combinam com "pesca" e "fisgada" para formar "gravar vídeo pesca", "clipe pescaria". Sem acento para economizar bytes. |
| buffer | palavras-chave iOS, descrição | Quem conhece o recurso (gravação retroativa, "replay") procura assim. Pouca gente, mas com intenção certa. |
| anzol | palavras-chave iOS | Vocabulário de pesca, liga o app ao tema em buscas de equipamento. Concorrência baixa. |
| tucunaré (tucunare), tilápia (tilapia) | palavras-chave iOS, descrição (lista de espécies do export) | As espécies que mais aparecem nos vídeos de pesca de água doce no Brasil e nas pills do export. Quem busca a espécie está postando vídeo dela. |
| pesqueiro | palavras-chave iOS | Pesque-pague é onde muita gente grava a primeira fisgada. Também é o público dos parceiros (pesqueiros). |
| reels, tiktok | palavras-chave iOS, descrição, legenda da tela 5 | O app exporta em 9:16 com legenda. Citar as redes em texto é permitido; não usamos logo nenhum. |
| lente | palavras-chave iOS, legenda da tela 4 | Liga com "lente 0,5x" e "grande-angular" para quem quer enquadrar o barco inteiro. |
| previsão de pesca, tábua de pesca, lua para pesca | **não usar no Peguei** | São do Pesca Certa. Usar aqui traria quem quer previsão e geraria avaliação ruim. Ficam no ASO do Pesca Certa, e o Peguei cita o Pesca Certa só pelo nome. |
| GoPro, nomes de concorrentes | **não usar** | A Apple proíbe marca de terceiros nas palavras-chave (diretriz 2.3.7). O comparativo fica só em texto de marketing, fora da loja. |

### en-US (opcional)

`fish, catch, angler, angling, bass, video, buffer, hook, reels, tiktok, clip, replay, outdoor, lens, wide`, com "fishing camera" no nome e "Record the strike you missed" no subtítulo. Mesma lógica: dor (strike), produto (fishing camera), espécie mais buscada nos EUA (bass).

## Textos promocionais alternativos (iOS, 170)

Troque sem enviar versão nova:

- O peixe fisgou antes de você apertar gravar? O Peguei já guardou os últimos segundos. Toque na tela e o vídeo sai com a fisgada, pronto para Reels e TikTok. *(atual)*
- Câmera sempre gravando para a pescaria: até 60 s guardados antes do seu toque, lente 0,5x e export 9:16 com espécie e peso. Grátis e sem assinatura.
- Pescaria de fim de semana? Deixe o Peguei ligado no modo bolso e toque só quando fisgar. A fisgada que já passou vai junto no vídeo.
