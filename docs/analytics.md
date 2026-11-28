# Analytics do Peguei

Camada em `src/analytics/`. Toda chamada passa por `track()`, que:

- só aceita eventos de `src/analytics/events.ts`, e o TypeScript recusa nome ou propriedade errados (os testes de tipo ficam em `src/analytics/__tests__/track.test.ts`);
- acrescenta os parâmetros comuns `app` (`peguei`), `app_version`, `platform`, `device_model`, `os_version`, `connection` (`wifi`, `cell`, `offline` ou `unknown`) e, quando conhecidos, `uf` e `region_geohash5`. São os mesmos do Pesca Certa. `uf` vem do onboarding; `region_geohash5` (área de ~5 km, nunca coordenada) só existe quando o Pesca Certa manda um no link. Valores vazios ficam de fora em vez de irem como `""`;
- converte booleanos em `1`/`0` (no BigQuery viram `int_value`) e corta textos em 100 caracteres;
- respeita o opt-out (Configurações → Privacidade → Enviar dados de uso), que também desliga a coleta automática do Firebase, o Crashlytics e o Performance Monitoring;
- respeita a flag remota `analytics_enabled` (padrão `true`), que desliga tudo para todo mundo;
- deixa um breadcrumb no Crashlytics com o nome de cada evento;
- em `__DEV__` **não envia nada**: só imprime `[analytics] ...` no console do Metro;
- nunca lança erro nem espera: o pior caso é perder um evento, nunca deixar a câmera mais lenta.

**Offline:** o Firebase guarda os eventos no aparelho e envia quando houver internet, então o Peguei não tem fila offline própria para o envio. A única fila é a da abertura do app: até 50 eventos esperam em memória enquanto a escolha do opt-out é lida, e são enviados ou descartados depois. Os parâmetros (incluindo `connection`) são calculados na hora do evento, não na hora do envio. Testes em `src/analytics/__tests__/commonContext.test.ts`.

Para trocar de provedor, mude uma linha: `createDefaultProvider()` em `src/analytics/providers/index.ts`.

## Eventos vindos do nativo

O código nativo chama `PegueiAnalytics.track(nome, props)`: `ios/Analytics/PegueiAnalytics.swift` no iOS e `android/.../analytics/PegueiAnalyticsModule.kt` no Android.

1. A chamada só entrega o evento a uma fila de baixa prioridade e volta na hora.
2. A fila manda o evento para o JS como `PegueiAnalyticsEvent`. Os eventos esperam na fila enquanto o JS não estiver ouvindo, no máximo 100.
3. O JS confere o nome contra `events.ts`, descarta nomes desconhecidos e envia o resto pelo mesmo `track()`.

Hoje só o export dispara evento pelo nativo (`sponsor_impression`).

O mesmo módulo também:

- manda `PegueiConnectionChanged` quando a rede muda (iOS `NWPathMonitor`, Android `ConnectivityManager`), na fila de analytics;
- responde `getDeviceStatus()`: bateria, estado térmico, espaço livre, memória e quadros codificados. É chamado só no início da sessão, a cada 5 min e no fim, e roda na fila de analytics. O encoder só incrementa um contador por quadro (`EncodedFrameStats` no iOS, um `AtomicLong` no Android): nenhuma leitura de bateria, disco ou memória acontece na thread da câmera.

## Sessão de pesca

`src/analytics/fishingSession.ts`. A sessão começa no primeiro `buffer_started` e termina quando o buffer fica desligado por **10 minutos**: ir à galeria ou às configurações e voltar (o que para e religa o buffer) continua na mesma sessão.

