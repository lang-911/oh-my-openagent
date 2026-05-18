import { z } from "zod"

export const RuntimeFallbackConfigSchema = z.object({
  /** Enable runtime fallback (default: false) */
  enabled: z.boolean().optional(),
  /** HTTP status codes that mark an error retryable at all (default: [429, 500, 502, 503, 504]). Errors not in this list and not matched by internal patterns are treated as non-retryable. */
  retry_on_errors: z.array(z.number()).optional(),
  /** HTTP status codes that trigger same-model retry (subset of retry_on_errors). Status codes here consume the `same_model_max_attempts` budget before chain advance. Default: same as retry_on_errors. */
  retry_same_model_on: z.array(z.number()).optional(),
  /** HTTP status codes that force immediate chain advance, bypassing same-model retry entirely. Takes precedence over retry_same_model_on for the same code. Default: []. */
  retry_advance_chain_on: z.array(z.number()).optional(),
  /** Maximum fallback chain advances per session (default: 3). Same-model retries are tracked independently via `same_model_max_attempts`. */
  max_fallback_attempts: z.number().min(1).max(20).optional(),
  /** Max same-model retries per model before downgrading to chain advance (default: 1). Renamed from `same_model_retries` in the runtime-fallback policy split. */
  same_model_max_attempts: z.number().min(0).max(10).optional(),
  /** Cooldown in seconds before retrying a failed model (default: 60) */
  cooldown_seconds: z.number().min(0).optional(),
  /** Session-level timeout in seconds to advance fallback when provider hangs (default: 30). Set to 0 to disable auto-retry signal detection. Timeout-triggered fallback always selects `chain_only`. */
  timeout_seconds: z.number().min(0).optional(),
  /** Show toast notification when switching to fallback model (default: true) */
  notify_on_fallback: z.boolean().optional(),
})

export type RuntimeFallbackConfig = z.infer<typeof RuntimeFallbackConfigSchema>
