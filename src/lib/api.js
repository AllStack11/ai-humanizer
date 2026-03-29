import { MODEL_OPTIONS } from '../constants/models.js';
import { isTauriRuntime, tauriInvoke, tauriListen } from './tauri.js';

const DEFAULT_STREAM_CHARS_PER_SECOND = import.meta.env?.MODE === "test" ? 420 : 380;

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

export async function llm(system, user, maxTokens = 2400, model = MODEL_OPTIONS[0].value, runtime = {}, options = {}) {
  if (!isTauriRuntime()) throw new Error("Desktop runtime required.");
  const payload = { max_tokens: maxTokens, model, system, messages: [{ role: "user", content: user }] };
  if (typeof options.temperature === "number") payload.temperature = options.temperature;
  if (typeof options.frequency_penalty === "number") payload.frequency_penalty = options.frequency_penalty;
  if (options.response_format && typeof options.response_format === "object") payload.response_format = options.response_format;
  const d = await tauriInvoke("openrouter_chat", {
    payload,
    runtime: normalizeRuntimeConfig(runtime),
  });
  if (d?.error?.message) throw new Error(d.error.message);
  return d.content[0].text;
}

export async function llmStream(system, user, onChunk, maxTokens = 2400, model = MODEL_OPTIONS[0].value, runtime = {}, options = {}) {
  if (!isTauriRuntime()) throw new Error("Desktop runtime required.");
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let fullText = "";
  let streamError = null;
  const pacedEmitter = createPacedStreamEmitter(onChunk, runtime?.streamPacing);

  return new Promise(async (resolve, reject) => {
    let finished = false;
    let unlisten = null;

    const settle = (fn, value) => {
      if (finished) return;
      finished = true;
      if (typeof unlisten === "function") unlisten();
      pacedEmitter.stop();
      fn(value);
    };

    try {
      unlisten = await tauriListen("openrouter_stream", (event) => {
        const payload = event.payload || {};
        if (payload.requestId !== requestId) return;

        if (payload.error) {
          streamError = payload.error;
        }
        if (typeof payload.chunk === "string" && payload.chunk.length) {
          fullText = typeof payload.fullText === "string" ? payload.fullText : (fullText + payload.chunk);
          pacedEmitter.push(payload.chunk, fullText);
        }
      });

      const streamPayload = {
        max_tokens: maxTokens,
        model,
        system,
        stream: true,
        messages: [{ role: "user", content: user }],
      };
      if (typeof options.temperature === "number") streamPayload.temperature = options.temperature;
      if (typeof options.frequency_penalty === "number") streamPayload.frequency_penalty = options.frequency_penalty;
      if (options.response_format && typeof options.response_format === "object") streamPayload.response_format = options.response_format;

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
