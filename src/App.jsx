import { useState, useEffect, useRef, useMemo } from "react";

// Constants
import {
  MODEL_OPTIONS, UTILITY_MODEL, CLICHE_PROMPT,
  TONE_LEVELS, ELAB_DEPTHS,
  WRITER_DRAFT_KEY, STYLE_MODAL_DRAFT_KEY, PRIMARY_PROFILE_ID, MODEL_PREF_KEY, CUSTOM_MODELS_KEY, CUSTOM_PROFILES_KEY,
  WRITING_SAMPLE_TYPES, DEFAULT_SAMPLE_TYPE, PROFILE_OPTIONS, DEFAULT_SLOTS,
  OUTPUT_PRESET_OPTIONS, APP_THEME_OPTIONS,
} from './constants/index.js';

// Lib
import { isTauriRuntime } from './lib/tauri.js';
import { llm, llmStream } from './lib/api.js';
import {
  load, save, loadStylesBackup, saveStylesBackupRaw,
  loadRequestLogs, clearRequestLogs,
  getApiKeyStatus, storeApiKey, clearStoredApiKey,
  logDiagnosticEvent, resetAppData,
} from './lib/storage.js';
import { STYLE_ANALYZE_SYS, STYLE_MERGE_SYS, HUMANIZE_SYS, ELABORATE_SYS, PARTIAL_REGEN_SYS, buildPartialRegenUserPrompt } from './lib/prompts.js';
import {
  dedupeSampleEntries,
  getErrorMessage,
  isMissingApiKeyError,
  parseJsonFromModelOutput,
} from "./features/app/helpers.js";
import {
  buildHumanizeUserPrompt,
  outputLooksLikeAnsweredPrompt,
} from "./features/humanize/promptGuards.js";
import { useProcessLog } from "./features/process/useProcessLog.js";
import { filterProfileForContext, describeProfileFilter } from "./lib/profileFilter.js";

// Utils
import {
  countWords,
  computeTextMetricSnapshot,
  computeWordCharDelta,
  buildClicheRanges,
  normalizeSampleSlot, normalizeStoredStyles, getFilledSlots, formatSampleForPrompt,
  collectCoverageGaps, computeProfileHealth, hasTrainedProfile, normalizeProfileMeta, computeTraitConfidence,
  getFormatPresetInstruction, formatRelativeTime,
} from './utils/index.js';

