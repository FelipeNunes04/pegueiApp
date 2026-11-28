# Métricas do Peguei (BigQuery)

Consultas para as 10 perguntas de negócio do Peguei, sobre o export do Firebase Analytics para o BigQuery. Os eventos e parâmetros estão em [analytics.md](analytics.md). As convenções são as mesmas do Pesca Certa (`docs/metricas.md` de lá), para dar para cruzar os dois.

## Ligar o export (sem custo)

1. Firebase Console (projeto `pegueiapp-9d2bb`) → ⚙ Configurações do projeto → **Integrações** → **BigQuery** → Vincular.
2. Marque **Google Analytics** e a exportação **diária**. A contínua (streaming) é paga.
3. No plano Spark, o vínculo usa o **BigQuery sandbox**, sem cartão: até 10 GB guardados, 1 TB de consulta por mês e **cada tabela diária expira em 60 dias**. Confira na tela do vínculo antes de confirmar. Para guardar mais tempo sem pagar, rode toda semana as consultas de resumo e salve o resultado (ou exporte para o Google Sheets).
4. O primeiro dia de dados aparece cerca de 24 h depois. O conjunto se chama `analytics_<id da propriedade>`.

Nas consultas, troque `PROJETO.analytics_XXXX` pelo seu conjunto. Para cruzar com o Pesca Certa (projeto `pescacerta-6d739`), faça `UNION ALL` das duas tabelas: o parâmetro `app` (`peguei` ou `pesca_certa`) diz de onde veio cada linha.

**Crashlytics e Performance** não vão para o mesmo conjunto: ligue também, na mesma tela de Integrações, o export do **Crashlytics** (conjunto `firebase_crashlytics`) e do **Performance Monitoring** (conjunto `firebase_performance`). As consultas 7 e 8 usam os dois.

### Funções de apoio

Cole no início de cada consulta:

```sql
CREATE TEMP FUNCTION p_str(params ANY TYPE, k STRING) AS (
  (SELECT value.string_value FROM UNNEST(params) WHERE key = k)
);
CREATE TEMP FUNCTION p_num(params ANY TYPE, k STRING) AS (
  (SELECT COALESCE(value.int_value, value.double_value, value.float_value) FROM UNNEST(params) WHERE key = k)
);
CREATE TEMP FUNCTION u_str(props ANY TYPE, k STRING) AS (
  (SELECT value.string_value FROM UNNEST(props) WHERE key = k)
);
```

O usuário é o `user_pseudo_id` (ID de instalação do Firebase). O Peguei não envia `user_id`. Booleanos chegam como `1`/`0` em `int_value`.

## 1. DAU, WAU, MAU, stickiness e retenção D1/D7/D30 por coorte e fonte

```sql
-- DAU, WAU, MAU e stickiness (DAU/MAU) por dia
WITH dias AS (
  SELECT DISTINCT PARSE_DATE('%Y%m%d', event_date) AS dia, user_pseudo_id
  FROM `PROJETO.analytics_XXXX.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY))
                          AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
)
SELECT
  d.dia,
  COUNT(DISTINCT d.user_pseudo_id) AS dau,
  (SELECT COUNT(DISTINCT x.user_pseudo_id) FROM dias x WHERE x.dia BETWEEN DATE_SUB(d.dia, INTERVAL 6 DAY) AND d.dia) AS wau,
  (SELECT COUNT(DISTINCT x.user_pseudo_id) FROM dias x WHERE x.dia BETWEEN DATE_SUB(d.dia, INTERVAL 29 DAY) AND d.dia) AS mau,
  SAFE_DIVIDE(
    COUNT(DISTINCT d.user_pseudo_id),
    (SELECT COUNT(DISTINCT x.user_pseudo_id) FROM dias x WHERE x.dia BETWEEN DATE_SUB(d.dia, INTERVAL 29 DAY) AND d.dia)
  ) AS stickiness
