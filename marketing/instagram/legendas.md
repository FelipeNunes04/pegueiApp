# Instagram @pegueiapp: lançamento

Peças em `carrossel/` (9 imagens 1080x1350) e `stories/` (6 imagens 1080x1920), geradas por `node scripts/marketing-assets.mjs`. As áreas "FOTO REAL DE PESCARIA AQUI" saem automaticamente com a foto quando existir `marketing/footage/foto-1.jpg` a `foto-4.jpg` (1 e 3 na capa e no fim do carrossel, 2 no slide do problema, 4 no último story).

Link da bio (sempre este, com UTM):
`node scripts/utm-link.mjs site instagram bio lancamento_2026_12`
→ https://felipenunes04.github.io/pegueiApp/?utm_source=instagram&utm_medium=bio&utm_campaign=lancamento_2026_12

## Carrossel de lançamento (9 imagens)

Publicar como um carrossel único, na ordem 01 a 09. Se preferir posts soltos, as imagens 01, 04, 07 e 08 funcionam sozinhas.

**Legenda:**

```
Nunca mais perca a fisgada. 🎣

O Peguei deixa a câmera sempre gravando e guarda só os últimos segundos. Quando o peixe pegar, toque na tela: o vídeo salvo já começa ANTES do toque, com a fisgada inteira.

• Até 60 s guardados antes do toque
• Lente 0,5x para pegar a cena toda (nos celulares com ultra-angular)
• Export 9:16 com espécie e peso, pronto para Reels e TikTok
• Grátis, sem assinatura, para Android e iPhone

Já tem um celular com boa câmera? Comece pelo Peguei. Link na bio.

#pescaria #pesca #fisgada #pescaesportiva #tucunare #tilapia #peguei
```

## Legendas dos posts soltos (se publicar separado)

- **01:** `Nunca mais perca a fisgada. O Peguei guarda os segundos antes do seu toque. Grátis, link na bio. #pescaria #fisgada`
- **04:** `Fisgou? Toque na tela. O vídeo já vem com até 60 s de antes. #pescaria #pescaesportiva`
- **07:** `Do rio pro Reels: export 9:16 com espécie e peso no vídeo. #pescaria #reels`
- **08:** `Peguei ou GoPro? Para quem já tem um celular com boa câmera, comece pelo Peguei: é grátis. A comparação completa está nos comentários fixados.` Fixe nos comentários a versão curta de `marketing/peguei-vs-gopro.md`. Sem logo nem foto da GoPro.

## Stories (6)

| Story | Interação no Instagram | Link (adesivo) |
|---|---|---|
| 01 | Adesivo de enquete "Sim / Não" na área marcada | não |
| 02 | Nenhuma | não |
| 03 | Nenhuma (pode trocar por vídeo de tela do app) | não |
| 04 | Adesivo de pergunta "Quantos segundos você guardaria?" | não |
| 05 | Nenhuma | `node scripts/utm-link.mjs site instagram story lancamento_2026_12 story_05` |
| 06 | Adesivo de link na área marcada | `node scripts/utm-link.mjs site instagram story lancamento_2026_12 story_06` |

Depois de publicar, salve os 6 nos Destaques como "Como funciona".