// Components
import Topbar from './components/Topbar.jsx';
import WriterPanel from './components/WriterPanel.jsx';
import OutputPanel from './components/OutputPanel.jsx';
import DiagnosticsPanel from './components/DiagnosticsPanel.jsx';
import StyleModal from './components/StyleModal.jsx';
import WritingProfileModal from './components/WritingProfileModal.jsx';
import ApiKeyModal from './components/ApiKeyModal.jsx';
import ManagementPanel from './components/ManagementPanel.jsx';
import ProcessLogPanel from './components/ProcessLogPanel.jsx';
import MergeProgressModal from './components/MergeProgressModal.jsx';
import AddModelModal from './components/AddModelModal.jsx';
import ResetConfirmModal from './components/ResetConfirmModal.jsx';
import { Drawer, Modal } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { Button, Input } from "./components/AppUI.jsx";

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const RUNTIME_API_CONFIG_KEY = "runtime-api-config-v1";
  const PROFILE_STEP_DELAY_MS = 650;

  async function ensureApiKeyReady(actionLabel) {
    pushProcessStep("Checking API key availability.");
    try {
      const keyStatus = await getApiKeyStatus(runtimeConfig);
      if (keyStatus?.hasKey) {
        pushProcessStep("API key is available.", "success", keyStatus.source || "configured");
        return true;
      }
      pushProcessStep("API key missing before request start.", "error", actionLabel);
      setProcessSummary("Request blocked: authentication required.");
      setProcessError(`OpenRouter API key is missing. Add it in settings before ${actionLabel}.`);
      setProcessNeedsApiKey(true);
      setApiKeyRequired(true);
      setApiKeyModalOpen(true);
      setError(`OpenRouter API key is missing. Add it in settings before ${actionLabel}.`);
      return false;
    } catch (error) {
      const message = getErrorMessage(error);
      pushProcessStep("Could not verify API key status.", "warning", message);
      return true;
    }
  }

  // Core
  const [styles, setStyles]                     = useState({});
  const [activeProfileId, setActiveProfileId]   = useState(PROFILE_OPTIONS[0].id);
  const [customProfiles, setCustomProfiles]     = useState([]);
  const [addProfileModalOpen, setAddProfileModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [newProfileName, setNewProfileName]     = useState("");
  const [cliches, setCliches]                   = useState([]);
  const [clichesUpdatedAt, setClichesUpdatedAt] = useState(null);
  const [clicheFetching, setClicheFetching]     = useState(false);

  // Writer state (unified)
  const [mode, setMode]             = useState("humanize");
  const [inputText, setInputText]   = useState("");
  const [outputText, setOutputText] = useState("");
  const [outputBaseline, setOutputBaseline] = useState("");
  const [outputCopied, setOutputCopied] = useState(false);
  const [isPartialStreaming, setIsPartialStreaming] = useState(false);
  const [partialRegenText, setPartialRegenText] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [outputPhase, setOutputPhase] = useState("idle");
  const [toneLevel, setToneLevel]   = useState(2);
  const [stripCliches, setStripCliches] = useState(true);
  const [elabDepth, setElabDepth]   = useState(2);
  const [oneOffInstruction, setOneOffInstruction] = useState("");
  const [formatPreset, setFormatPreset] = useState("none");
  const [themeKey, setThemeKey] = useState(APP_THEME_OPTIONS[0].value);
  const [modelOptions, setModelOptions] = useState(MODEL_OPTIONS);
  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0].value);
  const [addModelModalOpen, setAddModelModalOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [requestLogs, setRequestLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const inputTextRef = useRef(inputText);

  // Modals / dropdowns
  const [styleModalOpen, setStyleModalOpen]   = useState(false);
  const backupSyncReadyRef = useRef(false);

  // Backup status
  const [backupStatus, setBackupStatus]         = useState("idle");
  const [backupLastSavedAt, setBackupLastSavedAt] = useState(null);
  const [backupError, setBackupError]           = useState("");
  const [, forceTickRender]                     = useState(0);

  // Async feedback
  const [loading, setLoading] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [profileMergeLoading, setProfileMergeLoading] = useState(false);
  const [mergeProgressOpen, setMergeProgressOpen] = useState(false);
  const [mergeProgressValue, setMergeProgressValue] = useState(0);
  const [mergeProgressLabel, setMergeProgressLabel] = useState("");
  const [mergeProgressTitle, setMergeProgressTitle] = useState("Updating profile");
  const [mergeProgressSteps, setMergeProgressSteps] = useState([]);
  const mergeStepIdRef = useRef(0);
  const [status, setStatus]   = useState("");
  const [error, setError]     = useState("");
  const {
    processSteps,
    processSummary,
    processError,
    processNeedsApiKey,
    setProcessSummary,
    setProcessError,
    setProcessNeedsApiKey,
    pushProcessStep,
    startProcessLog,
    logRequestFailure,
    completeProcess,
    resetProcessLog,
  } = useProcessLog();
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyRequired, setApiKeyRequired] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySource, setApiKeySource] = useState("missing");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiUrlInput, setApiUrlInput] = useState("");
  const [apiKeyFileInput, setApiKeyFileInput] = useState("");
  const [runtimeConfig, setRuntimeConfig] = useState({ apiUrl: "", apiKeyFile: "" });
  const prefersReducedMotion = useReducedMotion();
  const isTestEnv = import.meta.env.MODE === "test";


  function readComposerTextFromDom() {
    if (typeof document === "undefined") return "";
    const textarea = document.querySelector("textarea.editor-textarea");
    if (textarea && typeof textarea.value === "string") return textarea.value;
    const tiptap = document.querySelector(".tiptap-editor");
    return tiptap?.textContent || "";
  }

  function resolveSourceText() {
    const stateText = String(inputTextRef.current || "");
    try {
      const domText = String(readComposerTextFromDom() || "");
      return domText.trim().length > stateText.trim().length ? domText : stateText;
    } catch {
      return stateText;
    }
  }

  function copyTextToClipboard(text, successMessage = "Copied.") {
    if (!String(text || "").trim()) return;
    if (!navigator?.clipboard?.writeText) {
      setError("Clipboard copy is not available in this runtime.");
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => {
        setStatus(successMessage);
        setTimeout(() => setStatus(""), 1600);
      })
      .catch(() => {
        setError("Failed to copy text.");
      });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clearMergeProgress() {
    setMergeProgressValue(0);
    setMergeProgressLabel("");
    setMergeProgressSteps([]);
  }

  async function pushMergeProgressStep(message, progressValue, { level = "info", detail = "", delay = true } = {}) {
    const timestamp = new Date().toISOString();
    mergeStepIdRef.current += 1;
    setMergeProgressLabel(message);
    if (typeof progressValue === "number") {
      const normalized = Math.max(0, Math.min(100, progressValue));
      setMergeProgressValue(normalized);
    }
    setMergeProgressSteps((prev) => [
      ...prev,
      {
        id: `merge-step-${mergeStepIdRef.current}`,
        message,
        detail,
        level,
        timestamp,
      },
    ]);
    if (delay) await sleep(PROFILE_STEP_DELAY_MS);
  }


  // Load persisted data
  useEffect(() => {
    (async () => {
      try {
        logDiagnosticEvent("app:init:start", {
          runtime: isTauriRuntime() ? "tauri" : "web",
          defaultActiveProfileId: PROFILE_OPTIONS[0].id,
          defaultTheme: APP_THEME_OPTIONS[0].value,
          defaultModel: MODEL_OPTIONS[0].value,
        }).catch(() => {});

        const [
          storedStyles, storedCustomProfiles, storedCliches, storedTs,
          storedWriterDraft, storedOutputHistory, storedRuntimeConfig,
          storedModel, storedCustomModels,
        ] = await Promise.all([
          load("styles-v3"),
          load(CUSTOM_PROFILES_KEY),
          load("cliches-v3"),
          load("cliches-ts-v3"),
          load(`${WRITER_DRAFT_KEY}:${PROFILE_OPTIONS[0].id}`),
          load(RUNTIME_API_CONFIG_KEY),
          load(MODEL_PREF_KEY),
          load(CUSTOM_MODELS_KEY),
        ]);
        if (Array.isArray(storedCustomProfiles)) setCustomProfiles(storedCustomProfiles);
        const resolvedRuntimeConfig = {
          apiUrl: typeof storedRuntimeConfig?.apiUrl === "string" ? storedRuntimeConfig.apiUrl.trim() : "",
          apiKeyFile: typeof storedRuntimeConfig?.apiKeyFile === "string" ? storedRuntimeConfig.apiKeyFile.trim() : "",
        };
        setRuntimeConfig(resolvedRuntimeConfig);
        setApiUrlInput(resolvedRuntimeConfig.apiUrl);
        setApiKeyFileInput(resolvedRuntimeConfig.apiKeyFile);
        let stylesSource = "localStorage";
        let resolvedStyles = storedStyles ? normalizeStoredStyles(storedStyles) : {};
        if (!Object.keys(resolvedStyles).length) {
          stylesSource = "backup";
          const backupStyles = await loadStylesBackup();
          if (backupStyles) {
            resolvedStyles = normalizeStoredStyles(backupStyles);
            if (Object.keys(resolvedStyles).length) await save("styles-v3", resolvedStyles);
          }
          if (!Object.keys(resolvedStyles).length) stylesSource = "empty";
        }

        setStyles(resolvedStyles);
        const trainedProfiles = Object.values(resolvedStyles).filter((profile) => hasTrainedProfile(profile));
        if (!trainedProfiles.length) {
          setStyleModalOpen(true);
        } else if (!resolvedStyles[activeProfileId]) {
          setActiveProfileId(trainedProfiles[0]?.id || PROFILE_OPTIONS[0].id);
        }

        logDiagnosticEvent("app:init:profiles_loaded", {
          source: stylesSource,
          activeProfileId,
          profileIds: Object.keys(resolvedStyles),
          profileCount: Object.keys(resolvedStyles).length,
          trainedProfileCount: trainedProfiles.length,
          untrainedProfileCount: Object.keys(resolvedStyles).length - trainedProfiles.length,
        }).catch(() => {});

        if (storedCliches) setCliches(storedCliches);
        if (storedTs)      setClichesUpdatedAt(new Date(storedTs));
        if (typeof storedWriterDraft === "string") setInputText(storedWriterDraft);
        const validCustomModels = Array.isArray(storedCustomModels)
          ? storedCustomModels
            .filter((item) => item && typeof item.value === "string" && item.value.trim())
            .map((item) => ({ value: item.value.trim(), label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : item.value.trim() }))
          : [];

        const mergedModelOptions = [...MODEL_OPTIONS];
        validCustomModels.forEach((custom) => {
          if (!mergedModelOptions.some((entry) => entry.value === custom.value)) {
            mergedModelOptions.push(custom);
          }
        });

        if (typeof storedModel === "string" && storedModel.trim() && !mergedModelOptions.some((item) => item.value === storedModel.trim())) {
          mergedModelOptions.push({ value: storedModel.trim(), label: `${storedModel.trim()} (custom)` });
        }

        setModelOptions(mergedModelOptions);
        if (typeof storedModel === "string" && storedModel.trim()) setSelectedModel(storedModel.trim());

        const stale = !storedTs || (Date.now() - new Date(storedTs)) > 3 * 86400000;
        if (stale) refreshCliches();

        let finalApiKeyPresent = false;
        let finalApiKeySource = "missing";
        try {
          const keyStatus = await getApiKeyStatus(resolvedRuntimeConfig);
          finalApiKeyPresent = !!keyStatus?.hasKey;
          finalApiKeySource = keyStatus?.source || "missing";
          setApiKeySource(finalApiKeySource);
          if (!finalApiKeyPresent) {
            setApiKeyRequired(true);
            setApiKeyModalOpen(true);
          }
        } catch {}

        logDiagnosticEvent("app:init:config_loaded", {
          selectedModel: (typeof storedModel === "string" && storedModel.trim()) ? storedModel : MODEL_OPTIONS[0].value,
          clichesLoaded: Array.isArray(storedCliches) ? storedCliches.length : 0,
          clichesUpdatedAt: storedTs || null,
          writerDraftChars: typeof storedWriterDraft === "string" ? storedWriterDraft.length : 0,
          apiKeyPresent: finalApiKeyPresent,
          apiKeySource: finalApiKeySource,
          clichesRefreshTriggered: stale,
        }).catch(() => {});
      } catch (error) {
        logDiagnosticEvent("app:init:failed", {}, "failed", {
          error: getErrorMessage(error),
        }).catch(() => {});
        setError(`Initialization failed: ${getErrorMessage(error)}`);
      } finally {
        backupSyncReadyRef.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!styles || typeof styles !== "object") return;
    const ids = Object.keys(styles);
    if (!ids.length) return;
    logDiagnosticEvent("app:profile:active_changed", {
      activeProfileId,
      availableProfileIds: ids,
      hasActiveProfileData: !!styles[activeProfileId],
    }).catch(() => {});
  }, [activeProfileId, styles]);

  const outputPanelRef = useRef(null);

  useEffect(() => {
    if (outputPhase !== "streaming") return;
    const node = outputPanelRef.current;
    if (!node || typeof node.scrollIntoView !== "function") return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [outputPhase]);

  async function saveStylesBackupWithRetry(stylesData) {
    const DELAYS = [1000, 2000, 4000];
    setBackupStatus("saving");
    setBackupError("");
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        setBackupStatus("retrying");
        await new Promise(r => setTimeout(r, DELAYS[attempt - 1]));
      }
      try {
        await saveStylesBackupRaw(stylesData);
        setBackupStatus("ok");
        setBackupLastSavedAt(new Date());
        setBackupError("");
        return;
      } catch (err) {
        if (attempt === 2) {
          setBackupStatus("error");
          setBackupError(getErrorMessage(err, "Backup failed"));
        }
      }
    }
  }

  useEffect(() => {
    if (!backupSyncReadyRef.current) return;
    save("styles-v3", styles);
    saveStylesBackupWithRetry(styles);
  }, [styles]);
  useEffect(() => {
    if (!backupSyncReadyRef.current) return;
    save(CUSTOM_PROFILES_KEY, customProfiles);
  }, [customProfiles]);
  useEffect(() => { save(RUNTIME_API_CONFIG_KEY, runtimeConfig); }, [runtimeConfig]);

  useEffect(() => {
    if (backupStatus !== "ok") return;
    const id = setInterval(() => forceTickRender(n => n + 1), 30000);
    return () => clearInterval(id);
  }, [backupStatus, backupLastSavedAt]);
  useEffect(() => { save(MODEL_PREF_KEY, selectedModel); }, [selectedModel]);
  useEffect(() => {
    const customOnly = modelOptions.filter((entry) => !MODEL_OPTIONS.some((base) => base.value === entry.value));
    save(CUSTOM_MODELS_KEY, customOnly);
  }, [modelOptions]);
  useEffect(() => { save(`${WRITER_DRAFT_KEY}:${activeProfileId}`, inputText); }, [inputText]);
  useEffect(() => {
    if (!backupSyncReadyRef.current) return;
    load(`${WRITER_DRAFT_KEY}:${activeProfileId}`).then(draft => {
      setInputText(typeof draft === "string" ? draft : "");
    });
  }, [activeProfileId]);

  function addCustomModelFromDropdown() {
    setAddModelModalOpen(true);
  }

  function handleRemoveModel(value) {
    const next = modelOptions.filter((m) => m.value !== value);
    if (next.length === 0) return; // never remove the last model
    setModelOptions(next);
    if (selectedModel === value) setSelectedModel(next[0].value);
  }

  function handleAddModel({ value, label }) {
    if (modelOptions.some((entry) => entry.value === value)) {
      setSelectedModel(value);
      setStatus("Model already exists. Switched to it.");
      setTimeout(() => setStatus(""), 1200);
    } else {
      setModelOptions((prev) => [...prev, { value, label }]);
      setSelectedModel(value);
      setStatus("Custom model added.");
      setTimeout(() => setStatus(""), 1200);
    }
    setAddModelModalOpen(false);
  }

  useEffect(() => {
    if (!logsOpen) return;
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      if (cancelled) return;
      setLogsLoading(true);
      try {
        const logs = await loadRequestLogs();
        if (!cancelled) {
          setRequestLogs(logs);
        }
      } catch {} finally {
        if (!cancelled) {
          setLogsLoading(false);
        }
      }
      if (!cancelled) timer = setTimeout(tick, 2500);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [logsOpen]);

  // ── Profile export / import ──
  function exportProfile() {
    const blob = new Blob(
      [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), styles }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: "writing-profile-backup.json" });
    a.click();
    URL.revokeObjectURL(url);
  }

  function importProfile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        const rawStyles = parsed?.styles || parsed;
        const normalized = normalizeStoredStyles(rawStyles);
        if (!Object.keys(normalized).length) { setError("Import failed: no valid profile found."); return; }
        setStyles(normalized);
      } catch { setError("Import failed: invalid JSON file."); }
    };
    reader.readAsText(file);
  }

  async function resetActiveProfile() {
    const existingRecord = styles[activeProfileId];
    const existing = hasTrainedProfile(existingRecord) ? existingRecord : null;
    const profileName = resolveProfileName(activeProfileId);
    if (!existing) {
      setError("No saved profile to reset.");
      return;
    }

    const sampleCount = Array.isArray(existing.sampleEntries) ? existing.sampleEntries.length : 0;
    const confirmStep1 = window.confirm(
      `Reset ${profileName} profile? This deletes ${sampleCount} saved sample${sampleCount === 1 ? "" : "s"} and voice settings.`
    );
    if (!confirmStep1) return;

    const confirmStep2 = window.confirm("Are you absolutely sure? This cannot be undone.");
    if (!confirmStep2) return;

    const confirmStep3 = window.confirm("Final check: continue and permanently delete this profile?");
    if (!confirmStep3) return;

    const expectedPhrase = `RESET ${profileName.toUpperCase()}`;
    const typed = window.prompt(`Type "${expectedPhrase}" to confirm deletion.`, "");
    if ((typed || "").trim().toUpperCase() !== expectedPhrase) {
      setStatus("Profile reset cancelled.");
      setTimeout(() => setStatus(""), 1400);
      return;
    }

    await save(`${STYLE_MODAL_DRAFT_KEY}:${activeProfileId}`, null);
    await save(`${WRITER_DRAFT_KEY}:${activeProfileId}`, null);

    const nextStyles = {
      ...styles,
      [activeProfileId]: {
        id: activeProfileId,
        name: profileName,
        profile: null,
        sampleEntries: [],
        samples: [],
        sampleCount: 0,
        createdAt: styles[activeProfileId]?.createdAt || new Date().toISOString(),
      },
    };
    setStyles(nextStyles);
    await save("styles-v3", nextStyles);
    await saveStylesBackupWithRetry(nextStyles);

    clearOutputState();
    setStyleModalOpen(false);
    setStatus(`${profileName} profile reset to 0 samples.`);
    setTimeout(() => setStatus(""), 1500);

    logDiagnosticEvent("profile:reset", {
      profileId: activeProfileId,
      profileName,
      sampleCount,
    }).catch(() => {});
  }

  function resolveProfileName(profileId) {
    return (
      PROFILE_OPTIONS.find((p) => p.id === profileId)?.label ||
      customProfiles.find((p) => p.id === profileId)?.label ||
      styles[profileId]?.name ||
      "Selected"
    );
  }

  async function handleUpdateProfileMeta(profileId, metaUpdate) {
    const existing = styles[profileId];
    const updatedStyles = {
      ...styles,
      [profileId]: {
        ...(existing || {}),
        meta: { ...normalizeProfileMeta(existing?.meta), ...metaUpdate },
        updatedAt: new Date().toISOString(),
      },
    };
    setStyles(updatedStyles);
    await save("styles-v3", updatedStyles);
    if (backupSyncReadyRef.current) await saveStylesBackupWithRetry(updatedStyles);
  }

  async function handleUpdateProfileTrait(profileId, traitUpdate) {
    const existing = styles[profileId];
    if (!existing) return;
    const updatedStyles = {
      ...styles,
      [profileId]: {
        ...existing,
        profile: { ...(existing.profile || {}), ...traitUpdate },
        updatedAt: new Date().toISOString(),
      },
    };
    setStyles(updatedStyles);
    await save("styles-v3", updatedStyles);
    if (backupSyncReadyRef.current) await saveStylesBackupWithRetry(updatedStyles);
  }

  function handleAddProfile() {
    setNewProfileName("");
    setAddProfileModalOpen(true);
  }

  async function confirmAddProfile() {
    const name = newProfileName.trim();
    if (!name) return;
    // Slug-based ID with collision avoidance
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom";
    const existingIds = new Set([
      ...PROFILE_OPTIONS.map((p) => p.id),
      ...customProfiles.map((p) => p.id),
    ]);
    let id = base;
    let n = 2;
    while (existingIds.has(id)) { id = `${base}-${n++}`; }
    const nextCustomProfiles = [...customProfiles, { id, label: name }];
    setCustomProfiles(nextCustomProfiles);
    await save(CUSTOM_PROFILES_KEY, nextCustomProfiles);
    setActiveProfileId(id);
    setAddProfileModalOpen(false);
    setNewProfileName("");
    setStyleModalOpen(true);
  }

  async function handleDeleteCustomProfile() {
    const profileName = resolveProfileName(activeProfileId);
    const confirmed = window.confirm(`Delete the "${profileName}" profile? This cannot be undone.`);
    if (!confirmed) return;

    const nextCustomProfiles = customProfiles.filter((p) => p.id !== activeProfileId);
    const nextStyles = { ...styles };
    delete nextStyles[activeProfileId];

    await save(`${WRITER_DRAFT_KEY}:${activeProfileId}`, null);
    await save(`${STYLE_MODAL_DRAFT_KEY}:${activeProfileId}`, null);
    setCustomProfiles(nextCustomProfiles);
    setStyles(nextStyles);
    await save("styles-v3", nextStyles);
    await saveStylesBackupWithRetry(nextStyles);

    const fallbackId = nextCustomProfiles[0]?.id || PROFILE_OPTIONS[0].id;
    setActiveProfileId(fallbackId);
    clearOutputState();
    setStatus(`"${profileName}" profile deleted.`);
    setTimeout(() => setStatus(""), 1500);
  }

  async function saveApiKey() {
    const key = apiKeyInput.trim();
    if (!key) {
      setError("Enter your OpenRouter API key.");
      return;
    }
    setApiKeySaving(true);
    setError("");
    try {
      await storeApiKey(key, runtimeConfig);
      setApiKeyRequired(false);
      setApiKeyModalOpen(false);
      setApiKeyInput("");
      setStatus("API key saved.");
      setTimeout(() => setStatus(""), 1200);

      // Best-effort verification after UI close; avoid blocking save UX on
      // keychain backends that report state with a delay.
      getApiKeyStatus(runtimeConfig)
        .then((status) => {
          if (!status?.hasKey) {
            setError("API key may not have persisted in local secret storage. You can retry save from settings.");
          }
        })
        .catch(() => {});
    } catch (e) {
      setError("Failed to save API key: " + getErrorMessage(e));
    } finally {
      setApiKeySaving(false);
    }
  }

  async function removeApiKey() {
    setApiKeySaving(true);
    setError("");
    try {
      await clearStoredApiKey(runtimeConfig);
      setApiKeyRequired(true);
      setApiKeyModalOpen(true);
      setStatus("API key removed.");
      setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      setError("Failed to clear API key: " + getErrorMessage(e));
    } finally {
      setApiKeySaving(false);
    }
  }

  async function fullAppDataReset() {
    setLoading(true);
    setError("");
    try {
      await resetAppData(runtimeConfig);

      setStyles({});
      setActiveProfileId(PROFILE_OPTIONS[0].id);
      setCliches([]);
      setClichesUpdatedAt(null);
      setClicheFetching(false);
      setMode("humanize");
      setInputText("");
      clearOutputState();
      setToneLevel(2);
      setStripCliches(true);
      setElabDepth(2);
      setOneOffInstruction("");
      setFormatPreset("none");
      setThemeKey(APP_THEME_OPTIONS[0].value);
      setModelOptions(MODEL_OPTIONS);
      setSelectedModel(MODEL_OPTIONS[0].value);
      setLogsOpen(false);
      setRequestLogs([]);
      setLogsLoading(false);
      setManagementOpen(false);
      setStyleModalOpen(true);
      setBackupStatus("idle");
      setBackupLastSavedAt(null);
      setBackupError("");
      resetProcessLog();
      setStatus("All app data reset.");
      setApiKeyInput("");
      setApiUrlInput("");
      setApiKeyFileInput("");
      setRuntimeConfig({ apiUrl: "", apiKeyFile: "" });
      setApiKeyRequired(true);
      setApiKeyModalOpen(true);
    } catch (e) {
      setError("Full reset failed: " + getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Clichés ──
  async function refreshCliches() {
    setClicheFetching(true);
    try {
      const raw = await llm("", CLICHE_PROMPT, 1400, UTILITY_MODEL, runtimeConfig);
      const fresh = JSON.parse(raw.replace(/```json|```/g,"").trim());
      if (Array.isArray(fresh) && fresh.length > 20) {
        const merged = [...new Set(fresh)];
        setCliches(merged); const now = new Date(); setClichesUpdatedAt(now);
        await save("cliches-v3", merged); await save("cliches-ts-v3", now.toISOString());
      }
    } catch (e) {
      const message = getErrorMessage(e);
      if (isMissingApiKeyError(message)) {
        setApiKeyRequired(true);
        setApiKeyModalOpen(true);
      }
    }
    setClicheFetching(false);
  }

  // ── Profile onboarding / evolution ──
  async function trainProfile(slots) {
    const filled = getFilledSlots(slots);
    if (!filled.length) { setError("Add writing samples (50+ chars each)."); return false; }

    const existing = styles[activeProfileId];
    const profileName = resolveProfileName(activeProfileId);
    setError("");
    setMergeProgressTitle(existing ? `Merging ${profileName} profile` : `Analyzing ${profileName} profile`);
    clearMergeProgress();
    setMergeProgressOpen(true);
    setProfileMergeLoading(true);
    setLoading(true);
    setStatus(existing ? `Merging new samples into ${profileName} profile…` : `Analyzing ${profileName} profile…`);
    startProcessLog(existing ? `Starting ${profileName} profile merge.` : `Starting ${profileName} profile analysis.`, `${filled.length} writing sample${filled.length === 1 ? "" : "s"} queued`);

    try {
      await pushMergeProgressStep("Queued writing samples for profile processing.", 8, { delay: false });
      await pushMergeProgressStep("Formatting writing samples for profile analysis.", 20);
      pushProcessStep("Formatting writing samples for analysis.");
      const formatted = filled.map((sample, i) => formatSampleForPrompt(sample, i)).join("\n\n");
      const baseUserPrompt = existing
        ? `Existing profile:\n${JSON.stringify(existing.profile || {})}\n\nNew samples:\n${formatted}`
        : `Analyze:\n\n${formatted}`;
      const baseSystemPrompt = existing ? STYLE_MERGE_SYS : STYLE_ANALYZE_SYS;
      await pushMergeProgressStep("Building model prompt with current profile context.", 34);
      const attempts = [
        {
          maxTokens: existing ? 3200 : 2400,
          userPrompt: baseUserPrompt,
          systemPrompt: baseSystemPrompt,
        },
        {
          maxTokens: existing ? 4800 : 3200,
          userPrompt: `${baseUserPrompt}\n\nReturn ONLY a valid JSON object with all braces/quotes closed. No markdown. No prose.`,
          systemPrompt: `${baseSystemPrompt}\nOutput must be a single valid JSON object with no text before or after it.`,
        },
      ];

      let profile = null;
      let lastParseError = null;
      for (let attempt = 0; attempt < attempts.length; attempt += 1) {
        const plan = attempts[attempt];
        const attemptLabel = `Attempt ${attempt + 1}/${attempts.length} via ${selectedModel}`;
        await pushMergeProgressStep("Sending merge request to model.", 45 + (attempt * 16), { detail: attemptLabel });
        pushProcessStep("Sending profile request to model.", "info", `Attempt ${attempt + 1} via ${selectedModel}`);
        const trainingOptions = attempt === 0 ? { response_format: { type: "json_object" } } : {};
        const raw = await llm(plan.systemPrompt, plan.userPrompt, plan.maxTokens, selectedModel, runtimeConfig, trainingOptions);
        await pushMergeProgressStep("Received model response. Validating profile JSON.", 58 + (attempt * 16), { detail: attemptLabel });
        try {
          profile = parseJsonFromModelOutput(raw);
          await pushMergeProgressStep("Profile JSON parsed successfully.", 74, { level: "success" });
          pushProcessStep("Profile response parsed successfully.", "success");
          break;
        } catch (parseErr) {
          lastParseError = parseErr;
          await pushMergeProgressStep("Response parse failed. Preparing retry with stricter JSON constraints.", 64 + (attempt * 10), {
            level: "warning",
            detail: attemptLabel,
          });
          pushProcessStep("Model response was not valid profile JSON.", "warning", `Attempt ${attempt + 1} failed parsing`);
          logDiagnosticEvent(
            "profile:train:json_parse_failed",
            {
              attempt: attempt + 1,
              mode: existing ? "merge" : "analyze",
              model: selectedModel,
              maxTokens: plan.maxTokens,
              responseChars: String(raw || "").length,
              responseTail: String(raw || "").slice(-180),
            },
            "failed",
            { error: getErrorMessage(parseErr) }
          ).catch(() => {});
        }
      }

      if (!profile) {
        throw (lastParseError || new Error("Failed to parse profile JSON from model response."));
      }

      await pushMergeProgressStep("Applying merged profile and sample dedupe rules.", 86);
      setStyles(prev => {
        const existingProfile = prev[activeProfileId];
        const existingSamples = existingProfile
          ? (Array.isArray(existingProfile.sampleEntries)
              ? existingProfile.sampleEntries.map((sample, i) => normalizeSampleSlot(sample, i + 1))
              : (Array.isArray(existingProfile.samples) ? existingProfile.samples : []).map((text, i) => normalizeSampleSlot({ id: i + 1, text }, i + 1)))
          : [];
        const sampleEntries = dedupeSampleEntries([...existingSamples, ...filled]);
        const createdAt = existingProfile?.createdAt || new Date().toISOString();

        return {
          ...prev,
          [activeProfileId]: {
            id: activeProfileId,
            name: profileName,
            profile,
            sampleEntries,
            samples: sampleEntries.map(sample => sample.text),
            sampleCount: sampleEntries.length,
            createdAt,
            updatedAt: new Date().toISOString(),
            meta: normalizeProfileMeta(existingProfile?.meta),
          }
        };
      });

      await pushMergeProgressStep(existing ? "Finalizing merged profile." : "Finalizing new profile.", 96);
      setStatus(existing ? "Profile updated!" : "Profile created!");
      await pushMergeProgressStep(existing ? "Profile merge complete." : "Profile analysis complete.", 100, { level: "success" });
      pushProcessStep(existing ? "Profile merge complete." : "Profile analysis complete.", "success");
      completeProcess(existing ? "Profile updated successfully." : "Profile created successfully.");
      setTimeout(() => {
        setStatus("");
        setStyleModalOpen(false);
        setMergeProgressOpen(false);
        clearMergeProgress();
      }, 1100);
      return true;
    } catch (e) {
      const message = getErrorMessage(e);
      await pushMergeProgressStep("Profile merge failed.", 100, { level: "error", detail: message, delay: false });
      if (isMissingApiKeyError(message)) {
        pushProcessStep("OpenRouter API key missing. Opening API key dialog.", "error");
        setApiKeyRequired(true);
        setApiKeyModalOpen(true);
      }
      logRequestFailure("Profile training failed.", message);
      setError("Failed: " + message);
      setTimeout(() => {
        setMergeProgressOpen(false);
        clearMergeProgress();
      }, 1200);
      return false;
    } finally {
      setProfileMergeLoading(false);
      setLoading(false);
    }
  }

  function computeMaxTokens(sourceText, requestMode, depth) {
    const words = countWords(sourceText);
    if (requestMode === "elaborate") {
      // Elaborate output is bounded by ELAB_DEPTHS sentence counts; map depth to token ceiling
      const TOKEN_BY_DEPTH = [80, 150, 280, 460, 700];
      return TOKEN_BY_DEPTH[depth] ?? 280;
    }
    if (requestMode === "partial") {
      return Math.min(1200, Math.max(150, Math.round(words * 2.5)));
    }
    // humanize: ~1.2x expansion + 50% safety buffer
    return Math.min(2400, Math.max(300, Math.round(words * 1.8)));
  }

  // Temperature by tone level: Very Casual (1.1) → Formal (0.6)
  // Higher tone = lower temp for measured output; lower tone = higher temp for natural variation
  const TEMP_BY_TONE = [1.1, 1.0, 0.9, 0.75, 0.6];

  function applyPromptDecorators(systemPrompt) {
    const presetInstruction = getFormatPresetInstruction(formatPreset);
    const extras = [presetInstruction, oneOffInstruction.trim()].filter(Boolean);
    if (!extras.length) return systemPrompt;
    return `${systemPrompt}\n\nExtra constraints:\n- ${extras.join("\n- ")}`;
  }

  function clearOutputState() {
    setOutputText("");
    setOutputBaseline("");
    setOutputCopied(false);
    setShowDiff(true);
    setOutputPhase("idle");
  }

  function startOutputStream() {
    setOutputText("");
    setOutputBaseline("");
    setOutputCopied(false);
    setShowDiff(true);
    setOutputPhase("streaming");
  }

  function commitOutput(nextOutput) {
    const normalized = String(nextOutput || "");
    setOutputText(normalized);
    setOutputBaseline(normalized);
    setOutputCopied(false);
    setShowDiff(true);
    setOutputPhase("ready");
  }

  function handleOutputChange(nextOutput) {
    setOutputText(nextOutput);
    setOutputCopied(false);
  }

  function copyOutput() {
    if (!outputText.trim()) return;
    copyTextToClipboard(outputText, "Output copied.");
    setOutputCopied(true);
    setTimeout(() => setOutputCopied(false), 1600);
  }

  function regenerateOutput() {
    if (loading) return;
    if (mode === "humanize") {
      humanize();
      return;
    }
    elaborate();
  }

  function regenerateOutputWithFeedback(feedback) {
    if (loading) return;
    const trimmedFeedback = String(feedback || "").trim();
    if (!trimmedFeedback) {
      regenerateOutput();
      return;
    }
    if (mode === "humanize") {
      humanize({ regenerateFeedback: trimmedFeedback });
      return;
    }
    elaborate({ regenerateFeedback: trimmedFeedback });
  }

  async function regeneratePartial(selectedText, rawStart, rawEnd) {
    if (isPartialStreaming || loading) return;
    if (!selectedText?.trim() || rawStart < 0 || rawEnd <= rawStart) return;
    const activeProfile = styles[activeProfileId];
    if (!activeProfile) { setError("Onboard your writing profile first."); return; }
    if (!(await ensureApiKeyReady("regenerating selection"))) return;

    setIsPartialStreaming(true);
    setPartialRegenText(selectedText);
    // Snapshot before/after slices before any async state changes
    const snapBefore = outputText.slice(0, rawStart);
    const snapAfter = outputText.slice(rawEnd);
    try {
      const confidence = activeProfileConfidence;
      const filteredProfile = filterProfileForContext(
        activeProfile.profile, { toneLevel, formatPreset, mode, confidence }
      );
      const systemPrompt = PARTIAL_REGEN_SYS(
        filteredProfile, toneLevel, stripCliches ? cliches : [],
        activeProfile.name, activeProfile.meta
      );
      const result = await llmStream(
        systemPrompt,
        buildPartialRegenUserPrompt(outputText, selectedText),
        (_, full) => setOutputText(snapBefore + full + snapAfter),
        computeMaxTokens(selectedText, "partial"),
        selectedModel,
        runtimeConfig,
        { temperature: 0.7 }
      );
      if (!result?.trim()) throw new Error("The model returned an empty replacement.");
      setOutputText(snapBefore + result.trim() + snapAfter);
    } catch (e) {
      setError("Partial regen failed: " + getErrorMessage(e));
      setTimeout(() => setError(""), 4000);
    } finally {
      setIsPartialStreaming(false);
      setPartialRegenText("");
    }
  }

  // ── Humanize ──
  async function humanize({ regenerateFeedback = "" } = {}) {
    const sourceText = resolveSourceText();
    const activeProfile = styles[activeProfileId];
    if (!activeProfile) { setError("Onboard your writing profile first."); return; }
    if (sourceText.trim().length < 20) { setError("Paste some text to humanize (20+ chars)."); return; }
    setError(""); setLoading(true); setRequestLoading(true); setStatus("Rewriting in your voice…");
    startProcessLog("Starting rewrite request.", `Mode: humanize via ${selectedModel}`);
    try {
      pushProcessStep("Validating profile and source text.");
      if (!(await ensureApiKeyReady("rewriting text"))) return;
      const confidence = activeProfileConfidence;
      const filteredProfile = filterProfileForContext(activeProfile.profile, { toneLevel, formatPreset, mode, confidence });
      const { message: filterMsg, detail: filterDetail } = describeProfileFilter(activeProfile.profile, filteredProfile);
      pushProcessStep(filterMsg, "info", filterDetail);
      const basePrompt = applyPromptDecorators(
        HUMANIZE_SYS(filteredProfile, toneLevel, stripCliches ? cliches : [], activeProfile.name, activeProfile.meta)
      );
      const feedbackPrompt = regenerateFeedback.trim()
        ? `Regeneration feedback:\n- ${regenerateFeedback.trim()}\n- Keep the same source intent while applying this feedback.`
        : "";
      const baseSystemPrompt = [basePrompt, feedbackPrompt].filter(Boolean).join("\n\n");
      const humanizeOptions = { temperature: TEMP_BY_TONE[toneLevel] ?? 0.9, frequency_penalty: 0.15 };
      const streamRewrite = async (systemPrompt, userPrompt, firstChunkMessage) => {
        startOutputStream();
        let loggedFirstChunk = false;
        return llmStream(
          systemPrompt,
          userPrompt,
          (_, full) => {
            if (!loggedFirstChunk) {
              loggedFirstChunk = true;
              pushProcessStep(firstChunkMessage, "info");
            }
            setOutputText(full);
            setOutputBaseline(full);
          },
          computeMaxTokens(sourceText, "humanize"),
          selectedModel,
          runtimeConfig,
          humanizeOptions
        );
      };

      pushProcessStep("Preparing prompt and opening model stream.");
      let out = await streamRewrite(
        baseSystemPrompt,
        buildHumanizeUserPrompt(sourceText),
        "Model stream connected. Receiving rewrite output."
      );
      if (outputLooksLikeAnsweredPrompt(sourceText, out)) {
        pushProcessStep("Draft looked like a reply instead of a rewrite. Retrying with stricter guardrails.", "info");
        out = await streamRewrite(
          `${baseSystemPrompt}\n\nCritical constraint:\n- Rewrite the source text itself and never answer it as though you are in a live conversation.`,
          buildHumanizeUserPrompt(sourceText, { strict: true }),
          "Retry stream connected. Receiving guarded rewrite output."
        );
      }
      if (!out.trim()) {
        pushProcessStep("Model stream ended with no output.", "error");
        const keyStatus = await getApiKeyStatus(runtimeConfig).catch(() => ({ hasKey: true }));
        if (keyStatus && !keyStatus.hasKey) {
          pushProcessStep("API key appears to be missing after empty response. Opening API key dialog.", "error");
          setApiKeyRequired(true);
          setApiKeyModalOpen(true);
          throw new Error("OpenRouter API key is missing.");
        }
        throw new Error("The model returned an empty response.");
      }
      commitOutput(out);
      pushProcessStep("Rewrite completed successfully.", "success", `${countWords(out)} words generated`);
      completeProcess("Rewrite completed successfully.");
      setStatus("");
    } catch (e) {
      const message = getErrorMessage(e);
      if (isMissingApiKeyError(message)) {
        pushProcessStep("OpenRouter API key missing. Opening API key dialog.", "error");
        setApiKeyRequired(true);
        setApiKeyModalOpen(true);
      }
      clearOutputState();
      logRequestFailure("Rewrite request failed.", message);
      setError("Failed: " + message);
    }
    finally { setRequestLoading(false); setLoading(false); }
  }

  // ── Elaborate ──
  async function elaborate({ regenerateFeedback = "" } = {}) {
    const sourceText = resolveSourceText();
    const activeProfile = styles[activeProfileId];
    if (!activeProfile) { setError("Onboard your writing profile first."); return; }
    if (sourceText.trim().length < 10) { setError("Write something to elaborate on."); return; }
    setError(""); setLoading(true); setRequestLoading(true); setStatus("Expanding your writing…");
    startProcessLog("Starting expansion request.", `Mode: elaborate via ${selectedModel}`);
    try {
      pushProcessStep("Validating profile and source text.");
      if (!(await ensureApiKeyReady("expanding text"))) return;
      const confidence = activeProfileConfidence;
      const filteredProfile = filterProfileForContext(activeProfile.profile, { toneLevel, formatPreset, mode, confidence });
      const { message: filterMsg, detail: filterDetail = "" } = describeProfileFilter(activeProfile.profile, filteredProfile);
      pushProcessStep(filterMsg, "info", filterDetail);
      startOutputStream();
      pushProcessStep("Preparing prompt and opening model stream.");
      let loggedFirstChunk = false;
      const basePrompt = applyPromptDecorators(ELABORATE_SYS(filteredProfile, toneLevel, elabDepth, activeProfile.name, activeProfile.meta));
      const feedbackPrompt = regenerateFeedback.trim()
        ? `Regeneration feedback:\n- ${regenerateFeedback.trim()}\n- Keep the same source intent while applying this feedback.`
        : "";
      const out = await llmStream(
        [basePrompt, feedbackPrompt].filter(Boolean).join("\n\n"),
        `Elaborate on:\n\n${sourceText}`,
        (_, full) => {
          if (!loggedFirstChunk) {
            loggedFirstChunk = true;
            pushProcessStep("Model stream connected. Receiving expanded draft.", "info");
          }
          setOutputText(full);
          setOutputBaseline(full);
        },
        computeMaxTokens(sourceText, "elaborate", elabDepth),
        selectedModel,
        runtimeConfig,
        { temperature: TEMP_BY_TONE[toneLevel] ?? 0.9, frequency_penalty: 0.15 }
      );
      if (!out.trim()) {
        pushProcessStep("Model stream ended with no output.", "error");
        const keyStatus = await getApiKeyStatus(runtimeConfig).catch(() => ({ hasKey: true }));
        if (keyStatus && !keyStatus.hasKey) {
          pushProcessStep("API key appears to be missing after empty response. Opening API key dialog.", "error");
          setApiKeyRequired(true);
          setApiKeyModalOpen(true);
          throw new Error("OpenRouter API key is missing.");
        }
        throw new Error("The model returned an empty response.");
      }
      commitOutput(out);
      pushProcessStep("Expansion completed successfully.", "success", `${countWords(out)} words generated`);
      completeProcess("Expansion completed successfully.");
      setStatus("");
    } catch (e) {
      const message = getErrorMessage(e);
      if (isMissingApiKeyError(message)) {
        pushProcessStep("OpenRouter API key missing. Opening API key dialog.", "error");
        setApiKeyRequired(true);
        setApiKeyModalOpen(true);
      }
      clearOutputState();
      logRequestFailure("Expansion request failed.", message);
      setError("Failed: " + message);
    }
    finally { setRequestLoading(false); setLoading(false); }
  }


  const activeProfile = styles[activeProfileId] || null;
  const hasProfile = hasTrainedProfile(activeProfile);
  const health = computeProfileHealth(activeProfile);
  const activeProfileConfidence = useMemo(() => computeTraitConfidence(activeProfile), [activeProfile]);
  const words = countWords(inputText);

  const handleInputChange = (val) => {
    inputTextRef.current = val;
    setInputText(val);
  };

  const handleNewChat = () => {
    inputTextRef.current = "";
    setInputText("");
    clearOutputState();
  };

  const handleModeChange = (m) => {
    if (m === mode) return;
    setMode(m);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey && event.key === "Enter") {
        event.preventDefault();
        // Let pending editor state updates settle before reading inputText.
        window.setTimeout(() => {
          if (mode === "humanize") humanize();
          else elaborate();
        }, 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, inputText, styles, activeProfileId, toneLevel, stripCliches, cliches, selectedModel, elabDepth, oneOffInstruction, formatPreset, runtimeConfig]);

  const hasCompletedOutput = outputPhase === "ready" && outputText.trim().length > 0;
  const isStreamingOutput = outputPhase === "streaming";
  const shouldShowOutputPanel = isStreamingOutput || hasCompletedOutput;
  const outputEdited = hasCompletedOutput && outputText !== outputBaseline;
  const metricSnapshotBefore = computeTextMetricSnapshot(inputText);
  const metricSnapshotAfter = computeTextMetricSnapshot(outputText);
  const readabilityBefore = metricSnapshotBefore.readability;
  const readabilityAfter = metricSnapshotAfter.readability;
  const outputDelta = computeWordCharDelta(inputText, outputText);
  const activeTheme = APP_THEME_OPTIONS.find((theme) => theme.value === themeKey) || APP_THEME_OPTIONS[0];
  const requestProgressLabel = status || processSummary || (mode === "humanize" ? "Rewriting in your voice..." : "Expanding your writing...");
  const requestProgressTone = processError ? "error" : processNeedsApiKey ? "warning" : "neutral";
  const drawerTransitionProps = useMemo(() => ({
    transition: "slide-left",
    duration: prefersReducedMotion || isTestEnv ? 0 : 600,
    timingFunction: prefersReducedMotion || isTestEnv ? "linear" : "cubic-bezier(0.22, 1, 0.36, 1)",
  }), [prefersReducedMotion, isTestEnv]);

  return (
    <div className="app-root" style={{ "--accent": activeTheme.accent }} data-theme={activeTheme.value}>

      <Topbar
        activeProfileId={activeProfileId}
        onProfileChange={setActiveProfileId}
        customProfiles={customProfiles}
        onAddProfile={handleAddProfile}
        hasProfile={hasProfile}
        activeProfile={activeProfile}
        backupStatus={backupStatus}
        backupLastSavedAt={backupLastSavedAt}
        backupError={backupError}
        onRetryBackup={() => saveStylesBackupWithRetry(styles)}
        onOpenStyleModal={() => setStyleModalOpen(true)}
        onOpenManagement={() => setManagementOpen(true)}
        onOpenProfileModal={() => setProfileModalOpen(true)}
      />

      {(error || (status && !loading)) && (
        <div className="app-notification-layer" aria-live="polite" aria-atomic="true">
          {error && (
            <div className="toast toast-error app-popup-notification" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={() => setError("")} style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", lineHeight: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          )}
          {status && !loading && (
            <div className="toast toast-success app-popup-notification" role="status">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span style={{ flex: 1 }}>{status}</span>
              <button onClick={() => setStatus("")} style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", lineHeight: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          )}
        </div>
      )}

      <main className="app-shell panel-grid app-workspace">

        <section className="app-primary-column">
          <div className={`app-editor-stack${shouldShowOutputPanel ? " app-editor-stack--with-output" : ""}`}>
            <div className={`app-editor-sticky${shouldShowOutputPanel ? " app-editor-sticky--with-output" : ""}`}>
              <WriterPanel
                inputText={inputText}
                onChange={handleInputChange}
                mode={mode}
                onModeChange={handleModeChange}
                loading={requestLoading}
                progressLabel={requestProgressLabel}
                progressTone={requestProgressTone}
                hasStyle={hasProfile}
                words={words}
                cliches={cliches}
                toneLevel={toneLevel}
                onToneLevelChange={setToneLevel}
                stripCliches={stripCliches}
                onStripClichesChange={setStripCliches}
                elabDepth={elabDepth}
                onElabDepthChange={setElabDepth}
                formatPreset={formatPreset}
                onFormatPresetChange={setFormatPreset}
                oneOffInstruction={oneOffInstruction}
                onOneOffInstructionChange={setOneOffInstruction}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                modelOptions={modelOptions}
                onAddModel={addCustomModelFromDropdown}
                onRemoveModel={handleRemoveModel}
                onNewChat={handleNewChat}
                onSubmit={mode === "humanize" ? humanize : elaborate}
              />
            </div>
            {shouldShowOutputPanel ? (
              <section ref={outputPanelRef} className="app-inline-output-panel">
                <OutputPanel
                  mode={mode}
                  originalText={inputText}
                  outputText={outputText}
                  isStreaming={isStreamingOutput}
                  onOutputChange={handleOutputChange}
                  showDiff={showDiff}
                  onToggleDiff={() => setShowDiff((prev) => !prev)}
                  isEdited={outputEdited}
                  readabilityBefore={readabilityBefore}
                  readabilityAfter={readabilityAfter}
                  metricSnapshotBefore={metricSnapshotBefore}
                  metricSnapshotAfter={metricSnapshotAfter}
                  delta={outputDelta}
                  copied={outputCopied}
                  onCopy={copyOutput}
                  onRegenerate={regenerateOutput}
                  onRegenerateWithFeedback={regenerateOutputWithFeedback}
                  cliches={cliches}
                  onPartialRegen={regeneratePartial}
                  isPartialStreaming={isPartialStreaming}
                />
              </section>
            ) : null}
          </div>
        </section>
      </main>

      <Button
        className="logs-fab"
        color={logsOpen || processSteps.length ? "primary" : "default"}
        variant={logsOpen || processSteps.length ? "solid" : "bordered"}
        onPress={() => setLogsOpen(true)}
        aria-label="Open logs drawer"
        tooltip="Open logs"
        iconOnly
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </Button>

      <Drawer
        opened={logsOpen}
        onClose={() => setLogsOpen(false)}
        position="right"
        size={460}
        offset={20}
        zIndex={390}
        title={<strong className="drawer-title">Logs</strong>}
        classNames={{
          content: "settings-drawer logs-drawer",
          header: "editor-settings-drawer-header",
          body: "panel-grid editor-settings-drawer-body logs-drawer-body",
        }}
        overlayProps={{ backgroundOpacity: 0.14, blur: 3 }}
        transitionProps={drawerTransitionProps}
      >
        <section className="panel-grid">
          <div className="text-mono logs-section-label">Process</div>
          {processSteps.length ? (
            <ProcessLogPanel steps={processSteps} compact />
          ) : (
            <div className="logs-empty-state">No process steps yet.</div>
          )}
        </section>

        <section className="panel-grid">
          <div className="text-mono logs-section-label">Diagnostics</div>
          <DiagnosticsPanel
            requestLogs={requestLogs}
            logsLoading={logsLoading}
            onRefresh={async () => setRequestLogs(await loadRequestLogs())}
            onClear={async () => { await clearRequestLogs(); setRequestLogs([]); }}
            collapsible={false}
          />
        </section>
      </Drawer>

      <Drawer
        opened={managementOpen}
        onClose={() => setManagementOpen(false)}
        position="right"
        size={420}
        offset={20}
        zIndex={400}
        title={<strong className="drawer-title">Profile & App</strong>}
        classNames={{
          content: "settings-drawer management-drawer",
          header: "editor-settings-drawer-header",
          body: "panel-grid editor-settings-drawer-body",
        }}
        overlayProps={{ backgroundOpacity: 0.18, blur: 4 }}
        transitionProps={drawerTransitionProps}
      >
      <ManagementPanel
        themeKey={themeKey}
        onThemeChange={setThemeKey}
        clichesUpdatedAt={clichesUpdatedAt}
        cliches={cliches}
        onRefreshCliches={refreshCliches}
        onUpdateCliches={async (updated) => { setCliches(updated); await save("cliches-v3", updated); }}
        clicheFetching={clicheFetching}
        hasProfile={hasProfile}
        isCustomProfile={customProfiles.some((p) => p.id === activeProfileId)}
        onExportProfile={exportProfile}
        onImportProfile={importProfile}
        onOpenApiKey={() => {
          getApiKeyStatus(runtimeConfig).then(status => {
            setApiKeySource(status.source);
            setApiKeyModalOpen(true);
          });
        }}
        onResetProfile={resetActiveProfile}
        onDeleteProfile={handleDeleteCustomProfile}
        onFullAppReset={() => setResetConfirmOpen(true)}
      />
      </Drawer>

      <Modal
        opened={addProfileModalOpen}
        onClose={() => setAddProfileModalOpen(false)}
        centered
        size="sm"
        withCloseButton={false}
        classNames={{ content: "modal-content", body: "panel-grid" }}
      >
        <div className="toolbar-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>New profile</h2>
          <Button variant="light" size="sm" onPress={() => setAddProfileModalOpen(false)} aria-label="Close" iconOnly>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </Button>
        </div>
        <Input
          placeholder="e.g. Freelance pitches"
          value={newProfileName}
          onChange={(e) => setNewProfileName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") confirmAddProfile(); }}
          autoFocus
          style={{ marginBottom: 12 }}
        />
        <div className="toolbar-row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <Button variant="bordered" size="sm" onPress={() => setAddProfileModalOpen(false)}>Cancel</Button>
          <Button color="primary" variant="solid" size="sm" onPress={confirmAddProfile} isDisabled={!newProfileName.trim()}>Create</Button>
        </div>
      </Modal>

      {styleModalOpen && (
        <StyleModal
          profileId={activeProfileId}
          hasProfile={hasProfile}
          loading={profileMergeLoading}
          health={health}
          profileLabel={PROFILE_OPTIONS.find((profile) => profile.id === activeProfileId)?.label || activeProfile?.name}
          sampleCount={activeProfile?.sampleEntries?.length || activeProfile?.sampleCount || 0}
          sampleEntries={activeProfile?.sampleEntries || []}
          profile={activeProfile?.profile || null}
          meta={activeProfile?.meta || null}
          onTrainProfile={trainProfile}
          onUpdateMeta={(metaUpdate) => handleUpdateProfileMeta(activeProfileId, metaUpdate)}
          onClose={() => setStyleModalOpen(false)}
        />
      )}

      {profileModalOpen && (
        <WritingProfileModal
          profile={activeProfile?.profile || null}
          health={health}
          profileLabel={resolveProfileName(activeProfileId)}
          hasProfile={hasProfile}
          confidence={activeProfileConfidence}
          meta={activeProfile?.meta || null}
          onUpdateMeta={(metaUpdate) => handleUpdateProfileMeta(activeProfileId, metaUpdate)}
          onUpdateProfile={(traitUpdate) => handleUpdateProfileTrait(activeProfileId, traitUpdate)}
          onClose={() => setProfileModalOpen(false)}
        />
      )}

      <MergeProgressModal
        opened={mergeProgressOpen}
        loading={profileMergeLoading}
        title={mergeProgressTitle}
        label={mergeProgressLabel}
        progressValue={mergeProgressValue}
        steps={mergeProgressSteps}
        onClose={() => {
          if (profileMergeLoading) return;
          setMergeProgressOpen(false);
          clearMergeProgress();
        }}
      />

      {addModelModalOpen && (
        <AddModelModal
          opened
          onClose={() => setAddModelModalOpen(false)}
          onAdd={handleAddModel}
          apiKey={apiKeyInput}
        />
      )}

      {resetConfirmOpen && (
        <ResetConfirmModal
          onClose={() => setResetConfirmOpen(false)}
          onConfirm={() => { setResetConfirmOpen(false); fullAppDataReset(); }}
        />
      )}

      {apiKeyModalOpen && (
        <ApiKeyModal
          required={apiKeyRequired}
          value={apiKeyInput}
          source={apiKeySource}
          apiUrl={apiUrlInput}
          apiKeyFile={apiKeyFileInput}
          loading={apiKeySaving}
          onChange={setApiKeyInput}
          onApiUrlChange={(next) => {
            setApiUrlInput(next);
            const updated = { ...runtimeConfig, apiUrl: next.trim() };
            setRuntimeConfig(updated);
            getApiKeyStatus(updated).then((status) => {
              setApiKeyRequired(!status.hasKey);
              setApiKeySource(status.source);
            }).catch(() => {});
          }}
          onApiKeyFileChange={(next) => {
            setApiKeyFileInput(next);
            const updated = { ...runtimeConfig, apiKeyFile: next.trim() };
            setRuntimeConfig(updated);
            getApiKeyStatus(updated).then((status) => {
              setApiKeyRequired(!status.hasKey);
              setApiKeySource(status.source);
            }).catch(() => {});
          }}
          onSave={saveApiKey}
          onClear={removeApiKey}
          onClose={() => { if (!apiKeyRequired) setApiKeyModalOpen(false); }}
        />
      )}
    </div>
  );
}

// ─── Re-exports for test compatibility ────────────────────────────────────────
export {
  buildClicheRanges,
  buildDiffSegments,
  buildMirrorSegments,
  collectCoverageGaps,
  computeProfileHealth,
  computeReadabilityScore,
  computeTextMetricSnapshot,
  computeWordCharDelta,
  countWords,
  formatSampleForPrompt,
  getFormatPresetInstruction,
  getFilledSlots,
  normalizeSampleSlot,
  normalizeStoredStyles,
  splitSentences,
} from './utils/index.js';

export { extractStreamTextChunk } from './lib/api.js';
export {
  analyzeHumanizeInput,
  buildHumanizeUserPrompt,
  outputLooksLikeAnsweredPrompt,
} from "./features/humanize/promptGuards.js";
