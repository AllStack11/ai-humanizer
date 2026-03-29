import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { storeApiKey, hasStoredApiKey, clearStoredApiKey, getApiKeyStatus } from "./storage.js";
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
    await storeApiKey("browser-test-key");
    const hasKey = await hasStoredApiKey();
    expect(hasKey).toBe(true);
    
    const status = await getApiKeyStatus();
    expect(status.hasKey).toBe(true);
    expect(status.source).toBe("device");
    
    expect(localStorage.getItem("vh:web:openrouter_api_key")).toBe("browser-test-key");
  });

  test("clears API key in browser mode", async () => {
    await storeApiKey("to-be-cleared");
    await clearStoredApiKey();
    const hasKey = await hasStoredApiKey();
    expect(hasKey).toBe(false);
    expect(localStorage.getItem("vh:web:openrouter_api_key")).toBeNull();
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
