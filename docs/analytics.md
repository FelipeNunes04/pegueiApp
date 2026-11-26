# Analytics do Peguei

Camada em `src/analytics/`. Toda chamada passa por `track()`, que:

- só aceita eventos de `src/analytics/events.ts`, e o TypeScript recusa nome ou propriedade errados (os testes de tipo ficam em `src/analytics/__tests__/track.test.ts`);
- acrescenta os parâmetros comuns `app` (`peguei`), `app_version`, `platform`, `device_model` e `os_version`;
- converte booleanos em `1`/`0` (no BigQuery viram `int_value`) e corta textos em 100 caracteres;
- respeita o opt-out (Configurações → Privacidade → Enviar dados de uso), que também desliga a coleta automática do Firebase;
- em `__DEV__` **não envia nada**: só imprime `[analytics] ...` no console do Metro;
- nunca lança erro nem espera: o pior caso é perder um evento, nunca deixar a câmera mais lenta.

O Firebase guarda os eventos no aparelho e envia quando houver internet. Por isso o Peguei não precisa de fila offline própria.

Para trocar de provedor, mude uma linha: `createDefaultProvider()` em `src/analytics/providers/index.ts`.

## Eventos vindos do nativo

O código nativo chama `PegueiAnalytics.track(nome, props)`: `ios/Analytics/PegueiAnalytics.swift` no iOS e `android/.../analytics/PegueiAnalyticsModule.kt` no Android.

1. A chamada só entrega o evento a uma fila de baixa prioridade e volta na hora.
2. A fila manda o evento para o JS como `PegueiAnalyticsEvent`. Os eventos esperam na fila enquanto o JS não estiver ouvindo, no máximo 100.
3. O JS confere o nome contra `events.ts`, descarta nomes desconhecidos e envia o resto pelo mesmo `track()`.

Hoje só o export dispara evento pelo nativo (`sponsor_impression`).

## Eventos

| Evento | Propriedades | Onde dispara | Pergunta que responde |
|---|---|---|---|
| `app_opened` | (nenhuma) | `App.tsx`, ao montar | Quantas aberturas por dia e por usuário? |
| `onboarding_completed` | `tipo_pesca`, `estado` | `OnboardingProfileScreen` ("Continuar" ou "Pular", que manda `nao_informado`) | Quem são os usuários (tipo de pesca, UF)? |
| `onboarding_skipped` | (nenhuma) | `OnboardingScreen` ("Pular" nos slides) | Os slides são longos demais? |
| `permission_denied` | `permission`, `status` | `usePermissions.requestPermission` | Onde se perde gente no funil de permissões? |
| `buffer_started` | `buffer_s`, `lente` | `useCircularBuffer.start`, depois que o nativo confirma | Quantas sessões de pesca e com que configuração? |
| `buffer_stopped` | `duracao_min` | `useCircularBuffer.stop`, parada pela notificação no Android, e antes de cada reinício | Quanto dura uma sessão? |
| `capture_triggered` | `buffer_s` | `useCircularBuffer.startRecording` (toque, botão de volume ou controle Bluetooth) | Quantas fisgadas por sessão? |
| `capture_failed` | `erro` (`etapa:código`) | erros de início e fim da gravação, `CircularBufferError`, gravação encerrada pelo nativo com erro | O que faz perder um vídeo? |
| `video_saved` | `duracao_s`, `resolucao`, `fps`, `lente` | `useCircularBuffer.stopRecording` e `CircularBufferRecordingFinalized` | Quantos vídeos são salvos e em que qualidade? |
| `clip_deleted` | `count` | Galeria e prévia do clipe | Quantos vídeos são descartados? |
| `video_shared` | `destino`, `quantidade` | Galeria, prévia e export | Para onde vão os vídeos (base do media kit)? |
| `video_exported` | `marca_dagua`, `overlay`, `sponsor_id` | `exportClip` | Quantos vídeos saem prontos para as redes, e quantos com marca? |
| `overlay_added` | `especie`, `tem_peso` | `exportClip`, quando há legenda | Que espécies aparecem nos vídeos? |
| `sponsor_impression` | `sponsor_id`, `posicao` | **nativo**, no fim do export com marca d'água | Quantos vídeos com a marca de cada patrocinador? |
| `review_prompt_shown` | (nenhuma) | `reviewPrompt.maybePromptReview` (ao abrir a galeria) | Quantas vezes pedimos avaliação? |
| `donation_pix_copied` | (nenhuma) | Configurações (só Android) | Alguém doa? |

`screen_view` sai automaticamente a cada troca de tela, pelo `screen()` em `App.tsx`.

**Valores possíveis:**

- `lente`: `0.5x` quando o zoom está abaixo de 1x, senão `1x`.
- `destino`: `whatsapp`, `instagram`, `tiktok`, `youtube`, `facebook`, `outro` ou `cancelado`. Vem do `activityType` no iOS e do componente escolhido no chooser no Android, ambos repassados pelo `react-native-share`.
- `posicao`: `top_left`, `top_right`, `bottom_left` ou `bottom_right`.

**User properties:** `tipo_pesca` e `uf`, definidos no onboarding.

**Atenção:** `sponsor_impression` conta **vídeos exportados com a marca**, não visualizações nas redes. No media kit, chame esse número de "vídeos com a marca", não de alcance.

## Remote Config

| Chave | Padrão local | Para que serve |
|---|---|---|
| `watermark_enabled` | `false` | Liga a marca d'água no export |
| `watermark_asset_url` | `""` | PNG da marca, https, até 2 MB. Melhor com fundo transparente, cerca de 600 px de largura |
| `sponsor_id` | `""` | Id curto do patrocinador, ex.: `loja_picos`. Vai em `video_exported` e `sponsor_impression` |
| `sponsor_position` | `bottom_right` | Canto da marca: `top_left`, `top_right`, `bottom_left` ou `bottom_right` |
| `overlay_sponsor_logo_url` | `""` | Logo no cartão de espécie e peso (https) |

