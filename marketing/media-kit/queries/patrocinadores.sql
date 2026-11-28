-- Gerada a partir de docs/metricas.md. {{TABELA}} = PROJETO.analytics_XXXX, {{MES}} = AAAA-MM.
CREATE TEMP FUNCTION p_str(params ANY TYPE, k STRING) AS ((SELECT value.string_value FROM UNNEST(params) WHERE key = k));
CREATE TEMP FUNCTION p_num(params ANY TYPE, k STRING) AS ((SELECT COALESCE(value.int_value, value.double_value, value.float_value) FROM UNNEST(params) WHERE key = k));
-- Consulta 5 no mês: vídeos com a marca d'água por sponsor_id. Não é visualização nas redes.
SELECT
  p_str(event_params, 'sponsor_id') AS sponsor_id,
  COUNTIF(event_name = 'sponsor_impression') AS videos_com_a_marca,
  COUNT(DISTINCT IF(event_name = 'sponsor_impression', user_pseudo_id, NULL)) AS pescadores,
  COUNTIF(event_name = 'video_shared' AND p_num(event_params, 'marca_dagua') = 1
          AND p_str(event_params, 'destino') != 'cancelado') AS compartilhados_com_a_marca,
  COUNTIF(event_name = 'sponsor_clicked') AS cliques_no_patrocinador
FROM `{{TABELA}}.events_*`
WHERE event_name IN ('sponsor_impression', 'video_shared', 'sponsor_clicked')
  AND COALESCE(p_str(event_params, 'sponsor_id'), '') != ''
  AND FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) = '{{MES}}'
GROUP BY sponsor_id
ORDER BY videos_com_a_marca DESC;