- A sessão aberta fica no `AsyncStorage`. Se o app fechar sem terminar a sessão, a próxima abertura envia `fishing_session_ended` com `motivo_fim = crash` (o app estava em primeiro plano) ou `background` (o sistema matou o app em segundo plano).
- `motivo_fim` na parada do buffer: `bateria` (5% ou menos, fora da tomada), `termico` (estado `critical`), `armazenamento` (menos de 0,5 GB), `background` ou `usuario`.
- `buffer_health_sampled` sai a cada `buffer_sample_interval_min` minutos (padrão e mínimo 5) enquanto o buffer roda. `dropped_frames_pct` compara os quadros codificados com o fps configurado; uma redução de fps por calor também aparece aqui.
- Tudo atrás da flag `session_metrics_enabled` (padrão `true`).

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
| `fishing_session_started` | `buffer_s`, `lente`, `resolucao`, `fps`, `battery_pct`, `thermal_state`, `storage_free_gb_bucket` | primeiro buffer de uma sessão | Quantas pescarias reais, com que configuração e em que estado do aparelho? |
| `fishing_session_ended` | `duracao_min`, `capturas`, `battery_drop_pct`, `max_thermal_state`, `motivo_fim` | buffer desligado por 10 min, ou na abertura seguinte | Quanto dura uma pescaria, quantas fisgadas, por que termina? |
| `buffer_health_sampled` | `dropped_frames_pct`, `memoria_mb`, `thermal_state` | a cada 5 min (no máximo) com o buffer ligado | O buffer aguenta sessões longas? |
| `app_backgrounded_during_buffer` | `duracao_s` | volta ao app depois de sair com o buffer ligado | Quanto tempo o pescador sai do app no meio da pescaria? |
| `capture_latency_measured` | `toque_ate_salvo_ms`, `buffer_s`, `resolucao` | `useCircularBuffer.stopRecording` | Quanto demora do toque ao vídeo salvo? |
| `capture_discarded` | `motivo` (`erro_salvar`, `encerrada_sem_salvar`, `excluido_na_previa`) | falha ao salvar, gravação encerrada pelo nativo sem vídeo, exclusão na prévia até 5 min depois de salvar | Quantas capturas não viram vídeo? |
| `video_trimmed` | `duracao_original_s`, `duracao_final_s` | **declarado, não enviado**: o app ainda não tem corte | (futuro) |
| `video_deleted` | `idade_dias` | um por vídeo excluído (galeria e prévia) | Os vídeos são guardados ou apagados logo? |
| `gallery_opened` | `total_videos` | Galeria, ao carregar | Quantos vídeos cada um guarda? |
| `video_played` | `duracao_s`, `completou` | ao sair da prévia, se o vídeo tocou | Os vídeos são revistos? |
| `share_sheet_opened` | `formato` (`original`/`9_16`), `marca_dagua`, `overlay` | antes de abrir a folha de compartilhar | Quantos começam a compartilhar e desistem? |
| `share_card_template_used` | `template` (`cartao_especie`, `cartao_especie_patrocinado`) | export com legenda | Qual cartão é usado? |
| `permission_result` | `permission` (`camera`, `mic`), `granted`, `prompt_count` | `usePermissions.requestPermission` | Funil de permissões, e depois de quantos pedidos a pessoa aceita |
| `storage_low_warning_shown` | `storage_free_gb` | aviso de pouco espaço (flag `storage_warning_enabled`). **Só Android** | Quantos perdem vídeos por falta de espaço? |
| `camera_init_failed` | `erro`, `lente` | falha ao iniciar o buffer | Em que aparelhos a câmera não abre? |
| `export_failed` | `erro`, `etapa` (`marca`, `export`, `compartilhar`) | `exportClip` e `shareExported`. `marca` = marca d'água ativa mas sem imagem (offline) | O que faz o export falhar? |
| `pesca_certa_cta_viewed` / `pesca_certa_cta_clicked` | `contexto` (`export`) | botão "Registrar no diário do Pesca Certa" (flag `pesca_certa_cta_enabled`) | O CTA converte? |
| `opened_from_pesca_certa` | `contexto` (`viagem`, `checkin`, `abrir`) | link `peguei://camera?from=pesca_certa&contexto=...` | Quantos chegam pelo Pesca Certa? |
| `catch_sent_to_pesca_certa` | `especie` (chave do Pesca Certa) | o link `pescacerta://diario` abriu | Quantas capturas viram registro no diário? |
| `sponsor_clicked` | `sponsor_id`, `posicao` | toque no aviso de patrocínio do export, se `sponsor_link_url` estiver preenchido | O patrocinador recebe cliques? |
| `affiliate_link_clicked` | `produto_id`, `contexto` | **declarado, não enviado**: a tela "equipamento do vídeo" ainda não existe | (futuro) |

Desde a 1.3.0, `video_shared` também leva `formato`, `marca_dagua` e `sponsor_id`.

`screen_view` sai automaticamente a cada troca de tela, pelo `screen()` em `App.tsx`.

**Valores possíveis:**

- `lente`: `0.5x` quando o zoom está abaixo de 1x, senão `1x`.
- `destino`: `whatsapp`, `instagram`, `tiktok`, `youtube`, `facebook`, `outro` ou `cancelado`. Vem do `activityType` no iOS e do componente escolhido no chooser no Android, ambos repassados pelo `react-native-share`.
- `posicao`: `top_left`, `top_right`, `bottom_left` ou `bottom_right`.

**User properties** (mesma convenção do Pesca Certa, valores sempre texto, até 36 caracteres):

