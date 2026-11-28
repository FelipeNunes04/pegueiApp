-- Gerada a partir de docs/metricas.md. {{TABELA}} = PROJETO.analytics_XXXX, {{MES}} = AAAA-MM.
CREATE TEMP FUNCTION p_str(params ANY TYPE, k STRING) AS ((SELECT value.string_value FROM UNNEST(params) WHERE key = k));
CREATE TEMP FUNCTION p_num(params ANY TYPE, k STRING) AS ((SELECT COALESCE(value.int_value, value.double_value, value.float_value) FROM UNNEST(params) WHERE key = k));
-- Consulta 1 por região: o parâmetro comum uf (onboarding, opcional). Sem uf vira nao_informado.
SELECT COALESCE(NULLIF(p_str(event_params, 'uf'), ''), 'nao_informado') AS uf,
       COUNT(DISTINCT user_pseudo_id) AS usuarios_ativos
FROM `{{TABELA}}.events_*`
WHERE FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) = '{{MES}}'
GROUP BY uf
ORDER BY usuarios_ativos DESC;
