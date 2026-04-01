import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { storeApiKey, hasStoredApiKey, clearStoredApiKey, getApiKeyStatus, load, save, resetAppData } from "./storage.js";
import * as tauri from "./tauri.js";

describe("storage browser compatibility", () => {
  beforeEach(() => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(false);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("stores and retrieves API key in browser mode", async () => {
    // Note: In test environment, VITE_OPENROUTER_API_KEY might be set in .env
    // but here we are testing the storage mechanism.
    // If the environment variable is present, getApiKeyStatus will report "environment".
    await storeApiKey("browser-test-key");
    const hasKey = await hasStoredApiKey();
    expect(hasKey).toBe(true);
    
    const status = await getApiKeyStatus();
    expect(status.hasKey).toBe(true);
    // It could be "environment" or "device" depending on whether VITE_OPENROUTER_API_KEY is set in the test runner's environment
    expect(["device", "environment"]).toContain(status.source);
    
    expect(localStorage.getItem("vh:web:openrouter_api_key")).toBe("browser-test-key");
  });

  test("clears API key in browser mode", async () => {
    await storeApiKey("to-be-cleared");
    await clearStoredApiKey();
    const hasKey = await hasStoredApiKey();
    expect(hasKey).toBe(false);
    expect(localStorage.getItem("vh:web:openrouter_api_key")).toBeNull();
  });

  test("stores runtime config in the current web storage key", async () => {
    await save("runtime-api-config-v1", { apiUrl: "http://127.0.0.1:11434/v1/chat/completions", apiKeyFile: "" });

    expect(localStorage.getItem("vh:web:runtime-api-config-v1")).toBe(
      JSON.stringify({ apiUrl: "http://127.0.0.1:11434/v1/chat/completions", apiKeyFile: "" })
    );

    const loaded = await load("runtime-api-config-v1");
    expect(loaded).toEqual({ apiUrl: "http://127.0.0.1:11434/v1/chat/completions", apiKeyFile: "" });
  });

  test("factory reset clears scoped keys, default-scope duplicates, legacy keys, and web-only runtime data", async () => {
    localStorage.setItem("vh:web:styles-v3", JSON.stringify({ styles: { personal: { profile: { tone: "plain" } } } }));
    localStorage.setItem("vh:default:styles-v3", JSON.stringify({ styles: { personal: { profile: { tone: "plain" } } } }));
    localStorage.setItem("vh:web:custom-profiles-v1", JSON.stringify([{ id: "custom-1" }]));
    localStorage.setItem("vh:web:openrouter_api_key", "browser-test-key");
    localStorage.setItem("vh:web:runtime-api-config-v1", JSON.stringify({ apiUrl: "http://localhost:11434/v1/chat/completions", apiKeyFile: "secret.txt" }));
    localStorage.setItem("vh:web:request_logs", JSON.stringify([{ id: "req-1" }]));
    localStorage.setItem("styles-v3", JSON.stringify({ legacy: true }));
    localStorage.setItem("cliches-v3", JSON.stringify({ generatedTerms: ["delve"] }));
    localStorage.setItem("cliches-ts-v3", JSON.stringify("2026-03-31T12:00:00.000Z"));
    localStorage.setItem("runtime-api-config-v1", JSON.stringify({ apiUrl: "http://legacy" }));
    localStorage.setItem("selected-model-v1", JSON.stringify("legacy/model"));
    localStorage.setItem("feature-model-v1", JSON.stringify("legacy/feature"));

    await resetAppData({ apiUrl: "http://localhost:11434/v1/chat/completions", apiKeyFile: "secret.txt" });

    expect(localStorage.length).toBe(0);
  });
});

describe("storage tauri compatibility", () => {
  beforeEach(() => {
    vi.spyOn(tauri, "isTauriRuntime").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("uses tauriInvoke in desktop mode", async () => {
    const invoke = vi.spyOn(tauri, "tauriInvoke").mockResolvedValue({ ok: true });
    
    await storeApiKey("desktop-key");
    expect(invoke).toHaveBeenCalledWith("set_api_key", expect.objectContaining({ key: "desktop-key" }));
  });
});
