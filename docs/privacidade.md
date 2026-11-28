# Privacidade: o que declarar nas lojas

Vale a partir da versão **1.3.0** (analytics ampliado: sessões de pesca, dados do aparelho, Crashlytics e Performance Monitoring). Quem coleta é o Firebase (Analytics, Crashlytics, Performance, Remote Config), projeto `pegueiapp-9d2bb`.

O Peguei **não tem servidor próprio**, **não tem conta nem login** e **não faz rastreamento entre apps**, então não há App Tracking Transparency (ATT). Também não usa o ID de publicidade:

- iOS: `$RNFirebaseAnalyticsWithoutAdIdSupport` no Podfile e nenhum `NSUserTrackingUsageDescription`.
- Android: `firebase.json` desliga a coleta do Ad ID, e o manifesto remove `AD_ID`, `ACCESS_ADSERVICES_AD_ID` e `ACCESS_ADSERVICES_ATTRIBUTION`.

O `scripts/preflight.sh` confere essas três coisas antes de cada build.

## O que mudou na 1.3.0

| Dado novo | Onde | Para quê |
|---|---|---|
| Nível da bateria e se está carregando | iOS `UIDevice.batteryLevel`, Android `BatteryManager` | Consumo por hora de buffer, sessões encerradas por bateria |
| Estado térmico (`nominal`, `fair`, `serious`, `critical`) | iOS `ProcessInfo.thermalState`, Android `PowerManager.getCurrentThermalStatus` | Sessões encerradas por calor, aparelhos que esquentam |
| Espaço livre | iOS e Android, lido no aparelho | Aviso de pouco espaço (flag `storage_warning_enabled`). **Enviado só no Android**, em faixas (`<1`, `1-2`, `2-5`, `5-10`, `10-30`, `30+` GB) |
| Memória usada pelo app e quadros perdidos | iOS `phys_footprint`, Android `Debug.getPss`; contador de quadros do encoder | Saúde do buffer em sessões longas |
| Tipo de conexão (`wifi`, `cell`, `offline`) | iOS `NWPathMonitor`, Android `ConnectivityManager` | Parâmetro comum, igual ao Pesca Certa |
| Relatórios de falha e erros não fatais | Firebase Crashlytics | Estabilidade por versão e aparelho |
| Tempos de `camera_cold_start`, `buffer_start`, `capture_save`, `export_9_16` | Firebase Performance Monitoring | Velocidade da câmera e do export |
| Link com o Pesca Certa (espécie, data, área de ~5 km quando conhecida) | Deep link `pescacerta://diario` | Ecossistema entre os dois apps |

**Espaço livre no iOS:** o espaço em disco é uma "API com motivo obrigatório" da Apple. O Peguei declara o motivo **E174.1** (conferir se há espaço para gravar arquivos) no `PrivacyInfo.xcprivacy`. Esse motivo **proíbe enviar o dado para fora do aparelho**, nem em faixas. Por isso, no iOS, `storage_free_gb_bucket` e `storage_free_bucket` vão como `nao_enviado`, `storage_low_warning_shown` não é enviado e a chave `storage_free_gb` do Crashlytics não é preenchida. A regra está em `canReportStorage()` (`src/analytics/deviceStatus.ts`).

**Localização:** o Peguei não pede permissão de localização e nunca envia coordenadas. O `uf` vem do onboarding (opcional). O `region_geohash5` (área de cerca de 5 km) só existe quando o Pesca Certa o manda no link que abre o Peguei.

## iOS: `ios/Peguei/PrivacyInfo.xcprivacy`

- `NSPrivacyTracking = false`, sem domínios de rastreamento.
- APIs com motivo: `FileTimestamp`, `UserDefaults`, `SystemBootTime` (já existiam) e **`DiskSpace` com `E174.1`** (nova).
- Dados coletados, todos **não ligados à identidade** e **sem rastreamento**:

| `NSPrivacyCollectedDataType` | Finalidades |
|---|---|
| `ProductInteraction` | Analytics |
| `DeviceID` | Analytics |
| `CoarseLocation` | Analytics |
| `OtherDiagnosticData` | Analytics, App Functionality |
| `OtherUserContent` | Analytics |
| `CrashData` (novo) | Analytics, App Functionality |
| `PerformanceData` (novo) | Analytics, App Functionality |

Os SDKs do Firebase trazem os próprios manifestos de privacidade; o Xcode junta todos no relatório de privacidade do arquivo (Product → Archive → Generate Privacy Report). Confira lá antes de enviar.

## App Store Connect → App Privacy (rótulos)

**Data Used to Track You:** nenhum.

**Data Linked to You:** nenhum. Não há conta nem login, e os dados ficam presos ao ID de instalação do Firebase.

