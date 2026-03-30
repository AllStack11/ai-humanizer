import { normalizeSampleSlot } from "../../utils/index.js";

export function getErrorMessage(error, fallback = "Unexpected error.") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = error.message || error.error || error.reason;
    if (typeof message === "string" && message.trim()) return message;
    try {
      return JSON.stringify(error);
    } catch {
      // Ignore JSON stringify failures and return fallback.
    }
  }
  return fallback;
}

export function isMissingApiKeyError(message) {
  return typeof message === "string" && /api key not found/i.test(message);
}

export function isAbortLikeError(error) {
  const normalized = getErrorMessage(error, "").toLowerCase();
  return (
    error?.name === "AbortError" ||
    normalized.includes("generation canceled") ||
    normalized.includes("signal is aborted") ||
    normalized.includes("the operation was aborted") ||
    normalized.includes("user aborted") ||
    normalized.includes("aborterror")
  );
}

export function classifyRequestIssue(message) {
  const normalized = String(message || "").toLowerCase();

  if (!normalized) {
    return {
      kind: "unknown",
      status: "error",
      summary: "Unknown request failure.",
      detail: "",
      userMessage: "The request failed for an unknown reason.",
    };
  }

  if (
    normalized.includes("generation canceled") ||
    normalized.includes("signal is aborted") ||
    normalized.includes("the operation was aborted") ||
    normalized.includes("user aborted") ||
    normalized.includes("aborterror")
  ) {
    return {
      kind: "canceled",
      status: "canceled",
      summary: "Request canceled.",
      detail: "The in-progress generation was stopped before completion.",
      userMessage: "Generation canceled.",
    };
  }

  if (normalized.includes("api key")) {
    return {
      kind: "auth",
      status: "error",
      summary: "Authentication failed.",
      detail: "OpenRouter API key is missing, invalid, or unreadable.",
      userMessage: "OpenRouter API key is missing, invalid, or unreadable.",
    };
  }

  if (normalized.includes("desktop runtime required") || normalized.includes("tauri runtime")) {
    return {
      kind: "runtime",
      status: "error",
      summary: "Desktop runtime unavailable.",
      detail: "This request can only run inside the desktop app.",
      userMessage: "This action only works inside the desktop app.",
    };
  }

  if (
    normalized.includes("rate-limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("rate limited") ||
    normalized.includes("http 429") ||
    normalized.includes("code\":429") ||
    normalized.includes("status=429") ||
    normalized.includes("too many requests")
  ) {
    return {
      kind: "rate_limit",
      status: "error",
      summary: "Rate limited by provider.",
      detail: "OpenRouter or the upstream model provider asked the app to slow down.",
      userMessage: "That model is rate limited right now. Retry in a moment or switch to another model.",
    };
  }

  if (
    normalized.includes("insufficient credits") ||
    normalized.includes("quota") ||
    normalized.includes("billing") ||
    normalized.includes("payment required") ||
    normalized.includes("credit balance")
  ) {
    return {
      kind: "billing",
      status: "error",
      summary: "Provider billing or quota issue.",
      detail: "The request was blocked by usage limits, credits, or billing settings.",
      userMessage: "The request was blocked by usage limits or billing. Check your OpenRouter credits and quotas.",
    };
  }

  if (normalized.includes("failed to reach openrouter")) {
    return {
      kind: "network",
      status: "error",
      summary: "Network request failed.",
      detail: "The app could not reach the model provider.",
      userMessage: "The app could not reach OpenRouter. Check your connection and API URL, then try again.",
    };
  }

  if (
    normalized.includes("http 401") ||
    normalized.includes("http 403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("invalid api key")
  ) {
    return {
      kind: "auth",
      status: "error",
      summary: "Authentication failed.",
      detail: "OpenRouter rejected the request due to missing or invalid credentials.",
      userMessage: "OpenRouter rejected the request. Check your API key and try again.",
    };
  }

  if (
    normalized.includes("http 408") ||
    normalized.includes("http 504") ||
    normalized.includes("did not start streaming") ||
    normalized.includes("before the provider responded") ||
    normalized.includes("before the model began streaming") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return {
      kind: "timeout",
      status: "error",
      summary: "Provider timed out.",
      detail: "The model took too long to respond or the connection timed out.",
      userMessage: "The model took too long to respond. Retry in a moment or try a faster model.",
    };
  }

  if (
    normalized.includes("http 502") ||
    normalized.includes("http 503") ||
    normalized.includes("http 504") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("overloaded") ||
    normalized.includes("upstream")
  ) {
    return {
      kind: "provider_unavailable",
      status: "error",
      summary: "Provider unavailable.",
      detail: "OpenRouter or the upstream provider was unavailable or overloaded.",
      userMessage: "That provider is unavailable right now. Retry shortly or switch to another model.",
    };
  }

  if (normalized.includes("http ")) {
    return {
      kind: "http_error",
      status: "error",
      summary: "Provider rejected the request.",
      detail: "The model endpoint returned an HTTP error.",
      userMessage: "The model provider rejected the request. Check the diagnostics log for the exact response.",
    };
  }

  if (normalized.includes("parse")) {
    return {
      kind: "parse",
      status: "error",
      summary: "Provider response could not be parsed.",
      detail: "The app received malformed or unexpected model output.",
      userMessage: "The provider returned malformed or unexpected output.",
    };
  }

  if (normalized.includes("empty response")) {
    return {
      kind: "empty_response",
      status: "error",
      summary: "Model returned no output.",
      detail: "The request completed but produced no usable text.",
      userMessage: "The model finished without producing usable text.",
    };
  }

  return {
    kind: "request_failed",
    status: "error",
    summary: "Request failed.",
    detail: message,
    userMessage: message,
  };
}

export function parseJsonFromModelOutput(raw) {
  const input = String(raw || "").trim();
  if (!input) throw new Error("Empty model response.");

  // Attempt 1: Direct parse (most common for clean JSON)
  try {
    const cleaned = input.replace(/```json|```/gi, "").trim();
    return JSON.parse(cleaned);
  } catch {
    // If direct parse fails, move to extraction
  }

  // Attempt 2: Extract JSON structure from string
  const startObj = input.indexOf("{");
  const startArr = input.indexOf("[");

  const startIdx = (startObj !== -1 && startArr !== -1)
    ? Math.min(startObj, startArr)
    : (startObj !== -1 ? startObj : startArr);

  if (startIdx === -1) {
    throw new Error(`Invalid JSON format: no starting '{' or '[' found in output.`);
  }

  const endChar = input[startIdx] === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === input[startIdx]) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          const potentialJson = input.slice(startIdx, i + 1);
          try {
            return JSON.parse(potentialJson);
          } catch (e) {
            // If this specific segment fails, continue scanning (might be nested)
          }
        }
      }
    }
  }

  throw new Error("Could not extract a valid JSON object or array from the model response.");
}

export function dedupeSampleEntries(entries) {
  const seen = new Set();
  const deduped = [];
  for (const rawEntry of entries || []) {
    const normalized = normalizeSampleSlot(rawEntry, deduped.length + 1);
    const text = normalized.text.trim();
    if (!text) continue;
    const key = `${normalized.type}::${text.toLowerCase().replace(/\s+/g, " ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...normalized,
      id: deduped.length + 1,
      text,
    });
  }
  return deduped;
}
