-- Gerada a partir de docs/metricas.md. {{TABELA}} = PROJETO.analytics_XXXX, {{MES}} = AAAA-MM.
CREATE TEMP FUNCTION p_str(params ANY TYPE, k STRING) AS ((SELECT value.string_value FROM UNNEST(params) WHERE key = k));
CREATE TEMP FUNCTION p_num(params ANY TYPE, k STRING) AS ((SELECT COALESCE(value.int_value, value.double_value, value.float_value) FROM UNNEST(params) WHERE key = k));
-- Consulta 1 (MAU) restrita ao mês: pescadores com qualquer evento no mês, e DAU médio.
WITH dias AS (
  SELECT DISTINCT PARSE_DATE('%Y%m%d', event_date) AS dia, user_pseudo_id
  FROM `{{TABELA}}.events_*`
  WHERE FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) = '{{MES}}'
)
SELECT
  (SELECT COUNT(DISTINCT user_pseudo_id) FROM dias) AS usuarios_ativos_total,
  (SELECT AVG(n) FROM (SELECT COUNT(*) AS n FROM dias GROUP BY dia)) AS dau_medio;