**Data Not Linked to You:**

| Categoria | Tipo | Finalidades | O que é |
|---|---|---|---|
| Usage Data | Product Interaction | Analytics | Telas abertas, sessões de pesca, buffer, gravações, exports, compartilhamentos e o destino de cada um, cliques no patrocinador e no Pesca Certa |
| Identifiers | Device ID | Analytics | ID de instalação do Firebase (não é o IDFA) |
| Location | Coarse Location | Analytics | Estado (UF) escolhido no onboarding, que é opcional; área de ~5 km quando vem do Pesca Certa; região que o Google deriva do IP |
| Diagnostics | Crash Data | Analytics, App Functionality | Relatórios de falha do Crashlytics |
| Diagnostics | Performance Data | Analytics, App Functionality | Tempos de câmera, gravação e export; bateria, estado térmico, memória e quadros perdidos durante o buffer |
| Diagnostics | Other Diagnostic Data | Analytics, App Functionality | Códigos de erro de câmera, gravação e export; modelo e versão do sistema; tipo de conexão |
| User Content | Other User Content | Analytics | Nome da espécie digitado na legenda do export |

**Como preencher:**

1. App Privacy → Edit → marque os tipos da tabela. Os novos em relação à 1.2.0 são **Crash Data** e **Performance Data**.
2. Em cada tipo: **"No"** para "linked to the user's identity" e **"No"** para "used for tracking".
3. Publique a política de privacidade atualizada (`legal/privacy-policy-pt-BR.md` e `-en-US.md`, de 28/11/2026) no endereço informado na loja **antes** de enviar a versão para revisão.

## Google Play Console → Segurança dos dados (Data Safety)

**Respostas gerais:**

| Pergunta | Resposta |
|---|---|
| O app coleta ou compartilha dados do usuário? | Sim, coleta |
| Os dados são compartilhados com terceiros? | **Não**. O Google atua como prestador de serviço (Firebase), e a Play não conta isso como compartilhamento |
| Os dados são criptografados em trânsito? | Sim |
| Os usuários podem pedir a exclusão? | Sim, pelo e-mail da política. Não há conta; o envio pode ser desligado em Configurações → Privacidade |
| ID de publicidade (Conteúdo do app) | **Não usa** |

**Tipos de dados** (todos: coletado = sim, compartilhado = não, processado só de forma temporária = não, **opcional = sim**, porque o usuário pode desligar em Configurações → Privacidade):

| Tipo na Play | Finalidade | O que é |
|---|---|---|
| Atividade no app → Interações com o app | Análise | Telas, sessões de pesca, gravações, exports, compartilhamentos |
| Atividade no app → Outro conteúdo gerado pelo usuário | Análise | Espécie digitada na legenda |
| Local → Local aproximado | Análise | UF do onboarding, área de ~5 km vinda do Pesca Certa, região pelo IP |
| Informações e desempenho do app → Registros de falhas | Análise, Funcionalidade do app | Crashlytics |
| Informações e desempenho do app → Diagnóstico | Análise, Funcionalidade do app | Bateria, estado térmico, espaço livre (faixa), memória, quadros perdidos, tempos de câmera/export, códigos de erro, tipo de conexão |
| Informações e desempenho do app → Outros dados de desempenho do app | Análise | Traces do Performance Monitoring |
| IDs do dispositivo ou outros IDs | Análise | ID de instalação do Firebase |

**O que muda em relação à 1.2.0:** marque **Registros de falhas** e **Outros dados de desempenho do app**, e acrescente bateria, temperatura e espaço livre na descrição de **Diagnóstico**.

Não coletamos fotos nem vídeos: eles ficam no aparelho e só saem quando a própria pessoa compartilha, pelo app que escolher. Também não coletamos áudio, contatos, nome, e-mail, telefone ou localização precisa.

## Opt-out (LGPD)

Configurações → Privacidade → **Enviar dados de uso**. Desligado:

- nenhum evento sai, nem os automáticos do Firebase (`first_open`, `session_start`, `screen_view`);
- o Crashlytics e o Performance Monitoring são desligados (`setObservabilityEnabled`);
- a escolha fica só no aparelho (`AsyncStorage`, chave `peguei:analyticsOptOut`).

Além disso, a flag remota `analytics_enabled` desliga todos os eventos para todo mundo, se preciso. O opt-out local sempre vence.

## Remote Config e imagens do patrocinador

O app baixa as chaves de patrocínio e as imagens da marca (por https). A marca é aplicada **no aparelho**. Isso não envia dados do usuário além do que o próprio Firebase usa para entregar a configuração, que já está coberto pelo "Device ID" acima.
