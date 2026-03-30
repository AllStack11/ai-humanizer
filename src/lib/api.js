import { MODEL_OPTIONS } from '../constants/models.js';
import { isTauriRuntime, tauriInvoke, tauriListen } from './tauri.js';
import { createWebRequestLog, updateWebRequestLog } from './storage.js';
import { classifyRequestIssue, getErrorMessage, isAbortLikeError } from '../features/app/helpers.js';

const DEFAULT_STREAM_CHARS_PER_SECOND = import.meta.env?.MODE === "test" ? 420 : 380;
const NETWORK_TIMEOUT_MS = 60000;

const DEFAULT_STREAM_PACING = {
  enabled: true,
  tickMs: 20,
  charsPerSecond: DEFAULT_STREAM_CHARS_PER_SECOND,
};

function normalizeRuntimeConfig(runtime = {}) {
  if (!runtime || typeof runtime !== "object") return {};
  const apiUrl = typeof runtime.apiUrl === "string" ? runtime.apiUrl.trim() : "";
  const apiKeyFile = typeof runtime.apiKeyFile === "string" ? runtime.apiKeyFile.trim() : "";
  return {
    ...(apiUrl ? { api_url: apiUrl } : {}),
    ...(apiKeyFile ? { api_key_file: apiKeyFile } : {}),
  };
}

function normalizeStreamPacingConfig(rawConfig = {}) {
  if (rawConfig === false) return { ...DEFAULT_STREAM_PACING, enabled: false };
  if (rawConfig === true) return { ...DEFAULT_STREAM_PACING, enabled: true };
  if (!rawConfig || typeof rawConfig !== "object") return { ...DEFAULT_STREAM_PACING };

  const enabled = typeof rawConfig.enabled === "boolean" ? rawConfig.enabled : DEFAULT_STREAM_PACING.enabled;
  const tickMsValue = Number(rawConfig.tickMs);
  const charsPerSecondValue = Number(rawConfig.charsPerSecond);

  return {
    enabled,
    tickMs: Number.isFinite(tickMsValue) ? Math.min(120, Math.max(10, Math.round(tickMsValue))) : DEFAULT_STREAM_PACING.tickMs,
    charsPerSecond: Number.isFinite(charsPerSecondValue)
      ? Math.min(2200, Math.max(40, Math.round(charsPerSecondValue)))
      : DEFAULT_STREAM_PACING.charsPerSecond,
  };
}

export function createPacedStreamEmitter(onChunk, pacingConfig = {}) {
  const config = normalizeStreamPacingConfig(pacingConfig);
  const emitChunk = typeof onChunk === "function" ? onChunk : () => {};

  let intervalId = null;
  let queued = "";
  let displayedText = "";
  const pendingFlushResolvers = [];

  const baseCharsPerTick = Math.max(1, Math.round((config.charsPerSecond * config.tickMs) / 1000));

  const resolvePendingFlushes = () => {
    if (queued.length || intervalId) return;
    while (pendingFlushResolvers.length) {
      const resolve = pendingFlushResolvers.shift();
      resolve(displayedText);
    }
  };

  const stopTimer = () => {
    if (intervalId == null) return;
    window.clearInterval(intervalId);
    intervalId = null;
  };

  const streamTick = () => {
    if (!queued.length) {
      stopTimer();
      resolvePendingFlushes();
      return;
    }

    const backlogBoost = Math.floor(queued.length / 260);
    const emitLength = Math.max(1, baseCharsPerTick + backlogBoost);
    const chunk = queued.slice(0, emitLength);
    queued = queued.slice(emitLength);
    displayedText += chunk;
    emitChunk(chunk, displayedText);

    if (!queued.length) {
      stopTimer();
      resolvePendingFlushes();
    }
  };

  const startTimer = () => {
    if (intervalId != null) return;
    intervalId = window.setInterval(streamTick, config.tickMs);
  };

  const push = (incomingChunk, authoritativeFullText = null) => {
    const chunk = String(incomingChunk || "");
    if (!chunk) return;

    if (!config.enabled) {
      displayedText = typeof authoritativeFullText === "string" ? authoritativeFullText : (displayedText + chunk);
      emitChunk(chunk, displayedText);
      return;
    }

    queued += chunk;
    startTimer();
  };

  const flush = async () => {
    if (!config.enabled) return displayedText;
    if (!queued.length && intervalId == null) return displayedText;
    return new Promise((resolve) => pendingFlushResolvers.push(resolve));
  };

  const stop = () => {
    stopTimer();
    queued = "";
    resolvePendingFlushes();
  };

  return {
    push,
    flush,
    stop,
  };
}

export function extractStreamTextChunk(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) return "";

  const delta = choice.delta?.content;
  if (typeof delta === "string") return delta;
  if (Array.isArray(delta)) {
    return delta.map(part => (typeof part?.text === "string" ? part.text : "")).join("");
  }

  const messageContent = choice.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent.map(part => (typeof part?.text === "string" ? part.text : "")).join("");
  }

  return "";
}