Funcionamento:

- O app busca os valores em segundo plano na abertura: a cada 12 h em produção e sempre em desenvolvimento.
- O Firebase guarda os últimos valores ativados, então eles continuam valendo offline.
- As imagens são baixadas para o cache logo depois da busca.
- Sem imagem no cache e sem internet, o vídeo sai sem a marca e o export não falha.

## Como validar no Firebase DebugView

Em `__DEV__` nada é enviado. Para ver os eventos chegando, use um build **Release** com o modo debug do Firebase ligado.

**iOS (simulador iOS 26.5, Xcode 26):**

```bash
export DEVELOPER_DIR=/Volumes/DevSSD/Applications/Xcode-26.5.0.app/Contents/Developer
xcodebuild -workspace ios/Peguei.xcworkspace -scheme Peguei -configuration Release \
  -destination "id=<udid>" -derivedDataPath /tmp/peguei-dd build
xcrun simctl install <udid> /tmp/peguei-dd/Build/Products/Release-iphonesimulator/Peguei.app
xcrun simctl launch <udid> com.felipenunes.pegueiapp -FIRDebugEnabled
```

O simulador não tem câmera. Os eventos de buffer e gravação só aparecem num iPhone de verdade: no Xcode, abra o scheme Peguei, escolha Run → Arguments e adicione `-FIRDebugEnabled`.

**Android (aparelho ou emulador):**

```bash
adb shell setprop debug.firebase.analytics.app com.felipenunes.pegueiapp
# instale um build release (EAS preview-android ou ./gradlew assembleRelease)
# para desligar depois:
adb shell setprop debug.firebase.analytics.app .none.
```

Depois, no Firebase Console → Analytics → DebugView, escolha o aparelho. Os eventos aparecem em alguns segundos.

## Teste manual, evento por evento

Faça os passos num aparelho de verdade, em build Release com o DebugView aberto.

1. **Instalação nova:** abra o app → `app_opened`.
   - Passe os slides → nenhum evento.
   - Ou toque em "Pular" → `onboarding_skipped`.
2. **Perfil:** escolha "Represa ou açude" e "PI" e toque em "Continuar" → `onboarding_completed` com `tipo_pesca=represa_acude` e `estado=PI`.
   - Repita com o app reinstalado e toque em "Pular" → os dois campos vêm como `nao_informado`.
   - Em DebugView → User properties, confira `tipo_pesca` e `uf`.
3. **Permissões:** negue a câmera → `permission_denied` com `permission=camera`.
4. **Buffer:** ao chegar na câmera → `buffer_started` com `buffer_s=30` e `lente=1x`.
   - Troque para 0,5x (num aparelho com ultra-wide) e mude a duração do buffer em Configurações → `buffer_stopped`, seguido de `buffer_started` com `lente=0.5x` e o novo `buffer_s`.
5. **Gravação:** toque para gravar → `capture_triggered`.
   - Toque de novo → `video_saved` com a duração, a resolução e o fps das Configurações.
   - Repita com o botão de volume → `capture_triggered` de novo.
6. **Falha de gravação:** com o buffer recém-retomado, toque para gravar antes de a câmera abrir. Se cair no erro, aparece `capture_failed` com `record_start:E_NOT_BUFFERING`.
7. **Compartilhar:** na galeria, compartilhe um vídeo pelo WhatsApp → `video_shared` com `destino=whatsapp` e `quantidade=1`.
   - Selecione dois vídeos e compartilhe → `quantidade=2`.
   - Feche a folha sem escolher nenhum app → `destino=cancelado`.
8. **Excluir:** exclua um vídeo → `clip_deleted` com `count=1`.
9. **Avaliação:** salve 3 vídeos e abra a galeria → `review_prompt_shown`.
   - No iOS em desenvolvimento o diálogo sempre aparece. No TestFlight ele não aparece, mas o evento sai mesmo assim.
   - Abra a galeria de novo → nenhum evento (o próximo pedido só sai em 90 dias).
10. **Export sem patrocínio:** abra um vídeo → botão de exportar → escolha "Tucunaré", digite peso "2,4" → "Exportar e compartilhar".
    - Saem `video_exported` (`marca_dagua=0`, `overlay=1`) e `overlay_added` (`especie=tucunaré`, `tem_peso=1`).
    - Depois de escolher o app, sai `video_shared`.
    - Confira no vídeo exportado: formato vertical, cartão no canto inferior esquerdo e nenhuma marca d'água.
11. **Export com patrocínio:** no Remote Config, publique `watermark_enabled=true`, um `watermark_asset_url`, `sponsor_id=teste` e `sponsor_position=top_right`.
    - Feche o app e abra de novo. Na tela de export aparece "Este vídeo sai com a marca do patrocinador".
    - Exporte → `video_exported` (`marca_dagua=1`, `sponsor_id=teste`) e `sponsor_impression` (`posicao=top_right`).
    - A marca deve aparecer no canto superior direito.
12. **Offline:** coloque o aparelho em modo avião, exporte de novo → a marca continua, porque já está no cache.
    - Apague os dados do app, mantenha o modo avião e exporte → o vídeo sai sem marca e o export não falha.
    - Grave e salve vídeos em modo avião, depois volte a ficar online → os eventos chegam, com atraso.
13. **Opt-out:** em Configurações → Privacidade, desligue "Enviar dados de uso" → nada mais chega ao DebugView, nem `screen_view`.
    - Ligue de novo → os eventos voltam.
14. **Doação (Android):** copie a chave Pix → `donation_pix_copied`.
