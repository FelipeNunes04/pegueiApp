# Release do Peguei: TestFlight e teste fechado da Play

O Peguei é React Native CLI (bare) e já builda com **EAS Build**, então o envio também usa **EAS Submit** (em vez de fastlane). Um comando por loja:

```bash
yarn release:ios:testflight     # preflight + build prod iOS + envio para o TestFlight
yarn release:android:closed     # preflight + build prod Android (AAB) + envio para o teste fechado
```

Os dois rodam o `scripts/preflight.sh` antes e **param se ele falhar**. Nada é enviado sem você rodar o comando: o build é remoto no EAS e o envio acontece no fim dele (`--auto-submit-with-profile prod`).

## Ambientes

| Perfil (`eas.json`) | Para quê | Distribuição | Ambiente EAS (variáveis) | Build number |
|---|---|---|---|---|
| `dev` | development client, depurar no aparelho | interna | `development` | manual |
| `staging` | testar um build de release antes da loja (APK no Android) | interna (link do EAS / ad hoc) | `preview` | automático |
| `prod` | TestFlight e Play | loja | `production` | automático |

Os perfis antigos (`development`, `preview`, `preview-android`, `production`, `production-android`) continuam funcionando, para não quebrar os scripts que já existiam.

**Firebase por ambiente.** Os arquivos `GoogleService-Info.plist` e `google-services.json` ficam fora do git. No EAS, eles vêm das variáveis de arquivo `GOOGLE_SERVICE_INFO_PLIST` e `GOOGLE_SERVICES_JSON`, copiadas pelo `scripts/eas-build-pre-install.sh`. Cada ambiente EAS (`development`, `preview`, `production`) tem as próprias variáveis, então dá para usar um projeto Firebase separado em `development`/`preview` sem mexer no código.

Hoje existe **um projeto só**, `pegueiapp-9d2bb`, e o mesmo bundle id `com.felipenunes.pegueiapp` em todos os perfis. Não foi criado um app `.staging`: ele exigiria outro app no App Store Connect, outro app na Play e outros arquivos do Firebase, que não existem. Se quiser separar os dados de teste:

1. crie um projeto Firebase `pegueiapp-staging` com apps iOS e Android de mesmo bundle id;
2. baixe os dois arquivos e cadastre-os no ambiente `preview` do EAS (`eas env:create --environment preview --type file --name GOOGLE_SERVICE_INFO_PLIST --value ./GoogleService-Info.plist`, idem para `GOOGLE_SERVICES_JSON`);
3. o `preflight.sh` confere o projeto do arquivo local (`pegueiapp-9d2bb`); ajuste `FIREBASE_PROJECT` se for usar outro.

## Versão e build number

- **Versão** (semver): `yarn version:bump 1.3.0` muda `package.json`, `MARKETING_VERSION` (iOS) e `versionName` (Android). Escreva a entrada no `CHANGELOG.md` no mesmo commit.
- **Build number**: automático. O `eas.json` usa `"appVersionSource": "remote"` e `"autoIncrement": true` em `staging` e `prod`, então o EAS soma 1 no `buildNumber`/`versionCode` a cada build. Para ver ou acertar: `npx eas-cli build:version:get -p ios` / `npx eas-cli build:version:set -p android`.

## Passo a passo

### 0. Uma vez só