function normalizeEnvValue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "PLACEHOLDER") return "";
  return trimmed;
}

function resolveBrowserReferer() {
  const envAppUrl = normalizeEnvValue(import.meta.env.VITE_OPENROUTER_APP_URL);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (!origin) return envAppUrl;
  if (!envAppUrl) return origin;

  try {
    const originUrl = new URL(origin);
    const envUrl = new URL(envAppUrl);
    const isLocalOrigin = ["localhost", "127.0.0.1"].includes(originUrl.hostname);
    const isLocalEnv = ["localhost", "127.0.0.1"].includes(envUrl.hostname);
    if (isLocalOrigin && isLocalEnv && originUrl.origin !== envUrl.origin) {
      return origin;
    }
  } catch {
    return origin;
  }

  return envAppUrl;
}

async function fetchWithApiKey(url, payload, runtime = {}) {
  // If no explicit key in runtime config, check environment before localStorage (device)
  const envKey = normalizeEnvValue(import.meta.env.VITE_OPENROUTER_API_KEY);
  const storedKey = !isTauriRuntime() ? localStorage.getItem("vh:web:openrouter_api_key") : "";
  const apiKey = runtime.apiKey || envKey || storedKey || "";
  const headers = {
    "Content-Type": "application/json",
    "HTTP-Referer": resolveBrowserReferer(),
    "X-Title": normalizeEnvValue(import.meta.env.VITE_OPENROUTER_APP_NAME) || "Voice Humanizer (Web)",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: runtime.signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || `HTTP ${response.status}`);
  }
  return response;
}

function createAbortError() {
  const error = new Error("Generation canceled.");
  error.name = "AbortError";
  return error;
}

