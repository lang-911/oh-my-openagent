import type { AutoRetryHelpers } from "./auto-retry"
import type { HookDeps, FallbackState } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { prepareFallback } from "./fallback-state"

type DispatchFallbackRetryOptions = {
  sessionID: string
  state: FallbackState
  fallbackModels: string[]
  resolvedAgent?: string
  source: string
}

export async function dispatchFallbackRetry(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  options: DispatchFallbackRetryOptions,
): Promise<void> {
  // Loop: try a model, if same-model retry fails to dispatch, advance and retry.
  // This avoids relying on a second session.error event which causes duplicate fallbacks.
  while (true) {
    const result = prepareFallback(
      options.sessionID,
      options.state,
      options.fallbackModels,
      deps.config,
    )

    if (!result.success) {
      log(`[${HOOK_NAME}] Fallback preparation failed`, {
        sessionID: options.sessionID,
        source: options.source,
        error: result.error,
      })
      return
    }

    if (deps.config.notify_on_fallback) {
      if (result.sameModel) {
        await deps.ctx.client.tui
          .showToast({
            body: {
              title: "Retrying",
              message: `Retrying ${result.newModel?.split("/").pop() || result.newModel} (same model)`,
              variant: "info",
              duration: 5000,
            },
          })
          .catch(() => {})
      } else {
        await deps.ctx.client.tui
          .showToast({
            body: {
              title: "Model Fallback",
              message: `Switching to ${result.newModel?.split("/").pop() || result.newModel} for next request`,
              variant: "warning",
              duration: 5000,
            },
          })
          .catch(() => {})
      }
    }

    const dispatched = await helpers.autoRetryWithFallback(
      options.sessionID,
      result.newModel!,
      options.resolvedAgent,
      options.source,
    )

    // Cross-model fallback dispatched: done. Wait for the retry to complete via events.
    if (!result.sameModel) return

    // Same-model retry dispatched successfully: done. The normal event flow
    // (session.error on the retry's failure) will trigger the next fallback cycle.
    if (dispatched) return

    // Same-model retry failed to dispatch (promptAsync threw, invalid model, etc.).
    // Advance to next model within this same call to avoid duplicate fallback
    // from a subsequent session.error event.
  }
}
