# Changelog

Todas as mudanças relevantes do Peguei. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versões em [semver](https://semver.org/lang/pt-BR/). O build number é automático (EAS, veja `docs/release.md`).

## [1.3.0] - 2026-11-28

### O que testar (TestFlight / teste fechado)

- Uma pescaria longa (1 hora, buffer de 60 s), com o aparelho no sol e em modo avião.
- Ligação recebida e troca de lente com o buffer ligado.
- O roteiro completo está em `docs/release.md`.

### Novo

- Link `peguei://` também no iPhone: o Pesca Certa pode abrir a câmera do Peguei.
- Botão "Registrar no diário do Pesca Certa" no export, que leva espécie e data para o diário (desligado até ligarmos no Remote Config).
- Aviso de pouco espaço livre na câmera (desligado até ligarmos no Remote Config).
- O aviso de patrocínio do export pode abrir o site do patrocinador (quando houver link).

### Analytics e diagnóstico

- Sessão de pesca: início e fim, duração, capturas, bateria gasta, temperatura máxima e motivo do fim (inclusive quando o app fecha sozinho).
- Amostra da saúde do buffer a cada 5 min no máximo: quadros perdidos, memória e temperatura, lidas fora da thread da câmera.
- Novos eventos de captura, galeria, compartilhamento, permissões, falhas de câmera e export, e do ecossistema com o Pesca Certa.
- Parâmetros comuns `uf`, `region_geohash5` e `connection`, iguais aos do Pesca Certa, e as user properties do plano (`has_pesca_certa`, `install_source`, `cohort_week`, faixas de vídeos e de espaço livre, preferências de buffer e lente).
- Firebase Crashlytics (falhas, erros e chaves de contexto) e Performance Monitoring (traces `camera_cold_start`, `buffer_start`, `capture_save` e `export_9_16`).
- Flags novas no Remote Config, todas com padrão local para funcionar offline.
- `docs/metricas.md` com as consultas do BigQuery para as 10 métricas do Peguei.

### Privacidade

- Novos dados declarados: relatórios de falha, dados de desempenho, bateria, temperatura e espaço livre. Rótulos da App Store e Segurança dos dados da Play em `docs/privacidade.md`; política de privacidade atualizada.
- No iPhone o espaço livre nunca sai do aparelho (regra da Apple para a API de espaço em disco).
- Continua sem rastreamento entre apps, sem ID de publicidade e com o opt-out em Configurações → Privacidade, que agora também desliga o Crashlytics e o Performance.

### Build e release

- Perfis `dev`, `staging` e `prod` no `eas.json`, com build number automático.
- `yarn release:ios:testflight` e `yarn release:android:closed`.
- `scripts/preflight.sh`: tsc, lint, testes, busca de segredos no repositório e no bundle, arquivos do Firebase e permissões declaradas x usadas.
- `scripts/bump-version.sh` para a versão semântica.
- Regras do R8 para o release Android e upload do mapping para o Crashlytics.

## [1.2.0] - 2026-11-26

- Camada de analytics tipada (`src/analytics`) com opt-out local e ponte nativa `PegueiAnalytics`.
- Remote Config de patrocínio, marca d'água e export 9:16 com legenda de espécie e peso (`PegueiVideoExport`).
- Pedido de avaliação nativo depois do 3º vídeo salvo.
- `docs/analytics.md` e `docs/privacidade.md`.

## [1.1.2]

- Correções do QA da 1.1.2.

## [1.1.1]

- Confiabilidade do buffer, economia de bateria e gatilhos por botão de volume e controle Bluetooth.
- Som e vibração ao iniciar e parar a gravação.
- Gravação em segundo plano no Android.