function createTimeoutError(message) {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

function createLinkedTimeoutController(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let didTimeout = false;
  let timeoutId = null;

  const onAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (timeoutMs > 0) {
    timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  const cleanup = () => {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
  };

  return {
    signal: controller.signal,
    cleanup,
    didTimeout: () => didTimeout,
  };
}

async function readStreamWithTimeout(reader, timeoutMs, message) {
  let timeoutId = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(createTimeoutError(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}

function buildLogErrorPayload(error, fallbackStatus = "error") {
  const message = getErrorMessage(error);
  const issue = classifyRequestIssue(message);
  return {
    status: issue.status || fallbackStatus,
    error: message,
    errorSummary: issue.summary,
    errorDetail: issue.detail || message,
    errorKind: issue.kind || "request_failed",
    userMessage: issue.userMessage || message,
  };
}

export async function llm(system, user, maxTokens = 2400, model = MODEL_OPTIONS[0].value, runtime = {}, options = {}) {
  const builtMessages = [];
  if (system && system.trim()) builtMessages.push({ role: "system", content: system.trim() });
  builtMessages.push({ role: "user", content: user });
  const payload = { max_tokens: maxTokens, model, messages: builtMessages };
  if (typeof options.temperature === "number") payload.temperature = options.temperature;
  if (typeof options.frequency_penalty === "number") payload.frequency_penalty = options.frequency_penalty;
  if (options.response_format && typeof options.response_format === "object") payload.response_format = options.response_format;

  if (isTauriRuntime()) {
    const d = await tauriInvoke("openrouter_chat", {
      payload,
      runtime: normalizeRuntimeConfig(runtime),
    });
    if (d?.error?.message) throw new Error(d.error.message);
    return d.content[0].text;
  }

  const start = Date.now();
  const url = runtime.apiUrl || "https://openrouter.ai/api/v1/chat/completions";
  const requestLogId = await createWebRequestLog({
    route: "llm:chat",
    model,
    request: { system, messages: payload.messages },
    status: "started",
  });
  const timeoutController = createLinkedTimeoutController(runtime.signal, NETWORK_TIMEOUT_MS);
  try {
    const response = await fetchWithApiKey(url, payload, { ...runtime, signal: timeoutController.signal });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    if (typeof options.onUsage === "function" && data?.usage) options.onUsage(data.usage);
    await updateWebRequestLog(requestLogId, {
      durationMs: Date.now() - start,
      responsePreview: content.slice(0, 200),
      usage: data.usage,
      status: "success",
    });
    return content;
  } catch (e) {
    const normalizedError = timeoutController.didTimeout()
      ? createTimeoutError("OpenRouter request timed out before the provider responded.")
      : (isAbortLikeError(e) ? createAbortError() : e);
    await updateWebRequestLog(requestLogId, {
      durationMs: Date.now() - start,
      ...buildLogErrorPayload(normalizedError),
    });
    throw normalizedError;
  } finally {
    timeoutController.cleanup();
  }
}

export async function llmStream(system, user, onChunk, maxTokens = 2400, model = MODEL_OPTIONS[0].value, runtime = {}, options = {}) {
  const trimmedSystem = typeof system === "string" ? system.trim() : "";
  const builtStreamMessages = [{ role: "user", content: user }];
  const streamPayload = {
    max_tokens: maxTokens,
    model,
    stream: true,
    messages: builtStreamMessages,
  };
  if (trimmedSystem) streamPayload.system = trimmedSystem;
  if (typeof options.temperature === "number") streamPayload.temperature = options.temperature;
  if (typeof options.frequency_penalty === "number") streamPayload.frequency_penalty = options.frequency_penalty;
  if (options.response_format && typeof options.response_format === "object") streamPayload.response_format = options.response_format;

  const pacedEmitter = createPacedStreamEmitter(onChunk, runtime?.streamPacing);
  let fullText = "";
  let latestUsage = null;

  if (isTauriRuntime()) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let streamError = null;

    return new Promise(async (resolve, reject) => {
      let finished = false;
      let unlisten = null;
      const abortHandler = () => settle(reject, createAbortError());

      const settle = (fn, value) => {
        if (finished) return;
        finished = true;
        if (runtime?.signal) runtime.signal.removeEventListener("abort", abortHandler);
        if (typeof unlisten === "function") unlisten();
        pacedEmitter.stop();
        fn(value);
      };

      try {
        if (runtime?.signal?.aborted) {
          settle(reject, createAbortError());
          return;
        }
        if (runtime?.signal) runtime.signal.addEventListener("abort", abortHandler, { once: true });
        unlisten = await tauriListen("openrouter_stream", (event) => {
          const payload = event.payload || {};
          if (payload.requestId !== requestId) return;

          if (payload.usage) {
            latestUsage = payload.usage;
            if (typeof options.onUsage === "function") options.onUsage(payload.usage);
          }
          if (payload.error) {
            streamError = payload.error;
          }
          if (typeof payload.chunk === "string" && payload.chunk.length) {
            fullText = typeof payload.fullText === "string" ? payload.fullText : (fullText + payload.chunk);
            pacedEmitter.push(payload.chunk, fullText);
          }
        });

        await tauriInvoke("openrouter_chat_stream", {
          requestId,
          runtime: normalizeRuntimeConfig(runtime),
          payload: streamPayload,
        });

        await pacedEmitter.flush();
        if (streamError) {
          settle(reject, new Error(streamError));
          return;
        }
        settle(resolve, fullText);
      } catch (e) {
        settle(reject, e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  // Browser-based fetch streaming
  const start = Date.now();
  const url = runtime.apiUrl || "https://openrouter.ai/api/v1/chat/completions";
  const requestLogId = await createWebRequestLog({
    route: "llm:stream",
    model,
    request: { system, messages: streamPayload.messages },
    stream: true,
    status: "started",
  });
  const fetchTimeoutController = createLinkedTimeoutController(runtime.signal, NETWORK_TIMEOUT_MS);
  let response;
  try {
    response = await fetchWithApiKey(url, streamPayload, { ...runtime, signal: fetchTimeoutController.signal });
  } catch (e) {
    const normalizedError = fetchTimeoutController.didTimeout()
      ? createTimeoutError("OpenRouter request timed out before the provider responded.")
      : (isAbortLikeError(e) || runtime?.signal?.aborted ? createAbortError() : e);
    await updateWebRequestLog(requestLogId, {
      durationMs: Date.now() - start,
      ...buildLogErrorPayload(normalizedError),
    });
    throw normalizedError;
  } finally {
    fetchTimeoutController.cleanup();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let hasReceivedFirstChunk = false;

  try {
    while (true) {
      if (runtime?.signal?.aborted) throw createAbortError();
      const { done, value } = await readStreamWithTimeout(
        reader,
        NETWORK_TIMEOUT_MS,
        hasReceivedFirstChunk
          ? "Model stream stalled before the next chunk arrived."
          : "Model stream did not start streaming before the provider responded timeout elapsed."
      );
      if (done) break;
      hasReceivedFirstChunk = true;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === "[DONE]") continue;

        try {
          const json = JSON.parse(dataStr);
          if (json?.usage) {
            latestUsage = json.usage;
            if (typeof options.onUsage === "function") options.onUsage(json.usage);
          }
          const chunk = extractStreamTextChunk(json);
          if (chunk) {
            fullText += chunk;
            pacedEmitter.push(chunk, fullText);
          }
        } catch (e) {
          console.error("Error parsing stream chunk:", e);
        }
      }
    }
    await pacedEmitter.flush();
    await updateWebRequestLog(requestLogId, {
      durationMs: Date.now() - start,
      responsePreview: fullText.slice(0, 200),
      usage: latestUsage,
      status: "success",
    });
    return fullText;
  } catch (e) {
    const normalizedError = isAbortLikeError(e) || runtime?.signal?.aborted ? createAbortError() : e;
    pacedEmitter.stop();
    if (runtime?.signal?.aborted || normalizedError?.name === "TimeoutError") {
      try {
        await reader.cancel();
      } catch {}
    }
    await updateWebRequestLog(requestLogId, {
      durationMs: Date.now() - start,
      ...buildLogErrorPayload(normalizedError),
    });
    throw normalizedError;
  }
}