FROM dias d
GROUP BY d.dia
ORDER BY d.dia DESC;
```

```sql
-- Retenção D1, D7 e D30 por coorte semanal (cohort_week) e install_source
WITH primeira AS (
  SELECT
    user_pseudo_id,
    MIN(PARSE_DATE('%Y%m%d', event_date)) AS dia0,
    ANY_VALUE(u_str(user_properties, 'cohort_week')) AS coorte,
    ANY_VALUE(COALESCE(u_str(user_properties, 'install_source'), 'organico')) AS fonte
  FROM `PROJETO.analytics_XXXX.events_*`
  GROUP BY user_pseudo_id
),
ativos AS (
  SELECT DISTINCT user_pseudo_id, PARSE_DATE('%Y%m%d', event_date) AS dia
  FROM `PROJETO.analytics_XXXX.events_*`
  WHERE event_name IN ('app_opened', 'buffer_started', 'gallery_opened')
)
SELECT
  COALESCE(p.coorte, FORMAT_DATE('%G-W%V', p.dia0)) AS coorte,
  p.fonte,
  COUNT(DISTINCT p.user_pseudo_id) AS novos,
  SAFE_DIVIDE(COUNT(DISTINCT IF(a.dia = DATE_ADD(p.dia0, INTERVAL 1 DAY), a.user_pseudo_id, NULL)), COUNT(DISTINCT p.user_pseudo_id)) AS d1,
  SAFE_DIVIDE(COUNT(DISTINCT IF(a.dia = DATE_ADD(p.dia0, INTERVAL 7 DAY), a.user_pseudo_id, NULL)), COUNT(DISTINCT p.user_pseudo_id)) AS d7,
  SAFE_DIVIDE(COUNT(DISTINCT IF(a.dia = DATE_ADD(p.dia0, INTERVAL 30 DAY), a.user_pseudo_id, NULL)), COUNT(DISTINCT p.user_pseudo_id)) AS d30
FROM primeira p
LEFT JOIN ativos a USING (user_pseudo_id)
GROUP BY coorte, fonte
ORDER BY coorte DESC, novos DESC;
```

D30 só faz sentido para coortes com mais de 30 dias. No sandbox, com tabelas de 60 dias, a coorte mais antiga é de uns 30 dias atrás.

## 2. Sessões de pesca por usuário por semana e duração média

```sql
SELECT
  FORMAT_DATE('%G-W%V', PARSE_DATE('%Y%m%d', event_date)) AS semana,
  COUNT(*) AS sessoes,
  COUNT(DISTINCT user_pseudo_id) AS pescadores,
  SAFE_DIVIDE(COUNT(*), COUNT(DISTINCT user_pseudo_id)) AS sessoes_por_usuario,
  AVG(p_num(event_params, 'duracao_min')) AS duracao_media_min,
  APPROX_QUANTILES(p_num(event_params, 'duracao_min'), 100)[OFFSET(50)] AS duracao_mediana_min
FROM `PROJETO.analytics_XXXX.events_*`
WHERE event_name = 'fishing_session_ended'
GROUP BY semana
ORDER BY semana DESC;
```

Uma sessão começa no primeiro `buffer_started` e termina quando o buffer fica desligado por 10 minutos. Ir à galeria e voltar não abre outra sessão.

## 3. Capturas por sessão e % de sessões com pelo menos 1 captura

```sql
SELECT
  FORMAT_DATE('%G-W%V', PARSE_DATE('%Y%m%d', event_date)) AS semana,
  COUNT(*) AS sessoes,
  AVG(p_num(event_params, 'capturas')) AS capturas_por_sessao,
  SAFE_DIVIDE(COUNTIF(p_num(event_params, 'capturas') >= 1), COUNT(*)) AS pct_sessoes_com_captura
FROM `PROJETO.analytics_XXXX.events_*`
WHERE event_name = 'fishing_session_ended'
GROUP BY semana
ORDER BY semana DESC;
```

## 4. Taxa de compartilhamento por vídeo salvo e destino

```sql
WITH base AS (
  SELECT
    FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) AS mes,
    event_name,
    p_str(event_params, 'destino') AS destino,
    COALESCE(p_num(event_params, 'quantidade'), 1) AS quantidade
  FROM `PROJETO.analytics_XXXX.events_*`
  WHERE event_name IN ('video_saved', 'video_shared')
)
SELECT
  mes,
  destino,
  SUM(IF(event_name = 'video_shared', quantidade, 0)) AS videos_compartilhados,
  (SELECT COUNT(*) FROM base b2 WHERE b2.mes = base.mes AND b2.event_name = 'video_saved') AS videos_salvos,
  SAFE_DIVIDE(
    SUM(IF(event_name = 'video_shared', quantidade, 0)),
    (SELECT COUNT(*) FROM base b2 WHERE b2.mes = base.mes AND b2.event_name = 'video_saved')
  ) AS taxa_por_video_salvo
