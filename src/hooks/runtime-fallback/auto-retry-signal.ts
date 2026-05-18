import type { RetryAction } from "./types"

export interface AutoRetrySignal {
  signal: string
}

const SAME_MODEL_AUTO_RETRY_PATTERNS: RegExp[] = [
  /rate\s+limit/i,
  /cool(?:ing)?\s*down/i,
  /too\s+many\s+requests/i,
  /\beof\b/i,
]

const ADVANCE_CHAIN_AUTO_RETRY_PATTERNS: RegExp[] = [
  /quota\s*exceeded/i,
  /exhausted\s+your\s+capacity/i,
  /all\s+credentials\s+for\s+model/i,
]

const AUTO_RETRY_PATTERNS: Array<(combined: string) => boolean> = [
  (combined) => /retrying\s+in/i.test(combined),
  (combined) =>
    /(?:too\s+many\s+requests|quota\s+will\s+reset\s+after|quota\s*exceeded|exceeded.*quota|usage\s+limit|usage\s*quota|rate\s+limit|limit\s+reached|all\s+credentials\s+for\s+model|cool(?:ing)?\s*down|exhausted\s+your\s+capacity)/i.test(combined),
]

export function classifyAutoRetrySignal(text: string): RetryAction {
  if (SAME_MODEL_AUTO_RETRY_PATTERNS.some((re) => re.test(text))) {
    return "same_model_then_chain"
  }
  if (ADVANCE_CHAIN_AUTO_RETRY_PATTERNS.some((re) => re.test(text))) {
    return "chain_only"
  }
  return "none"
}

export function extractAutoRetrySignal(info: Record<string, unknown> | undefined): AutoRetrySignal | undefined {
  if (!info) return undefined

  const candidates: string[] = []

  const directStatus = info.status
  if (typeof directStatus === "string") candidates.push(directStatus)

  const summary = info.summary
  if (typeof summary === "string") candidates.push(summary)

  const message = info.message
  if (typeof message === "string") candidates.push(message)

  const details = info.details
  if (typeof details === "string") candidates.push(details)

  const combined = candidates.join("\n")
  if (!combined) return undefined

  return AUTO_RETRY_PATTERNS.some((test) => test(combined)) ? { signal: combined } : undefined
}
