import type { AutoRetryHelpers } from "./auto-retry"
import type { HookDeps, FallbackState, RetryAction } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { prepareFallback } from "./fallback-state"

type DispatchFallbackRetryOptions = {
  sessionID: string
  state: FallbackState
  fallbackModels: string[]
  resolvedAgent?: string
  source: string
  action?: RetryAction
}

export async function dispatchFallbackRetry(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  options: DispatchFallbackRetryOptions,
): Promise<void> {
  let action: RetryAction | undefined = options.action

  while (true) {
    const result = prepareFallback(
      options.sessionID,
      options.state,
      options.fallbackModels,
      deps.config,
      action,
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

    if (!result.sameModel) return

    if (dispatched) return

    if (action === "same_model_then_chain") {
      action = "chain_only"
    }
  }
}
