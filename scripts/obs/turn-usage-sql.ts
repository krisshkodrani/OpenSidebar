/** Typed turn usage shared by the Parquet writer and its source verifier. */
export function turnUsageSelectSql(entriesPath: string): string {
  return `
    WITH usage_base AS (
      SELECT session_id, turn_number, day,
        regexp_replace(regexp_replace(trim(coalesce(
          nullif(json_extract_string(raw_json, '$.llmResponse.actualModel'), ''),
          json_extract_string(raw_json, '$.llmRequest.model'), '')),
          '^accounts/[^/]+/routers/', ''), ':nitro$', '') AS model,
        nullif(json_extract_string(raw_json, '$.llmResponse.actualProviderId'), '')
          AS provider,
        coalesce(
          nullif(greatest(TRY_CAST(json_extract_string(raw_json,
            '$.llmResponse.usage.prompt_tokens') AS DOUBLE), 0), 0),
          nullif(greatest(TRY_CAST(json_extract_string(raw_json,
            '$.llmResponse.usage.input_tokens') AS DOUBLE), 0), 0), 0)
          AS prompt_tokens,
        coalesce(
          nullif(greatest(TRY_CAST(json_extract_string(raw_json,
            '$.llmResponse.usage.completion_tokens') AS DOUBLE), 0), 0),
          nullif(greatest(TRY_CAST(json_extract_string(raw_json,
            '$.llmResponse.usage.output_tokens') AS DOUBLE), 0), 0), 0)
          AS completion_tokens,
        coalesce(
          nullif(greatest(TRY_CAST(json_extract_string(raw_json,
            '$.llmResponse.usage.cached_tokens') AS DOUBLE), 0), 0),
          nullif(greatest(TRY_CAST(json_extract_string(raw_json,
            '$.llmResponse.usage.prompt_tokens_details.cached_tokens') AS DOUBLE), 0), 0),
          nullif(greatest(TRY_CAST(json_extract_string(raw_json,
            '$.llmResponse.usage.cacheTelemetry.cachedPromptTokens') AS DOUBLE), 0), 0), 0)
          AS raw_cached_tokens,
        coalesce(TRY_CAST(json_extract_string(raw_json,
          '$.llmResponse.usage.total_tokens') AS DOUBLE), 0) AS raw_total_tokens,
        greatest(coalesce(TRY_CAST(json_extract_string(raw_json,
          '$.llmResponse.usage.cost') AS DOUBLE), 0), 0) AS request_cost,
        coalesce(TRY_CAST(json_extract_string(raw_json,
          '$.llmResponse.durationMs') AS DOUBLE), 0) AS duration_ms,
        nullif(json_extract_string(raw_json, '$.llmRequest.modelTier'), '')
          AS model_tier
      FROM read_parquet(${entriesPath})
    )
    SELECT session_id, turn_number, day, model, provider,
      prompt_tokens, completion_tokens,
      least(prompt_tokens, raw_cached_tokens) AS cached_tokens,
      CASE WHEN raw_total_tokens > 0 THEN raw_total_tokens
        ELSE prompt_tokens + completion_tokens END AS total_tokens,
      request_cost, duration_ms, model_tier
    FROM usage_base
  `;
}
