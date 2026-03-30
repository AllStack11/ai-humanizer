import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createPacedStreamEmitter, extractStreamTextChunk, llm, llmStream } from "./api.js";
import * as tauri from "./tauri.js";

// Mock fetch for browser-based tests
global.fetch = vi.fn();
const mockFetch = global.fetch;

describe("extractStreamTextChunk", () => {
  test("extracts delta string content", () => {
    const result = extractStreamTextChunk({
      choices: [{ delta: { content: "Hello" } }],
    });
    expect(result).toBe("Hello");
  });

  test("extracts array-based content parts", () => {
    const result = extractStreamTextChunk({
      choices: [{ delta: { content: [{ text: "A" }, { text: "B" }] } }],
    });
    expect(result).toBe("AB");
  });
});

// ─── llm() options passthrough ────────────────────────────────────────────────

describe("llm options passthrough", () => {
  beforeEach(() => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("passes temperature to payload when provided", async () => {
    const invoke = vi.spyOn(tauri, "tauriInvoke").mockResolvedValue({
      content: [{ text: "result" }],
    });

    await llm("sys", "user", 400, "some-model", {}, { temperature: 0.6 });

    const call = invoke.mock.calls[0][1];
    expect(call.payload.temperature).toBe(0.6);
  });

  test("passes frequency_penalty to payload when provided", async () => {
    const invoke = vi.spyOn(tauri, "tauriInvoke").mockResolvedValue({
      content: [{ text: "result" }],
    });

    await llm("sys", "user", 400, "some-model", {}, { frequency_penalty: 0.15 });

    const call = invoke.mock.calls[0][1];
    expect(call.payload.frequency_penalty).toBe(0.15);
  });

  test("passes response_format to payload when provided", async () => {
    const invoke = vi.spyOn(tauri, "tauriInvoke").mockResolvedValue({
      content: [{ text: '{"key":"val"}' }],
    });

    const fmt = { type: "json_object" };
    await llm("sys", "user", 400, "some-model", {}, { response_format: fmt });

    const call = invoke.mock.calls[0][1];
    expect(call.payload.response_format).toEqual(fmt);
  });

  test("omits optional fields when options is empty", async () => {
    const invoke = vi.spyOn(tauri, "tauriInvoke").mockResolvedValue({
      content: [{ text: "result" }],
    });

    await llm("sys", "user", 400, "some-model", {}, {});

    const call = invoke.mock.calls[0][1];
    expect(call.payload).not.toHaveProperty("temperature");
    expect(call.payload).not.toHaveProperty("frequency_penalty");
    expect(call.payload).not.toHaveProperty("response_format");
  });
});

describe("createPacedStreamEmitter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("emits text gradually and flushes final output", async () => {
    const events = [];
    const emitter = createPacedStreamEmitter((chunk, fullText) => {
      events.push({ chunk, fullText });
    }, {
      enabled: true,
      tickMs: 20,
      charsPerSecond: 50,
    });

    emitter.push("hello");
    expect(events).toHaveLength(0);

    const flushPromise = emitter.flush();
    await vi.advanceTimersByTimeAsync(120);
    const finalText = await flushPromise;

    expect(finalText).toBe("hello");
    expect(events.length).toBeGreaterThan(1);
    expect(events[events.length - 1].fullText).toBe("hello");
  });

  test("can bypass pacing and emit immediately", async () => {
    const events = [];
    const emitter = createPacedStreamEmitter((chunk, fullText) => {
      events.push({ chunk, fullText });
    }, {
      enabled: false,
    });

    emitter.push("fast");
    const flushed = await emitter.flush();

    expect(events).toEqual([{ chunk: "fast", fullText: "fast" }]);
    expect(flushed).toBe("fast");
  });
});

describe("llm() browser compatibility", () => {
  beforeEach(() => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(false);
    mockFetch.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("uses fetch in browser mode", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "browser response" } }],
      }),
    });

    const result = await llm("sys", "user", 400, "model", { apiKey: "test-key" });

    expect(result).toBe("browser response");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );
  });

  test("throws error on failed fetch", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid API Key" } }),
    });

    await expect(llm("sys", "user", 400, "model")).rejects.toThrow("Invalid API Key");
  });

  test("ignores placeholder env keys and falls back to the stored browser key", async () => {
    vi.stubEnv("VITE_OPENROUTER_API_KEY", "PLACEHOLDER");
    localStorage.setItem("vh:web:openrouter_api_key", "stored-browser-key");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "browser response" } }],
      }),
    });

    await llm("sys", "user", 400, "model");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer stored-browser-key",
        }),
      })
    );
  });

  test("uses the actual local dev origin when the env app url points at a different localhost port", async () => {
    vi.stubEnv("VITE_OPENROUTER_APP_URL", "http://localhost:5173");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "browser response" } }],
      }),
    });

    await llm("sys", "user", 400, "model", { apiKey: "test-key" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          "HTTP-Referer": "http://localhost:3000",
        }),
      })
    );
  });
});

describe("llmStream() browser compatibility", () => {
  beforeEach(() => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(false);
    mockFetch.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("uses fetch streaming in browser mode", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"chunk1"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"chunk2"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      body: stream,
    });

    const chunks = [];
    const onChunk = (c) => chunks.push(c);

    const result = await llmStream("sys", "user", onChunk, 400, "model", {
      apiKey: "test-key",
      streamPacing: { enabled: false },
    });

    expect(result).toBe("chunk1chunk2");
    expect(chunks).toEqual(["chunk1", "chunk2"]);
    expect(mockFetch).toHaveBeenCalled();
  });

  test("times out and records a failed log when the provider never responds", async () => {
    vi.useFakeTimers();

    mockFetch.mockImplementation((_, options = {}) => new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    }));

    const streamPromise = llmStream("sys", "user", () => {}, 400, "model", {
      apiKey: "test-key",
      streamPacing: { enabled: false },
    });
    const rejection = expect(streamPromise).rejects.toThrow("OpenRouter request timed out before the provider responded.");

    await vi.advanceTimersByTimeAsync(60000);

    await rejection;

    const logs = JSON.parse(localStorage.getItem("vh:web:request_logs") || "[]");
    expect(logs[0].route).toBe("llm:stream");
    expect(logs[0].status).toBe("error");
    expect(logs[0].error).toContain("timed out before the provider responded");
  });
});