FROM base
WHERE event_name = 'video_shared' AND destino != 'cancelado'
GROUP BY mes, destino
ORDER BY mes DESC, videos_compartilhados DESC;
```

`destino` vale `whatsapp`, `instagram`, `tiktok`, `youtube`, `facebook` ou `outro`. `cancelado` é a folha fechada sem escolher app, por isso fica fora. Antes da 1.3.0, `video_shared` não tinha `formato`, `marca_dagua` nem `sponsor_id`.

## 5. Alcance de patrocinadores: vídeos com a marca por sponsor_id por mês

```sql
SELECT
  FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) AS mes,
  p_str(event_params, 'sponsor_id') AS sponsor_id,
  COUNTIF(event_name = 'sponsor_impression') AS videos_com_a_marca,
  COUNT(DISTINCT IF(event_name = 'sponsor_impression', user_pseudo_id, NULL)) AS pescadores,
  COUNTIF(event_name = 'video_shared' AND p_num(event_params, 'marca_dagua') = 1
          AND p_str(event_params, 'destino') != 'cancelado') AS compartilhados_com_a_marca,
  COUNTIF(event_name = 'sponsor_clicked') AS cliques_no_patrocinador
FROM `PROJETO.analytics_XXXX.events_*`
WHERE event_name IN ('sponsor_impression', 'video_shared', 'sponsor_clicked')
  AND p_str(event_params, 'sponsor_id') IS NOT NULL
  AND p_str(event_params, 'sponsor_id') != ''
GROUP BY mes, sponsor_id
ORDER BY mes DESC, videos_com_a_marca DESC;
```

No relatório para o patrocinador, chame isso de **vídeos com a marca** e **vídeos compartilhados com a marca**. Não é visualização nas redes: o Peguei não sabe quantas pessoas viram o vídeo depois.

## 6. Bateria por hora de buffer por modelo, e sessões encerradas por calor ou bateria

```sql
SELECT
  p_str(event_params, 'device_model') AS modelo,
  p_str(event_params, 'platform') AS plataforma,
  COUNT(*) AS sessoes,
  -- Só sessões de 10 min ou mais, com bateria conhecida (o simulador manda -1).
  SAFE_DIVIDE(
    SUM(IF(p_num(event_params, 'battery_drop_pct') >= 0 AND p_num(event_params, 'duracao_min') >= 10,
           p_num(event_params, 'battery_drop_pct'), 0)),
    SUM(IF(p_num(event_params, 'battery_drop_pct') >= 0 AND p_num(event_params, 'duracao_min') >= 10,
           p_num(event_params, 'duracao_min'), 0)) / 60
  ) AS bateria_pct_por_hora,
  SAFE_DIVIDE(COUNTIF(p_str(event_params, 'motivo_fim') = 'termico'), COUNT(*)) AS pct_fim_por_calor,
  SAFE_DIVIDE(COUNTIF(p_str(event_params, 'motivo_fim') = 'bateria'), COUNT(*)) AS pct_fim_por_bateria,
  SAFE_DIVIDE(COUNTIF(p_str(event_params, 'max_thermal_state') IN ('serious', 'critical')), COUNT(*)) AS pct_sessoes_quentes
FROM `PROJETO.analytics_XXXX.events_*`
WHERE event_name = 'fishing_session_ended'
GROUP BY modelo, plataforma
HAVING sessoes >= 5
ORDER BY bateria_pct_por_hora DESC;
```

`battery_drop_pct` é bateria no início menos bateria no fim, nunca negativa (carregando conta 0). `motivo_fim = termico` quer dizer que o aparelho estava em estado `critical` quando o buffer parou; `bateria`, que estava com 5% ou menos e fora da tomada.

## 7. Latência do toque até o vídeo salvo (p50, p95) por aparelho

```sql
SELECT
  p_str(event_params, 'device_model') AS modelo,
  p_str(event_params, 'resolucao') AS resolucao,
  COUNT(*) AS capturas,
  APPROX_QUANTILES(p_num(event_params, 'toque_ate_salvo_ms'), 100)[OFFSET(50)] AS p50_ms,
  APPROX_QUANTILES(p_num(event_params, 'toque_ate_salvo_ms'), 100)[OFFSET(95)] AS p95_ms
