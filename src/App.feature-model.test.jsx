import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createTheme, MantineProvider } from "@mantine/core";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("./components/OutputPanel.jsx", () => ({
  default: function MockOutputPanel({
    outputText,
    onPartialRegen,
    onRegenerate,
    onRegenerateWithFeedback,
    isPartialStreaming,
  }) {
    return (
      <div aria-label="mock-output-panel">
        <div>{outputText}</div>
        <button
          type="button"
          onClick={() => onRegenerate?.()}
          disabled={!outputText}
        >
          Trigger standard regen
        </button>
        <button
          type="button"
          onClick={() => onPartialRegen?.("Hello world", 0, 11)}
          disabled={!outputText || isPartialStreaming}
        >
          Trigger partial regen
        </button>
      </div>
    );
  },
}));

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

describe("Feature model routing", () => {
  let streamListener = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    window.__TAURI_INTERNALS__ = {};
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
    localStorage.setItem("selected-model-v1", JSON.stringify("google/gemini-2.5-pro"));
    localStorage.setItem("feature-model-v1", JSON.stringify("aion-labs/aion-2.0"));

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
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = "Hello world.";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  test("uses feature model for highlighted regeneration while keeping editor generation on the editor model", async () => {
    const { default: App } = await import("./App.jsx");
    renderWithMantine(<App />);

    fireEvent.change(await screen.findByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to generate output before testing partial regeneration." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Trigger partial regen" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Trigger partial regen" }));

    await waitFor(() => {
      const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
      expect(streamCalls).toHaveLength(2);
    });

    const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
    expect(streamCalls[0][1].payload.model).toBe("google/gemini-2.5-pro");
    expect(streamCalls[1][1].payload.model).toBe("aion-labs/aion-2.0");
  });

  test("keeps standard output regeneration tied to the editor model", async () => {
    const { default: App } = await import("./App.jsx");
    renderWithMantine(<App />);

    fireEvent.change(await screen.findByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to generate output before testing standard regeneration." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Trigger standard regen" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Trigger standard regen" }));

    await waitFor(() => {
      const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
      expect(streamCalls).toHaveLength(2);
    });

    const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
    expect(streamCalls[0][1].payload.model).toBe("google/gemini-2.5-pro");
    expect(streamCalls[1][1].payload.model).toBe("google/gemini-2.5-pro");
  });

  test("removes the selected span before partial regen replacement streams in", async () => {
    let streamCallCount = 0;
    let pendingPartialRequestId = null;

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCallCount += 1;
        const requestId = args.requestId;
        if (streamCallCount === 1) {
          const fullText = "Hello world.";
          streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
          streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
          return { ok: true };
        }
        pendingPartialRequestId = requestId;
        return { ok: true };
      }
      return { ok: true };
    });

    const { default: App } = await import("./App.jsx");
    renderWithMantine(<App />);

    fireEvent.change(await screen.findByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to generate output before testing partial regeneration." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));

    await waitFor(() => {
      expect(screen.getByText("Hello world.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Trigger partial regen" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Trigger partial regen" }));

    await waitFor(() => {
      expect(screen.getByText(".")).toBeInTheDocument();
      expect(pendingPartialRequestId).toBeTruthy();
    });

    expect(pendingPartialRequestId).toBeTruthy();
  });
});