| Propriedade | Valores | Quando |
|---|---|---|
| `uf` | sigla ou `nao_informado` | onboarding |
| `tipo_pesca` | `rio`, `represa_acude`, `mar`, `pesqueiro`, `varios`, `nao_informado` | onboarding |
| `buffer_s_preferido` | segundos, ex.: `30` | cada `buffer_started` |
| `lente_preferida` | `0.5x` ou `1x` | cada `buffer_started` |
| `has_pesca_certa` | `sim` | quando o Pesca Certa abre o Peguei ou o Peguei abre o Pesca Certa |
| `install_source` | `organico`, `pesca_certa`, utm/`from` do link, ou `deeplink` | primeira abertura |
| `cohort_week` | ex.: `2026-W48` | primeira abertura |
| `videos_saved_bucket` | `0`, `1`, `2-5`, `6-20`, `21-50`, `51+` | ao abrir a galeria |
| `storage_free_bucket` | `<1`, `1-2`, `2-5`, `5-10`, `10-30`, `30+`; `nao_enviado` no iOS | início de cada sessão |

## Performance e Crashlytics

**Traces do Performance Monitoring** (`src/analytics/observability.ts`):

| Trace | Do quê até o quê | Atributos |
|---|---|---|
| `camera_cold_start` | carregamento do JS até o primeiro buffer rodando. Só quando o app abre direto na câmera; se abrir no onboarding ou nas permissões, o trace não é enviado | |
| `buffer_start` | chamada `startBuffering` até o buffer rodando (cada início) | `resolucao`, `buffer_s` |
| `capture_save` | toque para parar até o vídeo salvo | `resolucao`, `buffer_s` |
| `export_9_16` | export vertical do início ao arquivo pronto | `marca_dagua`, `overlay` |

Traces de uma operação que falhou não são enviados.

**Chaves do Crashlytics:** `buffer_s`, `lente`, `resolucao` (a cada início de buffer), `thermal_state` e `storage_free_gb` (início da sessão e cada amostra; `storage_free_gb` só no Android). Erros de export também vão como não fatais (`recordError`, origem `export`). Em `__DEV__` nada é enviado.

## Link com o Pesca Certa

Contrato dos dois lados:

- **Pesca Certa → Peguei:** `peguei://camera?from=pesca_certa&contexto=<viagem|checkin>`. Abre a câmera como antes (mesmo host da App Action do Android) e dispara `opened_from_pesca_certa`. No iOS o esquema `peguei://` passou a existir na 1.3.0 (`CFBundleURLTypes` e `SceneDelegate`).
- **Peguei → Pesca Certa:** `pescacerta://diario?from=peguei&contexto=captura&especie=<chave>&data=<AAAA-MM-DD>&geohash5=<5 letras>`. `geohash5` só vai quando é conhecido. As chaves de espécie são as do Pesca Certa: `tucunare`, `traira`, `tilapia`, `tambaqui`, `dourado`, `curimata`, `piau`, `pescada_piaui`, `pacu`, `mandi`, `piranha`, `outra`. Se o Pesca Certa não estiver instalado, abre a loja (`pesca_certa_app_store_url` / `pesca_certa_play_url`). Código em `src/features/ecosystem/pescaCerta.ts`.

**Atenção:** `sponsor_impression` conta **vídeos exportados com a marca**, não visualizações nas redes. No media kit, chame esse número de "vídeos com a marca", não de alcance.

## Remote Config

| Chave | Padrão local | Para que serve |
|---|---|---|
| `watermark_enabled` | `false` | Liga a marca d'água no export |
| `watermark_asset_url` | `""` | PNG da marca, https, até 2 MB. Melhor com fundo transparente, cerca de 600 px de largura |
| `sponsor_id` | `""` | Id curto do patrocinador, ex.: `loja_picos`. Vai em `video_exported` e `sponsor_impression` |
| `sponsor_position` | `bottom_right` | Canto da marca: `top_left`, `top_right`, `bottom_left` ou `bottom_right` |
| `overlay_sponsor_logo_url` | `""` | Logo no cartão de espécie e peso (https) |
| `sponsor_link_url` | `""` | Link (https) do aviso de patrocínio no export. Vazio: o aviso não é clicável |
| `analytics_enabled` | `true` | Desliga todos os eventos para todo mundo |
| `session_metrics_enabled` | `true` | Sessões de pesca e amostras do aparelho |
| `buffer_sample_interval_min` | `5` | Minutos entre `buffer_health_sampled` (nunca menos de 5) |
| `storage_warning_enabled` | `false` | Aviso de pouco espaço na câmera |
| `storage_warning_gb` | `2` | Abaixo de quantos GB livres o aviso aparece |
| `pesca_certa_cta_enabled` | `false` | Botão "Registrar no diário do Pesca Certa" no export |
| `pesca_certa_app_store_url` | `https://apps.apple.com/app/id6760917467` | Loja do Pesca Certa no iOS, quando ele não está instalado |
| `pesca_certa_play_url` | `https://play.google.com/store/apps/details?id=br.com.pescacerta.android` | Loja do Pesca Certa no Android |

Antes do Remote Config ficar pronto (primeira abertura, sem internet), toda chave vale o padrão local acima: uma flag nunca vira `false` só porque o Firebase ainda não respondeu.

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