FROM `PROJETO.analytics_XXXX.events_*`
WHERE event_name = 'capture_latency_measured'
GROUP BY modelo, resolucao
HAVING capturas >= 10
ORDER BY p95_ms DESC;
```

O mesmo tempo também está no trace `capture_save` do Performance Monitoring (Firebase Console → Performance → Traces personalizados), que já mostra p50/p90/p95 por versão e aparelho sem SQL.

## 8. Crash-free users por versão e falhas de câmera/export por modelo

```sql
-- Crash-free users por versão (Crashlytics exportado para o BigQuery)
WITH usuarios AS (
  SELECT p_str(event_params, 'app_version') AS versao, COUNT(DISTINCT user_pseudo_id) AS usuarios
  FROM `PROJETO.analytics_XXXX.events_*`
  WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
  GROUP BY versao
),
crashes AS (
  SELECT application.display_version AS versao, COUNT(DISTINCT installation_uuid) AS com_crash
  FROM `PROJETO.firebase_crashlytics.*`
  WHERE is_fatal AND event_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY versao
)
SELECT u.versao, u.usuarios, COALESCE(c.com_crash, 0) AS usuarios_com_crash,
  1 - SAFE_DIVIDE(COALESCE(c.com_crash, 0), u.usuarios) AS crash_free_users
FROM usuarios u
LEFT JOIN crashes c USING (versao)
ORDER BY u.versao DESC;
```

O `installation_uuid` do Crashlytics não é o `user_pseudo_id` do Analytics, então essa conta é uma estimativa. O número oficial está no painel do Crashlytics ("Crash-free users"), por versão.

```sql
-- Falhas de câmera e de export por modelo
SELECT
  p_str(event_params, 'device_model') AS modelo,
  p_str(event_params, 'os_version') AS sistema,
  COUNTIF(event_name = 'camera_init_failed') AS falhas_camera,
  COUNTIF(event_name = 'export_failed' AND p_str(event_params, 'etapa') = 'export') AS falhas_export,
  COUNTIF(event_name = 'capture_failed') AS falhas_gravacao,
  COUNT(DISTINCT IF(event_name = 'fishing_session_started', user_pseudo_id, NULL)) AS pescadores,
  ARRAY_AGG(DISTINCT p_str(event_params, 'erro') IGNORE NULLS LIMIT 5) AS erros
FROM `PROJETO.analytics_XXXX.events_*`
WHERE event_name IN ('camera_init_failed', 'export_failed', 'capture_failed', 'fishing_session_started')
GROUP BY modelo, sistema
HAVING falhas_camera + falhas_export + falhas_gravacao > 0
ORDER BY falhas_camera + falhas_export DESC;
```

## 9. Usuários dos dois apps e retenção comparada

Os dois apps estão em projetos Firebase diferentes, então o `user_pseudo_id` não é o mesmo nos dois e não dá para juntar usuário com usuário. O que liga os dois é a user property `has_pesca_certa = sim` (no Peguei) e `has_peguei = sim` (no Pesca Certa), gravada quando um app abre o outro por link.

```sql
WITH primeira AS (
  SELECT
    user_pseudo_id,
    MIN(PARSE_DATE('%Y%m%d', event_date)) AS dia0,
    LOGICAL_OR(u_str(user_properties, 'has_pesca_certa') = 'sim') AS dois_apps
  FROM `PROJETO.analytics_XXXX.events_*`
  GROUP BY user_pseudo_id
),
ativos AS (
  SELECT DISTINCT user_pseudo_id, PARSE_DATE('%Y%m%d', event_date) AS dia
  FROM `PROJETO.analytics_XXXX.events_*`
)
SELECT
  IF(p.dois_apps, 'peguei + pesca_certa', 'só peguei') AS grupo,
  COUNT(DISTINCT p.user_pseudo_id) AS usuarios,
  SAFE_DIVIDE(COUNT(DISTINCT IF(a.dia = DATE_ADD(p.dia0, INTERVAL 1 DAY), a.user_pseudo_id, NULL)), COUNT(DISTINCT p.user_pseudo_id)) AS d1,
  SAFE_DIVIDE(COUNT(DISTINCT IF(a.dia = DATE_ADD(p.dia0, INTERVAL 7 DAY), a.user_pseudo_id, NULL)), COUNT(DISTINCT p.user_pseudo_id)) AS d7,
  SAFE_DIVIDE(COUNT(DISTINCT IF(a.dia = DATE_ADD(p.dia0, INTERVAL 30 DAY), a.user_pseudo_id, NULL)), COUNT(DISTINCT p.user_pseudo_id)) AS d30
