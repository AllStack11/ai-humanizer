import { isTauriRuntime, tauriInvoke } from './tauri.js';

const STORAGE_PREFIX = "vh";
let storageScopePromise = null;
const LEGACY_KEYS = [
  "styles-v3",
  "cliches-v3",
  "cliches-ts-v3",
  "writer-editor-draft-v1",
  "style-modal-draft-v1",
  "runtime-api-config-v1",
  "selected-model-v1",
  "custom-model-options-v1",
];

async function getStorageScope() {
  if (storageScopePromise) return storageScopePromise;
  storageScopePromise = (async () => {
    if (!isTauriRuntime()) return "web";
    try {
      const channel = await tauriInvoke("get_runtime_channel");
      if (channel === "debug" || channel === "release") return channel;
    } catch {}
    return "default";
  })();
  return storageScopePromise;
}

async function resolveStorageKey(key) {
  const scope = await getStorageScope();
  if (scope === "default") return key;
  return `${STORAGE_PREFIX}:${scope}:${key}`;
}

function normalizeRuntimeConfig(runtime = {}) {
  if (!runtime || typeof runtime !== "object") return {};
  const apiUrl = typeof runtime.apiUrl === "string" ? runtime.apiUrl.trim() : "";
  const apiKeyFile = typeof runtime.apiKeyFile === "string" ? runtime.apiKeyFile.trim() : "";
  return {
    ...(apiUrl ? { api_url: apiUrl } : {}),
    ...(apiKeyFile ? { api_key_file: apiKeyFile } : {}),
  };
}

export async function load(key) {
  try {
    const scoped = await resolveStorageKey(key);
    const r = localStorage.getItem(scoped);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}

export async function save(key, val) {
  try {
    const scoped = await resolveStorageKey(key);
    localStorage.setItem(scoped, JSON.stringify(val));
  } catch {}
}

export async function loadStylesBackup() {
  if (!isTauriRuntime()) return null;
  try {
    const data = await tauriInvoke("get_styles_backup");
    return data?.styles && typeof data.styles === "object" && !Array.isArray(data.styles) ? data.styles : null;
  } catch {
    return null;
  }
}

export async function saveStylesBackupRaw(stylesData) {
  if (!isTauriRuntime()) throw new Error("Desktop runtime required.");
  const data = await tauriInvoke("save_styles_backup", { styles: stylesData });
  return data;
}

export async function loadRequestLogs() {
  if (!isTauriRuntime()) return [];
  try {
    const data = await tauriInvoke("get_request_logs");
    return Array.isArray(data?.logs) ? data.logs : [];
  } catch {
    return [];
  }
}

export async function clearRequestLogs() {
  if (!isTauriRuntime()) return;
  try { await tauriInvoke("clear_request_logs"); } catch {}
}

export async function logDiagnosticEvent(route, request = {}, status = "info", extra = {}) {
  if (!isTauriRuntime()) return;
  try {
    await tauriInvoke("add_diagnostic_log", {
      payload: {
        route,
        status,
        model: "app",
        request,
        ...extra,
      },
    });
  } catch {}
}

export async function hasStoredApiKey(runtime) {
  if (!isTauriRuntime()) return true;
  return tauriInvoke("has_api_key", { runtime: normalizeRuntimeConfig(runtime) });
}

export async function getApiKeyStatus(runtime) {
  if (!isTauriRuntime()) return { hasKey: true, source: "web" };
  try {
    const status = await tauriInvoke("get_api_key_status", { runtime: normalizeRuntimeConfig(runtime) });
    if (status && typeof status.hasKey === "boolean" && typeof status.source === "string") {
      return status;
    }
  } catch {}
  const hasKey = await hasStoredApiKey(runtime);
  return { hasKey, source: hasKey ? "unknown" : "missing" };
}

export async function storeApiKey(key, runtime) {
  if (!isTauriRuntime()) return { ok: true };
  return tauriInvoke("set_api_key", { key, runtime: normalizeRuntimeConfig(runtime) });
}

export async function clearStoredApiKey(runtime) {
  if (!isTauriRuntime()) return { ok: true };
  return tauriInvoke("clear_api_key", { runtime: normalizeRuntimeConfig(runtime) });
}

export async function resetAppData(runtime) {
  try {
    const scope = await getStorageScope();
    const allKeys = Object.keys(localStorage);
    const scopedPrefix = `${STORAGE_PREFIX}:${scope}:`;
    for (const key of allKeys) {
      if (key.startsWith(`${STORAGE_PREFIX}:`) || key.startsWith(scopedPrefix)) {
        localStorage.removeItem(key);
      }
    }
    for (const key of LEGACY_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {}

  if (!isTauriRuntime()) return { ok: true };
  return tauriInvoke("clear_app_data", { runtime: normalizeRuntimeConfig(runtime) });
}
