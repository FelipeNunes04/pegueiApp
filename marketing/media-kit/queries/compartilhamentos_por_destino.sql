-- Gerada a partir de docs/metricas.md. {{TABELA}} = PROJETO.analytics_XXXX, {{MES}} = AAAA-MM.
CREATE TEMP FUNCTION p_str(params ANY TYPE, k STRING) AS ((SELECT value.string_value FROM UNNEST(params) WHERE key = k));
CREATE TEMP FUNCTION p_num(params ANY TYPE, k STRING) AS ((SELECT COALESCE(value.int_value, value.double_value, value.float_value) FROM UNNEST(params) WHERE key = k));
-- Consulta 4 no mês: vídeos compartilhados por destino (sem a folha cancelada).
SELECT p_str(event_params, 'destino') AS destino,
       SUM(COALESCE(p_num(event_params, 'quantidade'), 1)) AS videos_compartilhados
FROM `{{TABELA}}.events_*`
WHERE event_name = 'video_shared' AND p_str(event_params, 'destino') != 'cancelado'
  AND FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) = '{{MES}}'
GROUP BY destino
ORDER BY videos_compartilhados DESC;