1. `npx eas-cli login` (conta do projeto `7199cbf5-…`).
2. **iOS, assinatura:** credenciais gerenciadas pelo EAS (`yarn credentials:ios`). Para o envio, cadastre uma **App Store Connect API Key** (App Store Connect → Usuários e acesso → Integrações → Chaves, papel *App Manager*) com `npx eas-cli credentials -p ios` → *App Store Connect API Key*. Nada disso vai para o git.
3. **Android, assinatura:** a keystore de upload e o `credentials.json` ficam **fora do git** (`.gitignore`), e o EAS os lê pelo `credentialsSource: local`. Guarde uma cópia da keystore e das senhas num cofre (1Password, iCloud Keychain). Ative o **Play App Signing** no Play Console (o Google guarda a chave de assinatura; a sua é só a de upload).
4. **Android, envio:** a conta de serviço da Google Play API fica em `./google-play-service-account.json` (fora do git), com permissão de *Gerenciar versões de teste* no app. O `eas.json` aponta para esse caminho; no CI, use a variável de arquivo do EAS em vez do arquivo local.
5. **Firebase:** cadastre `GOOGLE_SERVICE_INFO_PLIST` e `GOOGLE_SERVICES_JSON` nos ambientes EAS `preview` e `production` (veja "Ambientes"). Ligue o export para o BigQuery (Analytics, Crashlytics e Performance), veja `docs/metricas.md`.
6. **Remote Config:** publique as chaves de `docs/analytics.md` (seção Remote Config) com os mesmos padrões. Não é obrigatório: sem elas o app usa os padrões locais.
7. **TestFlight:** crie o grupo de testadores externos **Pescadores Piauí** (TestFlight → Testadores externos → +).
8. **Play:** crie a trilha de teste fechado (Testes → Teste fechado; a trilha padrão se chama `alpha` na API, e é a que o `eas.json` usa) e a lista de e-mails dos testadores.

### 1. Antes de cada versão

```bash
git switch main && git pull
yarn version:bump X.Y.Z          # e escreva a entrada no CHANGELOG.md
yarn preflight                   # tsc, lint, testes, segredos, Firebase, permissões
```

Para testar a versão no aparelho antes da loja: `yarn build:ios:staging` / `yarn build:android:staging` e instale pelo link do EAS.

### 2. iOS → TestFlight

```bash
yarn release:ios:testflight
```

Depois que o EAS terminar:

1. App Store Connect → TestFlight → o build aparece em "Processando" (10 a 30 min).
2. Em **Informações de teste → O que testar**, cole a seção da versão do `CHANGELOG.md` mais o roteiro de teste manual abaixo.
3. Adicione o build ao grupo **Pescadores Piauí**. O primeiro build de cada versão para testadores externos passa pela revisão beta da Apple (normalmente menos de 1 dia).
4. Confira os **rótulos de privacidade** (`docs/privacidade.md`) antes de enviar para revisão da loja.

Só enviar um build já pronto: `yarn submit:ios` (= `eas submit --platform ios --latest`).

### 3. Android → teste fechado

```bash
yarn release:android:closed
```

Depois que o EAS terminar:

1. Play Console → Testar e lançar → Teste fechado → a versão aparece na trilha.
2. Escreva as **notas da versão em pt-BR** (copie do `CHANGELOG.md`). O EAS Submit não envia notas.
3. Confira a **Segurança dos dados** (`docs/privacidade.md`) antes de mandar para revisão.
4. Uns 30 a 60 minutos depois do upload, abra **Relatório de pré-lançamento** (Testar e lançar → Testes → Relatório de pré-lançamento) e revise falhas, avisos de acessibilidade e capturas de tela. Repita a cada versão.

Só enviar um AAB já pronto: `yarn submit:android` (= `eas submit --platform android --latest`).

### Regra da Play para contas pessoais novas

Contas de desenvolvedor **pessoais criadas depois de 13 de novembro de 2023** precisam, antes de pedir acesso à produção, de um **teste fechado com pelo menos 12 testadores que fiquem inscritos sem interrupção por pelo menos 14 dias**. Os 14 dias são seguidos: quem sai e volta recomeça a contagem, e quem testa menos de 14 dias e sai não conta para os 12. Só depois disso aparece o botão de pedir acesso à produção, e o Google ainda revisa o pedido.

Fonte: Ajuda do Play Console, "App testing requirements for new personal developer accounts", <https://support.google.com/googleplay/android-developer/answer/14151465> (consultada em 28/11/2026).

Na prática: convide **15 ou mais** pessoas para ter folga, peça que fiquem inscritas e abram o app algumas vezes nas duas semanas, e não tire ninguém da lista no meio.

## Roteiro de teste manual (testadores)

