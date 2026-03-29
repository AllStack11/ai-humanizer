import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createPacedStreamEmitter, extractStreamTextChunk, llm, llmStream } from "./api.js";
import * as tauri from "./tauri.js";

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
