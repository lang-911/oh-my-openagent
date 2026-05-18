import type { FallbackState, FallbackResult, RetryAction } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import type { RuntimeFallbackConfig } from "../../config"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"

function canonicalizeModelID(modelID: string): string {
  const loweredModelID = modelID.toLowerCase()
  const dottedModelID = loweredModelID.replace(/\./g, "-")

  if (
    dottedModelID.startsWith("claude-opus-") ||
    dottedModelID.startsWith("claude-sonnet-") ||
    dottedModelID.startsWith("claude-haiku-")
  ) {
    return dottedModelID
      .replace(/-thinking$/i, "")
      .replace(/-max$/i, "")
      .replace(/-high$/i, "")
  }

  return dottedModelID
}

function canonicalizeProviderFamily(providerID: string, modelID: string): string {
  const canonicalModelID = canonicalizeModelID(modelID)

  if (
    canonicalModelID.startsWith("claude-opus-") ||
    canonicalModelID.startsWith("claude-sonnet-") ||
    canonicalModelID.startsWith("claude-haiku-")
  ) {
    return "anthropic-compatible-claude"
  }

  return providerID.toLowerCase()
}

function parseCanonicalModel(model: string): { providerID: string; modelID: string } | undefined {
  const parsed = parseModelString(model)
  if (!parsed?.providerID || !parsed.modelID) return undefined

  const canonicalModelID = canonicalizeModelID(parsed.modelID)
  const variant = parsed.variant?.toLowerCase()

  return {
    providerID: canonicalizeProviderFamily(parsed.providerID, parsed.modelID),
    modelID: variant ? `${canonicalModelID}::${variant}` : canonicalModelID,
  }
}

function isEquivalentModel(candidate: string, current: string): boolean {
  const parsedCandidate = parseCanonicalModel(candidate)
  const parsedCurrent = parseCanonicalModel(current)

  if (!parsedCandidate || !parsedCurrent) {
    return candidate.toLowerCase() === current.toLowerCase()
  }

  return (
    parsedCandidate.providerID === parsedCurrent.providerID &&
    parsedCandidate.modelID === parsedCurrent.modelID
  )
}

export function createFallbackState(originalModel: string): FallbackState {
  return {
    originalModel,
    currentModel: originalModel,
    fallbackIndex: -1,
    failedModels: new Map<string, number>(),
    attemptCount: 0,
    pendingFallbackModel: undefined,
    sameModelRetries: new Map<string, number>(),
  }
}

export function isModelInCooldown(model: string, state: FallbackState, cooldownSeconds: number): boolean {
  const failedAt = state.failedModels.get(model)
  if (failedAt === undefined) return false
  const cooldownMs = cooldownSeconds * 1000
  return Date.now() - failedAt < cooldownMs
}

export function findNextAvailableFallback(
  state: FallbackState,
  fallbackModels: string[],
  cooldownSeconds: number
): string | undefined {
  for (let i = state.fallbackIndex + 1; i < fallbackModels.length; i++) {
    const candidate = fallbackModels[i]
    if (isEquivalentModel(candidate, state.currentModel)) {
      log(`[${HOOK_NAME}] Skipping equivalent fallback model`, {
        model: candidate,
        currentModel: state.currentModel,
        index: i,
      })
      continue
    }

    if (!isModelInCooldown(candidate, state, cooldownSeconds)) {
      return candidate
    }
    log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, { model: candidate, index: i })
  }
  return undefined
}

export function prepareFallback(
  sessionID: string,
  state: FallbackState,
  fallbackModels: string[],
  config: Required<RuntimeFallbackConfig>,
  action?: RetryAction,
): FallbackResult {
  state.pendingRetryAction = action

  if (action === "none") {
    return { success: false, error: "Retry policy blocked fallback" }
  }

  if (action === "chain_only") {
    return advanceChain(sessionID, state, fallbackModels, config)
  }

  if (action === "same_model_then_chain") {
    const sameModelResult = trySameModelRetry(sessionID, state, config)
    if (sameModelResult) return sameModelResult
    return advanceChain(sessionID, state, fallbackModels, config)
  }

  // Backward-compatible path (action undefined): preserve existing logic
  if (state.attemptCount >= config.max_fallback_attempts) {
    log(`[${HOOK_NAME}] Max fallback attempts reached`, { sessionID, attempts: state.attemptCount })
    return { success: false, error: "Max fallback attempts reached", maxAttemptsReached: true }
  }

  if (config.same_model_max_attempts > 0) {
    const currentModelRetries = state.sameModelRetries.get(state.currentModel) ?? 0
    if (currentModelRetries < config.same_model_max_attempts) {
      state.sameModelRetries.set(state.currentModel, currentModelRetries + 1)
      state.attemptCount++
      state.pendingFallbackModel = state.currentModel
      log(`[${HOOK_NAME}] Same-model retry (${currentModelRetries + 1}/${config.same_model_max_attempts})`, {
        sessionID,
        model: state.currentModel,
        attempt: state.attemptCount,
      })
      return { success: true, newModel: state.currentModel, sameModel: true }
    }
    state.sameModelRetries.delete(state.currentModel)
  }

  return advanceChain(sessionID, state, fallbackModels, config)
}

function trySameModelRetry(
  sessionID: string,
  state: FallbackState,
  config: Required<RuntimeFallbackConfig>,
): FallbackResult | null {
  if (config.same_model_max_attempts > 0) {
    const currentModelRetries = state.sameModelRetries.get(state.currentModel) ?? 0
    if (currentModelRetries < config.same_model_max_attempts) {
      state.sameModelRetries.set(state.currentModel, currentModelRetries + 1)
      state.pendingFallbackModel = state.currentModel
      log(`[${HOOK_NAME}] Same-model retry (${currentModelRetries + 1}/${config.same_model_max_attempts})`, {
        sessionID,
        model: state.currentModel,
      })
      return { success: true, newModel: state.currentModel, sameModel: true }
    }
    state.sameModelRetries.delete(state.currentModel)
  }
  return null
}

function advanceChain(
  sessionID: string,
  state: FallbackState,
  fallbackModels: string[],
  config: Required<RuntimeFallbackConfig>,
): FallbackResult {
  state.pendingRetryAction = undefined

  if (state.attemptCount >= config.max_fallback_attempts) {
    log(`[${HOOK_NAME}] Max fallback attempts reached`, { sessionID, attempts: state.attemptCount })
    return { success: false, error: "Max fallback attempts reached", maxAttemptsReached: true }
  }

  state.sameModelRetries.delete(state.currentModel)

  const nextModel = findNextAvailableFallback(state, fallbackModels, config.cooldown_seconds)

  if (!nextModel) {
    log(`[${HOOK_NAME}] No available fallback models`, { sessionID })
    return { success: false, error: "No available fallback models (all in cooldown or exhausted)" }
  }

  log(`[${HOOK_NAME}] Preparing fallback`, {
    sessionID,
    from: state.currentModel,
    to: nextModel,
    attempt: state.attemptCount + 1,
  })

  const failedModel = state.currentModel
  const now = Date.now()

  state.fallbackIndex = fallbackModels.indexOf(nextModel)
  state.failedModels.set(failedModel, now)
  state.attemptCount++
  state.currentModel = nextModel
  state.pendingFallbackModel = nextModel

  return { success: true, newModel: nextModel, sameModel: false }
}