Para cada item, anote aparelho, sistema, o que aconteceu e, se der, um print. Rode num aparelho de verdade (o simulador não tem câmera).

### Básico

1. Instale, abra, passe o onboarding e aceite câmera e microfone. O buffer começa sozinho ("Sempre gravando").
2. Espere 30 s, toque para gravar, toque de novo. O vídeo salvo tem os segundos **anteriores** ao toque.
3. Galeria: o vídeo aparece, toca, compartilha no WhatsApp e exporta em 9:16 com legenda de espécie e peso.

### Cenários do Peguei

| # | Cenário | Como fazer | O que conferir |
|---|---|---|---|
| 1 | **Sessão de 1 hora com buffer de 60 s** | Configurações → buffer 60 s. Deixe o app na câmera por 1 h (modo bolso pode ligar). Salve 3 vídeos ao longo da hora | Nenhum travamento; cada vídeo tem ~60 s antes do toque; anote a bateria no início e no fim; o aparelho não desliga a câmera sozinho |
| 2 | **Aparelho no sol** | Repita uns 20 min com o celular exposto ao sol (num suporte, sem capa se der) | Se o aparelho esquentar, o app pode baixar o fps, mas o buffer continua; se o sistema avisar temperatura, anote quando |
| 3 | **Pouca memória livre** | Encha o armazenamento até ficar com menos de 1 GB (vídeos grandes) e abra o app | O app abre, grava e avisa se não conseguir salvar; nenhum vídeo corrompido na galeria |
| 4 | **Modo avião (no rio)** | Ligue o modo avião antes de abrir o app. Grave, salve, exporte e tente compartilhar | Tudo funciona offline, menos o envio; o export sai (sem a marca do patrocinador, se ela não estiver no cache). Ao desligar o modo avião, nada trava |
| 5 | **Ligação recebida durante o buffer** | Com o buffer ligado (e também durante uma gravação), peça para alguém ligar. Atenda, fale 30 s, desligue e volte ao app | O buffer volta sozinho depois da ligação; uma gravação em andamento é salva ou avisada, nunca some em silêncio |
| 6 | **Troca de lente durante o buffer** | Com o buffer ligado, alterne entre 0,5x e 1x várias vezes; depois troque durante uma gravação | A imagem troca sem travar; o vídeo salvo mostra a lente usada; nenhum erro de câmera |
| 7 | **App em segundo plano** | Com o buffer ligado, vá para a tela inicial por 2 min e volte | O buffer religa ao voltar (no Android, a notificação "Gravando" pode mantê-lo ligado) |
| 8 | **Pesca Certa** (se a flag estiver ligada) | No export, toque em "Registrar no diário do Pesca Certa" | Abre o diário do Pesca Certa com a espécie e a data; sem o Pesca Certa instalado, abre a loja |

### Para quem acompanha os dados (Felipe)

Use o DebugView (`docs/analytics.md`, "Como validar no Firebase DebugView") num aparelho com build de release:

- cenário 1: `fishing_session_started` → `buffer_health_sampled` a cada 5 min → `capture_latency_measured` em cada vídeo → `fishing_session_ended` 10 min depois de sair da câmera, com `capturas = 3` e `battery_drop_pct`;
- cenário 2: `thermal_state` subindo em `buffer_health_sampled` e `max_thermal_state` no fim;
- cenário 3 (Android): `storage_low_warning_shown` com a flag `storage_warning_enabled` ligada;
- cenário 4: os eventos chegam com atraso depois de voltar a internet, e `connection = offline` nos que foram feitos no modo avião;
- cenário 7: `app_backgrounded_during_buffer` com `duracao_s` perto de 120;
- force o fechamento do app com o buffer ligado e abra de novo: `fishing_session_ended` com `motivo_fim = crash` ou `background`;
- Crashlytics: em Configurações do Firebase → Crashlytics, confira as chaves `buffer_s`, `lente`, `resolucao`, `thermal_state` no próximo erro;
- Performance: traces `camera_cold_start`, `buffer_start`, `capture_save` e `export_9_16` (aparecem em algumas horas).