FROM primeira p
LEFT JOIN ativos a USING (user_pseudo_id)
GROUP BY grupo;
```

```sql
-- Conversão do CTA e links entre os apps, por mês
SELECT
  FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) AS mes,
  COUNTIF(event_name = 'pesca_certa_cta_viewed') AS cta_vistos,
  COUNTIF(event_name = 'pesca_certa_cta_clicked') AS cta_clicados,
  COUNTIF(event_name = 'catch_sent_to_pesca_certa') AS capturas_enviadas,
  COUNTIF(event_name = 'opened_from_pesca_certa') AS aberturas_vindas_do_pesca_certa
FROM `PROJETO.analytics_XXXX.events_*`
WHERE event_name IN ('pesca_certa_cta_viewed', 'pesca_certa_cta_clicked', 'catch_sent_to_pesca_certa', 'opened_from_pesca_certa')
GROUP BY mes
ORDER BY mes DESC;
```

Um usuário dos dois apps que nunca usou o link conta como "só peguei". O número real de quem usa os dois é maior que o desta consulta.

## 10. Funil: instalação, permissões, primeira sessão, primeira captura, primeiro compartilhamento

```sql
WITH novos AS (
  SELECT user_pseudo_id, MIN(event_timestamp) AS t0
  FROM `PROJETO.analytics_XXXX.events_*`
  WHERE event_name = 'first_open'
  GROUP BY user_pseudo_id
),
etapas AS (
  SELECT
    e.user_pseudo_id,
    MIN(IF(e.event_name = 'permission_result' AND p_str(e.event_params, 'permission') = 'camera'
           AND p_num(e.event_params, 'granted') = 1, e.event_timestamp, NULL)) AS t_camera,
    MIN(IF(e.event_name = 'permission_result' AND p_str(e.event_params, 'permission') = 'mic'
           AND p_num(e.event_params, 'granted') = 1, e.event_timestamp, NULL)) AS t_mic,
    MIN(IF(e.event_name = 'fishing_session_started', e.event_timestamp, NULL)) AS t_sessao,
    MIN(IF(e.event_name = 'video_saved', e.event_timestamp, NULL)) AS t_captura,
    MIN(IF(e.event_name = 'video_shared' AND p_str(e.event_params, 'destino') != 'cancelado', e.event_timestamp, NULL)) AS t_compartilhou
  FROM `PROJETO.analytics_XXXX.events_*` e
  JOIN novos n USING (user_pseudo_id)
  GROUP BY e.user_pseudo_id
)
SELECT
  COUNT(*) AS instalacoes,
  COUNTIF(t_camera IS NOT NULL AND t_mic IS NOT NULL) AS permissoes_concedidas,
  COUNTIF(t_sessao IS NOT NULL) AS primeira_sessao,
  COUNTIF(t_captura IS NOT NULL) AS primeira_captura,
  COUNTIF(t_compartilhou IS NOT NULL) AS primeiro_compartilhamento
FROM etapas;
```

`first_open` é automático do Firebase. `permission_result` só existe a partir da 1.3.0; quem já tinha dado a permissão antes não passa por ele. Para o funil, use só instalações a partir da 1.3.0 (filtre `app_version >= '1.3.0'` em `novos`).
