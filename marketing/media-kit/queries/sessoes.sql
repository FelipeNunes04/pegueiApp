-- Gerada a partir de docs/metricas.md. {{TABELA}} = PROJETO.analytics_XXXX, {{MES}} = AAAA-MM.
CREATE TEMP FUNCTION p_str(params ANY TYPE, k STRING) AS ((SELECT value.string_value FROM UNNEST(params) WHERE key = k));
CREATE TEMP FUNCTION p_num(params ANY TYPE, k STRING) AS ((SELECT COALESCE(value.int_value, value.double_value, value.float_value) FROM UNNEST(params) WHERE key = k));
-- Consultas 2 e 3 no mês: sessões de pesca, duração e capturas.
SELECT
  COUNT(*) AS sessoes,
  COUNT(DISTINCT user_pseudo_id) AS pescadores,
  AVG(p_num(event_params, 'duracao_min')) AS duracao_media_min,
  AVG(p_num(event_params, 'capturas')) AS capturas_por_sessao,
  SAFE_DIVIDE(COUNTIF(p_num(event_params, 'capturas') >= 1), COUNT(*)) AS pct_sessoes_com_captura
FROM `{{TABELA}}.events_*`
WHERE event_name = 'fishing_session_ended'
  AND FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) = '{{MES}}';
