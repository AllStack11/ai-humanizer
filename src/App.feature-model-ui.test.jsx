import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createTheme, MantineProvider } from "@mantine/core";
import App from "./App.jsx";
import { PROFILE_TRAIT_KEYS } from "./constants/index.js";

const invokeMock = vi.fn();
const listenMock = vi.fn();
const clipboardWriteTextMock = vi.fn();
const clipboardReadTextMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args) => listenMock(...args),
}));

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "lg",
  fontFamily: "Manrope, Inter, system-ui, sans-serif",
});

function renderWithMantine(ui) {
  return render(<MantineProvider theme={theme}>{ui}</MantineProvider>);
}

function setStoredProfileData(styles, customModels = []) {
  localStorage.setItem("styles-v3", JSON.stringify({ styles, customModels }));
}

function readStoredProfileData() {
  const raw = localStorage.getItem("vh:web:styles-v3") || localStorage.getItem("styles-v3") || "{}";
  return JSON.parse(raw);
}

function getFirstStoredProfileRecord() {
  const stored = readStoredProfileData();
  return Object.values(stored.styles || {})[0] || null;
}

function getStoredProfileRecord(profileId) {
  return readStoredProfileData().styles?.[profileId] || null;
}

async function createProfileFromOnboarding(sampleText) {
  fireEvent.click(await screen.findByRole("button", { name: "Start onboarding" }));
  fireEvent.change(screen.getByPlaceholderText("Paste writing snippets. Each paste is added as one style piece."), {
    target: { value: sampleText },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to style pool" }));
  fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
}

async function addCustomProfile(name) {
  fireEvent.change(screen.getByRole("combobox", { name: "Profile" }), {
    target: { value: "__add_new__" },
  });
  fireEvent.change(await screen.findByPlaceholderText("e.g. Freelance pitches"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

describe("Feature model UI and persistence", () => {
  let streamListener = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    window.__TAURI_INTERNALS__ = {};
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: clipboardReadTextMock,
        writeText: clipboardWriteTextMock,
      },
    });
    localStorage.setItem("cliches-ts-v3", JSON.stringify(new Date().toISOString()));
    clipboardWriteTextMock.mockResolvedValue();
    clipboardReadTextMock.mockResolvedValue("");

    listenMock.mockImplementation(async (_eventName, cb) => {
      streamListener = cb;
      return () => {
        streamListener = null;
      };
    });

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") return { content: [{ text: "{\"tone\":\"balanced\"}" }] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        streamListener?.({ payload: { requestId, chunk: "Hello ", fullText: "Hello ", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: "world", fullText: "Hello world.", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText: "Hello world.", done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  test("defaults the feature model to Claude Sonnet 4.6 and restores a saved value", async () => {
    const { unmount } = renderWithMantine(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Feature model" })).toHaveValue("anthropic/claude-sonnet-4-6");
    });

    unmount();
    localStorage.setItem("feature-model-v1", JSON.stringify("moonshotai/kimi-k2.5"));

    renderWithMantine(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Feature model" })).toHaveValue("moonshotai/kimi-k2.5");
    });
  });

  test("keeps editor model and feature model independent", async () => {
    setStoredProfileData({
      personal: {
        id: "personal",
        name: "Personal",
        profile: { tone: "balanced" },
        sampleEntries: [{ id: 1, text: "this is a sample entry with enough content", type: "general" }],
        sampleCount: 1,
        updatedAt: new Date().toISOString(),
      },
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("combobox", { name: "Feature model" })).toHaveValue("anthropic/claude-sonnet-4-6");

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aion 2.0" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Feature model" })).toHaveValue("anthropic/claude-sonnet-4-6");
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent("Aion 2.0");
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Feature model" }), {
      target: { value: "moonshotai/kimi-k2.5" },
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Feature model" })).toHaveValue("moonshotai/kimi-k2.5");
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent("Aion 2.0");
    });
  });

  test("uses the feature model for profile creation requests", async () => {
    localStorage.setItem("selected-model-v1", JSON.stringify("google/gemini-2.5-pro"));
    localStorage.setItem("feature-model-v1", JSON.stringify("aion-labs/aion-2.0"));

    renderWithMantine(<App />);

    await createProfileFromOnboarding(
      "This is a long enough writing sample to create a profile and verify model routing in onboarding."
    );

    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat");
      expect(calls.length).toBeGreaterThan(0);
    }, { timeout: 6000 });

    const profileCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat");
    expect(profileCalls.every(([, args]) => args.payload.model === "aion-labs/aion-2.0")).toBe(true);
  });

  test("retries profile creation once after a transient request failure", async () => {
    let profileAttempt = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") {
        profileAttempt += 1;
        if (profileAttempt === 1) throw new Error("Failed to reach OpenRouter: connection refused");
        return { content: [{ text: '{"tone":"balanced"}' }] };
      }
      if (command === "openrouter_chat_stream") return { ok: true };
      return { ok: true };
    });

    renderWithMantine(<App />);
    await createProfileFromOnboarding(
      "This is a long enough writing sample to create a profile and verify retry behavior after one transient failure."
    );

    await waitFor(() => {
      expect(getFirstStoredProfileRecord()?.profile?.tone).toBe("balanced");
      expect(Object.keys(getFirstStoredProfileRecord()?.profile || {}).sort()).toEqual([...PROFILE_TRAIT_KEYS].sort());
    }, { timeout: 9000 });

    const profileCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat");
    expect(profileCalls).toHaveLength(2);
  }, 15000);

  test("shows a handled error and does not persist when profile creation returns a JSON array", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") return { content: [{ text: '["tone","balanced"]' }] };
      if (command === "openrouter_chat_stream") return { ok: true };
      return { ok: true };
    });

    renderWithMantine(<App />);
    await createProfileFromOnboarding(
      "This is a long enough writing sample to trigger profile creation and exercise invalid array handling."
    );

    expect(await screen.findByRole("alert", {}, { timeout: 9000 })).toHaveTextContent("The model returned an invalid profile structure. Please try again.");
    expect(getStoredProfileRecord("personal")?.profile).toBeNull();
  }, 15000);

  test("shows a handled error and does not persist when profile creation returns a JSON string", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") return { content: [{ text: '"not-a-profile"' }] };
      if (command === "openrouter_chat_stream") return { ok: true };
      return { ok: true };
    });

    renderWithMantine(<App />);
    await createProfileFromOnboarding(
      "This is a long enough writing sample to trigger profile creation and exercise invalid string handling."
    );

    expect(await screen.findByRole("alert", {}, { timeout: 9000 })).toHaveTextContent("The model returned an invalid profile structure. Please try again.");
    expect(getStoredProfileRecord("personal")?.profile).toBeNull();
  }, 15000);

  test("normalizes mixed-value profile objects before persisting them", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") {
        return {
          content: [{
            text: '{"tone":"balanced","summary":"steady and direct","sampleCount":3,"nested":{"bad":true},"humor":"dry"}',
          }],
        };
      }
      if (command === "openrouter_chat_stream") return { ok: true };
      return { ok: true };
    });

    renderWithMantine(<App />);
    await createProfileFromOnboarding(
      "This is a long enough writing sample to create a profile and verify mixed profile payload normalization."
    );

    await waitFor(() => {
      const profile = getFirstStoredProfileRecord()?.profile;
      expect(profile?.tone).toBe("balanced");
      expect(profile?.humor).toBe("dry");
      expect(profile?.vocabulary).toBe("");
      expect(profile?.summary).toBeUndefined();
      expect(Object.keys(profile || {}).sort()).toEqual([...PROFILE_TRAIT_KEYS].sort());
    }, { timeout: 9000 });
  });

  test("persists a valid first-time profile and keeps the happy path working", async () => {
    renderWithMantine(<App />);
    await createProfileFromOnboarding(
      "This is a long enough writing sample to create a valid first-time profile and verify the onboarding happy path."
    );

    await waitFor(() => {
      expect(getFirstStoredProfileRecord()?.profile?.tone).toBe("balanced");
      expect(Object.keys(getFirstStoredProfileRecord()?.profile || {}).sort()).toEqual([...PROFILE_TRAIT_KEYS].sort());
      expect(getFirstStoredProfileRecord()?.sampleCount).toBe(1);
    }, { timeout: 9000 });
  }, 15000);

  test("keeps a second custom profile record attached to its own id across remounts", async () => {
    const { unmount } = renderWithMantine(<App />);

    await addCustomProfile("Client Voice");

    await waitFor(() => {
      expect(getStoredProfileRecord("client-voice")).toMatchObject({
        id: "client-voice",
        name: "Client Voice",
        isCustom: true,
        profile: null,
      });
    });

    fireEvent.change(screen.getByPlaceholderText("Paste writing snippets. Each paste is added as one style piece."), {
      target: { value: "This is a long enough writing sample to create the second custom profile and keep its data attached." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to style pool" }));
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Profile" })).toHaveValue("client-voice");
      expect(getStoredProfileRecord("client-voice")?.profile?.tone).toBe("balanced");
      expect(Object.keys(getStoredProfileRecord("client-voice")?.profile || {}).sort()).toEqual([...PROFILE_TRAIT_KEYS].sort());
      expect(getStoredProfileRecord("client-voice")?.sampleCount).toBe(1);
    }, { timeout: 9000 });

    unmount();
    renderWithMantine(<App />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Profile" })).toHaveValue("client-voice");
      expect(getStoredProfileRecord("client-voice")?.name).toBe("Client Voice");
      expect(getStoredProfileRecord("client-voice")?.profile?.tone).toBe("balanced");
      expect(Object.keys(getStoredProfileRecord("client-voice")?.profile || {}).sort()).toEqual([...PROFILE_TRAIT_KEYS].sort());
    }, { timeout: 9000 });
  }, 15000);

  test("switching between built-in and custom profiles updates the profile systems to the selected record", async () => {
    setStoredProfileData({
      personal: {
        id: "personal",
        name: "Personal",
        isCustom: false,
        profile: { tone: "warm" },
        sampleEntries: [{ id: 1, text: "This is a long enough built in sample to count as trained profile content.", type: "general" }],
        sampleCount: 1,
        updatedAt: new Date().toISOString(),
      },
      work: {
        id: "work",
        name: "Work",
        isCustom: false,
        profile: null,
        sampleEntries: [],
        sampleCount: 0,
      },
      social: {
        id: "social",
        name: "Social Media",
        isCustom: false,
        profile: null,
        sampleEntries: [],
        sampleCount: 0,
      },
      "client-voice": {
        id: "client-voice",
        name: "Client Voice",
        isCustom: true,
        profile: { tone: "direct" },
        sampleEntries: [{ id: 1, text: "This is a long enough custom sample to count as trained profile content too.", type: "general" }],
        sampleCount: 1,
        updatedAt: new Date().toISOString(),
      },
    });

    renderWithMantine(<App />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Profile" })).toHaveValue("personal");
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Profile" }), {
      target: { value: "client-voice" },
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Profile" })).toHaveValue("client-voice");
    });

    fireEvent.click(screen.getByRole("button", { name: "View writing profile" }));
    await waitFor(() => {
      expect(screen.getByText("Client Voice Writing Profile")).toBeInTheDocument();
      expect(screen.getByText("direct")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Close profile modal" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Profile" }), {
      target: { value: "personal" },
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Profile" })).toHaveValue("personal");
    });

    fireEvent.click(screen.getByRole("button", { name: "View writing profile" }));
    await waitFor(() => {
      expect(screen.getByText("Personal Writing Profile")).toBeInTheDocument();
      expect(screen.getByText("warm")).toBeInTheDocument();
    });
  });

  test("remerge fully overwrites stored profile traits instead of preserving stale values", async () => {
    setStoredProfileData({
      personal: {
        id: "personal",
        name: "Personal",
        isCustom: false,
        profile: { tone: "warm", humor: "playful", rhythm: "bouncy" },
        sampleEntries: [
          {
            id: 1,
            text: "This sample is definitely long enough to count as an existing trained writing sample for the current profile.",
            type: "general",
          },
        ],
        sampleCount: 1,
        updatedAt: new Date().toISOString(),
      },
    });

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") return { content: [{ text: "{\"tone\":\"direct\"}" }] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        streamListener?.({ payload: { requestId, chunk: "Hello ", fullText: "Hello ", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: "world", fullText: "Hello world.", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText: "Hello world.", done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Add Personal samples" }));
    fireEvent.change(screen.getByPlaceholderText("Paste writing snippets. Each paste is added as one style piece."), {
      target: { value: "This new sample is also comfortably longer than fifty characters, so the merge action can run without any validation issue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to style pool" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge into profile" }));

    await waitFor(() => {
      const profile = getStoredProfileRecord("personal")?.profile;
      expect(profile).toBeTruthy();
      expect(Object.keys(profile).sort()).toEqual([...PROFILE_TRAIT_KEYS].sort());
      expect(profile.tone).toBe("direct");
      expect(profile.humor).toBe("");
      expect(profile.rhythm).toBe("");
    }, { timeout: 9000 });
  });

  test("falls back both model selections when removing a custom model", async () => {
    setStoredProfileData({}, [{ value: "custom/test-model", label: "Custom Test Model" }]);
    localStorage.setItem("selected-model-v1", JSON.stringify("custom/test-model"));
    localStorage.setItem("feature-model-v1", JSON.stringify("custom/test-model"));

    renderWithMantine(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Feature model" })).toHaveValue("custom/test-model");
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent("Custom Test Model");
    });

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove Custom Test Model" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Feature model" })).toHaveValue("anthropic/claude-sonnet-4-6");
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent("Claude Sonnet 4.6");
    });
  });

  test("persists a custom model in profile data across remounts on web", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const { unmount } = renderWithMantine(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));
    fireEvent.click(await screen.findByRole("button", { name: /\+ Add custom model/i }));

    fireEvent.change(await screen.findByPlaceholderText("Model ID (e.g. openai/gpt-4o-mini)"), {
      target: { value: "custom/persisted-model" },
    });
    fireEvent.change(screen.getByPlaceholderText("Display name (optional)"), {
      target: { value: "Persisted Model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Model" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent("Persisted Model");
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("styles-v3") || "{}");
      expect(stored.customModels).toEqual([{ value: "custom/persisted-model", label: "Persisted Model" }]);
    });

    unmount();

    renderWithMantine(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent("Persisted Model");
    });
  });

  test("keeps the current default model state after desktop backup load and still saves the container shape", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") {
        return {
          styles: {},
          customModels: [{ value: "backup/custom-model", label: "Backup Custom Model" }],
          savedAt: new Date().toISOString(),
        };
      }
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") return { content: [{ text: "{\"tone\":\"balanced\"}" }] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        streamListener?.({ payload: { requestId, chunk: "Hello ", fullText: "Hello ", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: "world", fullText: "Hello world.", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText: "Hello world.", done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select model" })).toHaveTextContent("Claude Sonnet 4.6");
    });

    fireEvent.click(screen.getByRole("button", { name: "Select model" }));
    await waitFor(() => {
      expect(screen.queryByText("Backup Custom Model")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      const saveCalls = invokeMock.mock.calls.filter(([command]) => command === "save_styles_backup");
      expect(saveCalls.length).toBeGreaterThan(0);
      expect(saveCalls.at(-1)?.[1]?.styles?.customModels).toEqual([]);
      expect(Object.keys(saveCalls.at(-1)?.[1]?.styles?.styles || {}).sort()).toEqual(["personal", "social", "work"]);
    });
  });
});
