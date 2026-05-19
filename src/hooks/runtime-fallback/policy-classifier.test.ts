import { describe, expect, test } from "bun:test"
import type { RuntimeFallbackConfig } from "../../config"
import { classifyRetryPolicy } from "./error-classifier"
import { classifyAutoRetrySignal } from "./auto-retry-signal"

const baseConfig: RuntimeFallbackConfig = {
  retry_same_model_on: [429, 500, 502, 503, 504],
  retry_advance_chain_on: [],
  retry_on_errors: [429, 500, 502, 503, 504],
}

describe("classifyAutoRetrySignal", () => {
  describe("same-model patterns", () => {
    test("rate limit signal returns same_model_then_chain", () => {
      expect(classifyAutoRetrySignal("rate limit exceeded")).toBe("same_model_then_chain")
    })

    test("cooling down signal returns same_model_then_chain", () => {
      expect(classifyAutoRetrySignal("cooling down for 30 seconds")).toBe("same_model_then_chain")
    })

    test("too many requests signal returns same_model_then_chain", () => {
      expect(classifyAutoRetrySignal("too many requests, please wait")).toBe("same_model_then_chain")
    })

    test("EOF signal returns same_model_then_chain", () => {
      expect(classifyAutoRetrySignal("EOF")).toBe("same_model_then_chain")
    })

    test("unexpected EOF message returns same_model_then_chain", () => {
      expect(classifyAutoRetrySignal("unexpected EOF while reading")).toBe("same_model_then_chain")
    })
  })

  describe("advance-chain patterns", () => {
    test("quota exceeded signal returns chain_only", () => {
      expect(classifyAutoRetrySignal("quota exceeded for this month")).toBe("chain_only")
    })

    test("exhausted capacity signal returns chain_only", () => {
      expect(classifyAutoRetrySignal("exhausted your capacity")).toBe("chain_only")
    })

    test("all credentials for model signal returns chain_only", () => {
      expect(classifyAutoRetrySignal("all credentials for model are exhausted")).toBe("chain_only")
    })
  })

  test("unmatched text returns none", () => {
    expect(classifyAutoRetrySignal("some other status message")).toBe("none")
  })
})

describe("classifyRetryPolicy", () => {
  describe("timeout input", () => {
    test("returns chain_only", () => {
      expect(classifyRetryPolicy({ kind: "timeout" }, baseConfig)).toBe("chain_only")
    })
  })

  describe("auto_retry_signal input", () => {
    test("delegates to classifyAutoRetrySignal for rate-limit text", () => {
      expect(classifyRetryPolicy({ kind: "auto_retry_signal", text: "rate limit" }, baseConfig)).toBe("same_model_then_chain")
    })

    test("delegates to classifyAutoRetrySignal for quota text", () => {
      expect(classifyRetryPolicy({ kind: "auto_retry_signal", text: "quota exceeded" }, baseConfig)).toBe("chain_only")
    })
  })

  describe("error input - error type classification", () => {
    test("missing_api_key returns chain_only", () => {
      const error = { name: "AI_LoadAPIKeyError", message: "api key is missing" }
      expect(classifyRetryPolicy({ kind: "error", error }, baseConfig)).toBe("chain_only")
    })

    test("invalid_api_key returns chain_only", () => {
      const error = { message: "api key must be a string" }
      expect(classifyRetryPolicy({ kind: "error", error }, baseConfig)).toBe("chain_only")
    })

    test("model_not_found returns chain_only", () => {
      const error = { name: "ProviderModelNotFoundError", message: "model not found" }
      expect(classifyRetryPolicy({ kind: "error", error }, baseConfig)).toBe("chain_only")
    })

    test("quota_exceeded returns chain_only", () => {
      const error = { name: "QuotaExceeded", message: "quota exceeded" }
      expect(classifyRetryPolicy({ kind: "error", error }, baseConfig)).toBe("chain_only")
    })
  })

  describe("error input - status code routing", () => {
    test("status 429 in retry_same_model_on returns same_model_then_chain", () => {
      const error = { status: 429, message: "too many requests" }
      expect(classifyRetryPolicy({ kind: "error", error }, baseConfig)).toBe("same_model_then_chain")
    })

    test("status 529 not in any configured list defaults to none", () => {
      const error = { status: 529, message: "unknown error" }
      expect(classifyRetryPolicy({ kind: "error", error }, baseConfig)).toBe("none")
    })

    test("status in retry_advance_chain_on takes precedence", () => {
      const config: RuntimeFallbackConfig = {
        ...baseConfig,
        retry_advance_chain_on: [429],
      }
      const error = { status: 429, message: "overloaded" }
      expect(classifyRetryPolicy({ kind: "error", error }, config)).toBe("chain_only")
    })

    test("ambiguous error with unknown status defaults to none", () => {
      const error = { message: "something unexpected happened" }
      expect(classifyRetryPolicy({ kind: "error", error }, baseConfig)).toBe("none")
    })
  })
})
