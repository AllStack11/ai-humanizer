import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createTheme, MantineProvider } from "@mantine/core";
import App, {
  analyzeHumanizeInput,
  buildClicheRanges,
  buildDiffSegments,
  buildHumanizeUserPrompt,
  buildMirrorSegments,
  collectCoverageGaps,
  computeProfileHealth,
  computeReadabilityScore,
  computeWordCharDelta,
  countWords,
  getFormatPresetInstruction,
  normalizeStoredProfileData,
  normalizeStoredStyles,
  outputLooksLikeAnsweredPrompt,
} from "./App.jsx";
// import { saveOutputHistory, loadOutputHistory } from "./lib/output-history.js";

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

describe("App utility functions", () => {
  test("countWords handles whitespace-only strings", () => {
    expect(countWords("   ")).toBe(0);
    expect(countWords("one two   three")).toBe(3);
  });

  test("buildMirrorSegments marks cliches", () => {
    const cliches = buildClicheRanges("Ths is very robust prose", ["robust"]);
    const segments = buildMirrorSegments("Ths is very robust prose", cliches);

    expect(segments.filter((s) => s.kind === "cliche").map((s) => s.text)).toEqual(["robust"]);
  });

  test("normalizeStoredStyles keeps current profile ids and fields", () => {
    const normalized = normalizeStoredStyles({
      personal: {
        id: "personal",
        name: "Personal",
        profile: { tone: "balanced" },
        sampleEntries: [{ id: 1, text: "old sample", type: "general" }],
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    });

    expect(normalized.personal).toBeTruthy();
    expect(normalized.personal.name).toBe("Personal");
    expect(normalized.personal.sampleCount).toBe(1);
  });

  test("normalizeStoredStyles resolves legacy question sample type labels", () => {
    const normalized = normalizeStoredStyles({
      personal: {
        id: "personal",
        name: "Personal",
        profile: { tone: "balanced" },
        sampleEntries: [
          { id: 1, text: "How are you feeling about the launch?", type: "Questions / Q&A" },
          { id: 2, text: "I am excited and a bit nervous.", type: "q&a" },
        ],
      },
    });

    expect(normalized.personal.sampleEntries[0].type).toBe("question");
    expect(normalized.personal.sampleEntries[1].type).toBe("question");
  });

  test("normalizeStoredProfileData accepts the new container shape", () => {
    const normalized = normalizeStoredProfileData({
      styles: {
        personal: {
          id: "personal",
          name: "Personal",
          profile: { tone: "balanced" },
          sampleEntries: [{ id: 1, text: "old sample", type: "general" }],
        },
      },
      customModels: [
        { value: "custom/model-one", label: "Model One" },
        { value: "custom/model-one", label: "Duplicate label ignored" },
      ],
    });

    expect(normalized.styles.personal).toBeTruthy();
    expect(normalized.customModels).toEqual([{ value: "custom/model-one", label: "Model One" }]);
  });

  test("normalizeStoredProfileData filters malformed custom models", () => {
    const normalized = normalizeStoredProfileData({
      styles: {},
      customModels: [
        null,
        { value: "   " },
        { value: "custom/model-two", label: "   " },
      ],
    });

    expect(normalized.customModels).toEqual([{ value: "custom/model-two", label: "custom/model-two" }]);
  });

  test("buildDiffSegments reports insertions and deletions", () => {
    const segments = buildDiffSegments("alpha beta", "alpha gamma beta");
    expect(segments.some((seg) => seg.type === "added" && seg.text.includes("gamma"))).toBe(true);
  });

  test("readability, deltas, presets and profile health helpers", () => {
    expect(computeReadabilityScore("This is a short sentence.")).toBeGreaterThan(0);
    expect(computeWordCharDelta("one two", "one two three").wordDelta).toBe(1);
    expect(getFormatPresetInstruction("blog-post")).toMatch(/blog post/i);

    const gaps = collectCoverageGaps([{ type: "email" }, { type: "journal" }]);
    expect(gaps.map((g) => g.value)).toContain("general");

    const health = computeProfileHealth({
      sampleEntries: [{ type: "email" }, { type: "general" }],
      sampleCount: 2,
      updatedAt: new Date().toISOString(),
    });
    expect(health.score).toBeGreaterThan(0);
  });

  test("humanize prompt builder locks conversational inputs to transformation mode", () => {
    const analysis = analyzeHumanizeInput("Hey how are you doing today");
    const prompt = buildHumanizeUserPrompt("Hey how are you doing today");

    expect(analysis.conversational).toBe(true);
    expect(analysis.questionLike).toBe(true);
    expect(prompt).toMatch(/Do not answer it/i);
    expect(prompt).toMatch(/Keep the result as a question or check-in/i);
    expect(prompt).toMatch(/Keep the greeting intent/i);
    expect(prompt).toMatch(/<source_text>[\s\S]*Hey how are you doing today[\s\S]*<\/source_text>/i);
  });

  test("flags conversational outputs that answer the input instead of rewriting it", () => {
    expect(
      outputLooksLikeAnsweredPrompt(
        "Hey how are you",
        "you know im doing pretty good actually, been diving deep into some new agentic workflows and honestly its wild"
      )
    ).toBe(true);

    expect(outputLooksLikeAnsweredPrompt("Hey how are you", "hey how are you doing these days?")).toBe(false);
  });
});

describe("App UI", () => {
  let streamListener = null;
  let scrollIntoViewMock;

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
    streamListener = null;
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
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
      if (command === "openrouter_chat") return { content: [{ text: "Rewritten sentence." }] };
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

  test("pastes clipboard text into the input when paste button is pressed", async () => {
    clipboardReadTextMock.mockResolvedValue("Browser clipboard text");
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "read_clipboard_text") return "Clipboard draft ready for humanizing.";
      if (command === "openrouter_chat") return { content: [{ text: "Rewritten sentence." }] };
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

    const editor = await screen.findByPlaceholderText("Paste AI-generated text here…");
    fireEvent.click(screen.getByRole("button", { name: "Paste input" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("read_clipboard_text", {});
      expect(clipboardReadTextMock).not.toHaveBeenCalled();
      expect(editor).toHaveValue("Clipboard draft ready for humanizing.");
    });
  });

  test("streams and applies one-off instructions plus output presets", async () => {
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

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to exercise the humanize flow and stream the rewritten output." },
    });

    fireEvent.change(await screen.findByRole("combobox", { name: "Output format preset" }), {
      target: { value: "blog-post" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show one-off instruction" }));
    fireEvent.change(screen.getByRole("textbox", { name: "One-off instruction" }), {
      target: { value: "make this sound more confident" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
    });
    const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
    expect(streamCall[1].payload.system).toMatch(/Extra constraints/);
    expect(streamCall[1].payload.system).toMatch(/make this sound more confident/i);
    expect(streamCall[1].payload.system).toMatch(/blog post/i);
    expect(await screen.findByRole("region", { name: "LLM output" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand text metrics" }));
    expect(screen.getByText(/FKGL/)).toBeInTheDocument();
    expect(screen.getByText(/LexDiv/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept output" })).not.toBeInTheDocument();
  });

  test("applies one-off instructions to elaborate requests", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));
    fireEvent.change(screen.getByPlaceholderText("Write something to elaborate on…"), {
      target: { value: "Short draft with enough text to exercise the elaborate request path." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Show one-off instruction" }));
    fireEvent.change(screen.getByRole("textbox", { name: "One-off instruction" }), {
      target: { value: "add a concrete example at the end" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Elaborate text" }));

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
    });

    const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
    expect(streamCall[1].payload.system).toMatch(/Extra constraints/);
    expect(streamCall[1].payload.system).toMatch(/add a concrete example at the end/i);
    expect(await screen.findByRole("region", { name: "LLM output" })).toBeInTheDocument();
  });

  test.skip("stores one-off instructions in output history entries", async () => {
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

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to create a history entry with one-off instructions." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Show one-off instruction" }));
    fireEvent.change(screen.getByRole("textbox", { name: "One-off instruction" }), {
      target: { value: "tighten the opening sentence" },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toBeInTheDocument();
    });

    const history = await loadOutputHistory();
    const entries = Object.values(history.entriesById);

    expect(entries).toHaveLength(1);
    expect(entries[0].oneOffInstruction).toBe("tighten the opening sentence");
    expect(entries[0].extraDirection).toMatch(/tighten the opening sentence/i);
  });

  test("retries with stricter guardrails when a short conversational input gets answered", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = streamCount === 1
          ? "you know im doing pretty good actually, been diving deep into some new agentic workflows lately"
          : "hey how are you doing today?";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "Hey how are you doing today" },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "LLM output" })).toHaveTextContent("hey how are you doing today?");
    }, { timeout: 3000 });

    const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[0][1].payload.messages[0].content).toMatch(/Do not answer it/i);
    expect(streamCalls[1][1].payload.system).toMatch(/never answer it as though you are in a live conversation/i);
    expect(streamCalls[1][1].payload.messages[0].content).toMatch(/previous attempt drifted into a response/i);
  });

  test("shows active generation logs at the bottom of the output panel and hides them after streaming completes", async () => {
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

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") return { content: [{ text: "Rewritten sentence." }] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        streamListener?.({ payload: { requestId, chunk: "Hello ", fullText: "Hello ", done: false, error: null } });
        await new Promise((resolve) => setTimeout(resolve, 40));
        streamListener?.({ payload: { requestId, chunk: "world", fullText: "Hello world.", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText: "Hello world.", done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to show the streaming overlay before final output promotion." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    const generationLog = await screen.findByRole("log", { name: "Generation activity log" });
    expect(screen.getByText("Generating Preview")).toBeInTheDocument();
    expect(screen.getByText(/Preparing prompt and opening model stream\./i)).toBeInTheDocument();
    expect(within(generationLog).getByText(/Model stream connected\. Receiving rewrite output\./i)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        scrollIntoViewMock.mock.calls.length > 0 || screen.queryByRole("region", { name: "LLM output" })
      ).toBeTruthy();
    });
    expect(await screen.findByRole("region", { name: "LLM output" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("log", { name: "Generation activity log" })).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open logs drawer" }));
    expect(await screen.findByRole("log", { name: "Process log" })).toHaveTextContent("Model stream connected. Receiving rewrite output.");
  });

  test("cancels a hung generation and allows retry", async () => {
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

    let streamCallCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCallCount += 1;
        if (streamCallCount === 1) {
          return new Promise(() => {});
        }
        const requestId = args.requestId;
        streamListener?.({ payload: { requestId, chunk: "Hello ", fullText: "Hello ", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: "again", fullText: "Hello again", done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText: "Hello again", done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to exercise cancel and retry on a hung request." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));
    expect(await screen.findByRole("button", { name: "Cancel generation" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel generation" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Cancel generation" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Humanize text" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "LLM output" })).toHaveTextContent("Hello again");
    });
    expect(streamCallCount).toBe(2);
  });

  test("keeps the generated rewrite in the output panel instead of merging it into the editor", async () => {
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

    const editor = screen.getByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(editor, {
      target: { value: "This paragraph is long enough to exercise the accept output path." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(await screen.findByRole("region", { name: "LLM output" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste AI-generated text here…")).toHaveValue(
      "This paragraph is long enough to exercise the accept output path."
    );
    expect(screen.queryByRole("button", { name: "Accept output" })).not.toBeInTheDocument();
  });

  test("copies generated output text from the output toolbar", async () => {
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

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to trigger output generation and copy testing." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "LLM output" })).toHaveTextContent("Hello world.");
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy output" }));
    expect(clipboardWriteTextMock).toHaveBeenLastCalledWith("Hello world.");
    expect(await screen.findByText("Output copied.")).toBeInTheDocument();
  });

  test.skip("tracks same-thread generations and shows preset/depth metadata in session and global history", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = `History output ${streamCount}`;
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));
    fireEvent.change(screen.getByRole("slider", { name: "Elaboration depth" }), {
      target: { value: "0" },
    });
    const editor = screen.getByPlaceholderText("Write something to elaborate on…");
    fireEvent.change(editor, {
      target: { value: "This paragraph is long enough to generate multiple history items in the same thread." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("History output 1");
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Output format preset" }), {
      target: { value: "report" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Elaboration depth" }), {
      target: { value: "4" },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("History output 2");
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    const sessionList = screen.getByRole("list", { name: "Session history" });
    expect(sessionList.querySelectorAll(".session-history-item")).toHaveLength(2);
    expect(within(sessionList).getByText("Type: Elaborate · Preset: None · Depth: One sentence · Tone: Balanced")).toBeInTheDocument();
    expect(within(sessionList).getByText("Type: Elaborate · Preset: Report · Depth: Full paragraph · Tone: Balanced")).toBeInTheDocument();

    fireEvent.click(sessionList.querySelectorAll(".session-history-item")[0]);
    expect(screen.getAllByText("History output 1").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("History output 2");

    fireEvent.click(within(sessionList.querySelectorAll(".session-history-item")[0]).getByRole("button", { name: "Copy model response for Gen 1" }));
    expect(clipboardWriteTextMock).toHaveBeenLastCalledWith("History output 1");
    fireEvent.click(within(sessionList.querySelectorAll(".session-history-item")[0]).getByRole("button", { name: "Copy user response for Gen 1" }));
    expect(clipboardWriteTextMock).toHaveBeenLastCalledWith(
      "This paragraph is long enough to generate multiple history items in the same thread."
    );

    fireEvent.click(screen.getByRole("button", { name: "Open output history" }));
    const globalList = await screen.findByRole("list", { name: "Global output history" });
    expect(within(globalList).getAllByRole("button")).toHaveLength(2);
    expect(within(globalList).getByText("Type: Elaborate · Preset: Report · Depth: Full paragraph · Tone: Balanced")).toBeInTheDocument();
  });

  test.skip("regenerate updates both session and global history", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = `Regenerated output ${streamCount}`;
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to create an output and then regenerate." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Regenerated output 1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Regenerate output" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Regenerated output 2");
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    const sessionList = screen.getByRole("list", { name: "Session history" });
    expect(sessionList.querySelectorAll(".session-history-item")).toHaveLength(2);
    expect(within(sessionList).getByText(/Original · Raw/i)).toBeInTheDocument();
    expect(within(sessionList).getByText(/Regen 1 · Raw/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open output history" }));
    const globalList = await screen.findByRole("list", { name: "Global output history" });
    expect(within(globalList).getAllByRole("button")).toHaveLength(2);
  });

  test.skip("allows collapsing and expanding the session history section", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = `Collapsible output ${streamCount}`;
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to generate output and validate session section collapsing." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Collapsible output 1");
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Collapsible output 2");
    });

    expect(screen.queryByRole("list", { name: "Session history" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    expect(screen.getByRole("list", { name: "Session history" }).querySelectorAll(".session-history-item")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Collapse session history section" }));
    expect(screen.queryByRole("list", { name: "Session history" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    expect(screen.getByRole("list", { name: "Session history" }).querySelectorAll(".session-history-item")).toHaveLength(2);
  });

  test.skip("regenerate with feedback includes custom direction in the stream prompt", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = `Feedback output ${streamCount}`;
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to generate output before a feedback regeneration request." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Feedback output 1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Open regenerate feedback" }));
    fireEvent.change(screen.getByLabelText("Regenerate feedback input"), {
      target: { value: "Make it shorter and punchier." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate with feedback" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Feedback output 2");
    });

    const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1][1].payload.system).toMatch(/Regeneration feedback:/i);
    expect(streamCalls[1][1].payload.system).toMatch(/Make it shorter and punchier\./i);

    const history = await loadOutputHistory();
    const entries = Object.values(history.entriesById);
    expect(entries).toHaveLength(2);
    expect(entries[1].regenerateFeedback).toBe("Make it shorter and punchier.");

    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    expect(screen.getAllByText(/Feedback: Make it shorter and punchier\./i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Regeneration feedback:/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open output history" }));
    await screen.findByRole("list", { name: "Global output history" });
    expect(screen.getByText("Direction: None")).toBeInTheDocument();
    expect(screen.getByText("Feedback: Present")).toBeInTheDocument();
    expect(screen.getAllByText(/Regeneration feedback:/i).length).toBeGreaterThan(0);
  });

  test.skip("uses one session preview toggle to expand and collapse both columns", async () => {
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

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = "Shared preview expansion output that is long enough to wrap into multiple lines for the session history card.";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: {
        value:
          "This is a long source paragraph for the linked session preview control. It should be clipped until the shared expand button is pressed.",
      },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent(
        "Shared preview expansion output that is long enough to wrap into multiple lines for the session history card."
      );
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    const item = screen.getByRole("list", { name: "Session history" }).querySelector(".session-history-item");
    expect(item).not.toBeNull();
    const previewTexts = item.querySelectorAll(".session-history-bubble-text");
    expect(previewTexts).toHaveLength(2);
    expect(previewTexts[0].classList.contains("is-expanded")).toBe(false);
    expect(previewTexts[1].classList.contains("is-expanded")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Expand session preview" }));
    expect(previewTexts[0].classList.contains("is-expanded")).toBe(true);
    expect(previewTexts[1].classList.contains("is-expanded")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Collapse session preview" }));
    expect(previewTexts[0].classList.contains("is-expanded")).toBe(false);
    expect(previewTexts[1].classList.contains("is-expanded")).toBe(false);
  });

  test.skip("keeps session history on the original model output after the live draft is edited", async () => {
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

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = "Immutable history output";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to create a history entry." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Immutable history output");
    });

    fireEvent.input(screen.getByLabelText("Generated output editor"), {
      target: { textContent: "Edited live draft" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Edited live draft");
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    await waitFor(() => {
      expect(screen.getByText(/Original · Edited/i)).toBeInTheDocument();
    });
    const sessionList = screen.getByRole("list", { name: "Session history" });
    expect(within(sessionList).queryByText("Edited live draft")).not.toBeInTheDocument();
    expect(within(sessionList).getByText("Immutable history output")).toBeInTheDocument();
  });

  test.skip("keeps the same session when the source text changes before the next generation", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = `Session continuity output ${streamCount}`;
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    const editor = screen.getByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(editor, {
      target: { value: "This paragraph is long enough to create the first session entry." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Session continuity output 1");
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    expect(screen.getByRole("list", { name: "Session history" }).querySelectorAll(".session-history-item")).toHaveLength(1);

    fireEvent.change(editor, {
      target: { value: "This is a materially different paragraph that should create a second session." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Session continuity output 2");
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    expect(screen.getByRole("list", { name: "Session history" }).querySelectorAll(".session-history-item")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Open output history" }));
    const globalList = await screen.findByRole("list", { name: "Global output history" });
    expect(within(globalList).getAllByRole("button")).toHaveLength(2);
  });

  test.skip("keeps session history and carries session context when switching generation type", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = `Mode switch continuity output ${streamCount}`;
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    const humanizeInput = "First humanize input with enough length to create the initial turn.";
    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: humanizeInput },
    });
    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Mode switch continuity output 1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));
    fireEvent.change(screen.getByPlaceholderText("Write something to elaborate on…"), {
      target: { value: "Second elaborate input with enough length to continue the same session thread." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Elaborate text" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Mode switch continuity output 2");
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    const sessionList = screen.getByRole("list", { name: "Session history" });
    expect(sessionList.querySelectorAll(".session-history-item")).toHaveLength(2);

    const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1][1].payload.system).toContain("Session memory:");
    expect(streamCalls[1][1].payload.system).toContain(humanizeInput);
    expect(streamCalls[1][1].payload.system).toContain("Mode switch continuity output 1");
  });

  test.skip("keeps session history panel visible after switching generation type", async () => {
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

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = "Single session output";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "Initial humanize input with enough characters to create one history turn." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Single session output");
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));

    const sessionList = screen.getByRole("list", { name: "Session history" });
    expect(sessionList.querySelectorAll(".session-history-item")).toHaveLength(1);
  });

  test("keeps generated output visible after switching generation type", async () => {
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

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = "Persistent LLM output across mode switch";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "Initial humanize source text long enough for a valid rewrite request." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Persistent LLM output across mode switch");
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));

    expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Persistent LLM output across mode switch");
  });

  test.skip("treats send after editing source text as a regeneration in the same session", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = `Edited source regen output ${streamCount}`;
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    const editor = screen.getByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(editor, {
      target: { value: "This paragraph is long enough to create an initial response in session history." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Edited source regen output 1");
    });

    fireEvent.change(editor, {
      target: { value: "This edited source should still be treated as a regeneration in the same session thread." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Humanize text" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Edited source regen output 2");
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    const sessionList = screen.getByRole("list", { name: "Session history" });
    expect(sessionList.querySelectorAll(".session-history-item")).toHaveLength(2);
    expect(within(sessionList).getByText(/Original · Raw/i)).toBeInTheDocument();
    expect(within(sessionList).getByText(/Regen 1 · Raw/i)).toBeInTheDocument();
    expect(within(sessionList).getByText("This edited source should still be treated as a regeneration in the same session thread.")).toBeInTheDocument();
  });

  test.skip("starts a true new session when using the new chat button", async () => {
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

    let streamCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = `New chat output ${streamCount}`;
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    const editor = screen.getByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(editor, {
      target: { value: "First source paragraph long enough to generate output in session one." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("New chat output 1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Start new chat" }));
    expect(screen.getByPlaceholderText("Paste AI-generated text here…")).toHaveValue("");

    fireEvent.change(editor, {
      target: { value: "Second source paragraph long enough to generate output in session two." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("New chat output 2");
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand session history section" }));
    expect(screen.getByRole("list", { name: "Session history" }).querySelectorAll(".session-history-item")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open output history" }));
    const globalList = await screen.findByRole("list", { name: "Global output history" });
    expect(within(globalList).getAllByRole("button")).toHaveLength(2);
  });

  test.skip("supports deleting the selected entry from global response detail", async () => {
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
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = "Archive management output";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to create an archive entry for management actions." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Archive management output");
    });

    fireEvent.click(screen.getByRole("button", { name: "Open output history" }));
    await screen.findByRole("list", { name: "Global output history" });

    expect(screen.queryByRole("button", { name: "Copy selected history entry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save selected history entry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unsave selected history entry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename selected history entry" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete selected history entry" }));
    expect(await screen.findByText("No history entries match the current filters.")).toBeInTheDocument();
  });

  test.skip("loads persisted history into the global archive on startup and filters by profile", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { tone: "balanced" },
          sampleEntries: [{ id: 1, text: "enough content for personal", type: "general" }],
          sampleCount: 1,
          updatedAt: new Date().toISOString(),
        },
        work: {
          id: "work",
          name: "Work",
          profile: { tone: "professional" },
          sampleEntries: [{ id: 2, text: "enough content for work", type: "general" }],
          sampleCount: 1,
          updatedAt: new Date().toISOString(),
        },
    });

    const seededHistory = {
      version: 2,
      entriesById: {
        entryPersonal: {
          id: "entryPersonal",
          sessionId: "sessionPersonal",
          profileId: "personal",
          createdAt: "2026-03-01T12:00:00.000Z",
          updatedAt: "2026-03-01T12:00:00.000Z",
          mode: "humanize",
          model: "writer/palmyra-x5",
          sourceText: "Personal source",
          baseOutputText: "Personal archive output",
          currentOutputText: "Personal archive output",
          title: "Personal history entry",
          status: "ready",
          formatPreset: "none",
          toneLevel: 2,
          stripCliches: true,
          elabDepth: 2,
          isSaved: false,
          savedAt: null,
        },
        entryWork: {
          id: "entryWork",
          sessionId: "sessionWork",
          profileId: "work",
          createdAt: "2026-03-02T12:00:00.000Z",
          updatedAt: "2026-03-02T12:00:00.000Z",
          mode: "elaborate",
          model: "google/gemini-2.5-pro",
          sourceText: "Work source",
          baseOutputText: "Work archive output",
          currentOutputText: "Work archive output",
          title: "Work history entry",
          status: "ready",
          formatPreset: "none",
          toneLevel: 2,
          stripCliches: true,
          elabDepth: 2,
          isSaved: true,
          savedAt: "2026-03-02T12:10:00.000Z",
        },
      },
      sessionsById: {
        sessionPersonal: {
          id: "sessionPersonal",
          profileId: "personal",
          startedAt: "2026-03-01T12:00:00.000Z",
          updatedAt: "2026-03-01T12:00:00.000Z",
          mode: "humanize",
          sourceTextSnapshot: "Personal source",
          threadKey: "personal::humanize::Personal source",
          entryIds: ["entryPersonal"],
          activeEntryId: "entryPersonal",
        },
        sessionWork: {
          id: "sessionWork",
          profileId: "work",
          startedAt: "2026-03-02T12:00:00.000Z",
          updatedAt: "2026-03-02T12:00:00.000Z",
          mode: "elaborate",
          sourceTextSnapshot: "Work source",
          threadKey: "work::elaborate::Work source",
          entryIds: ["entryWork"],
          activeEntryId: "entryWork",
        },
      },
      globalEntryOrder: ["entryWork", "entryPersonal"],
    };
    await saveOutputHistory(seededHistory);

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open output history" }));

    const globalList = await screen.findByRole("list", { name: "Global output history" });
    expect(within(globalList).getAllByRole("button")).toHaveLength(2);

    fireEvent.change(screen.getByRole("combobox", { name: "History profile filter" }), {
      target: { value: "work" },
    });
    expect(within(screen.getByRole("list", { name: "Global output history" })).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Work history entry")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "History saved filter" }), {
      target: { value: "saved" },
    });
    expect(within(screen.getByRole("list", { name: "Global output history" })).getAllByRole("button")).toHaveLength(1);
  });

  test.skip("reopening global history resets stale filters so recent unsaved entries remain visible", async () => {
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

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = "Unsaved archive result";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to create one unsaved archive entry." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Unsaved archive result");
    });

    fireEvent.click(screen.getByRole("button", { name: "Open output history" }));
    await screen.findByRole("list", { name: "Global output history" });
    fireEvent.change(screen.getByRole("combobox", { name: "History saved filter" }), {
      target: { value: "saved" },
    });
    expect(screen.getByText("No history entries match the current filters.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open output history" }));
    expect((await screen.findAllByText("Unsaved archive result")).length).toBeGreaterThan(0);
  });

  test.skip("persists generated history across app remounts", async () => {
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

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = "Persisted across remount";
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    const firstRender = renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This paragraph is long enough to create a history entry that should survive remount." },
    });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText("Generated output editor")).toHaveTextContent("Persisted across remount");
    });

    firstRender.unmount();

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open output history" }));

    const historyList = await screen.findByRole("list", { name: "Global output history" });
    expect(within(historyList).getAllByRole("button")).toHaveLength(1);
    expect((await screen.findAllByText("Persisted across remount")).length).toBeGreaterThan(0);
  });


  test.skip("profile reset clears history entries for the active profile", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { tone: "balanced" },
          sampleEntries: [{ id: 1, text: "this is a sample entry with enough content", type: "general" }],
          sampleCount: 1,
          updatedAt: new Date().toISOString(),
        },
        work: {
          id: "work",
          name: "Work",
          profile: { tone: "professional" },
          sampleEntries: [{ id: 2, text: "this is another sample entry with enough content", type: "general" }],
          sampleCount: 1,
          updatedAt: new Date().toISOString(),
        },
    });
    await saveOutputHistory({
      version: 2,
      entriesById: {
        entryPersonal: {
          id: "entryPersonal",
          sessionId: "sessionPersonal",
          profileId: "personal",
          createdAt: "2026-03-03T12:00:00.000Z",
          updatedAt: "2026-03-03T12:00:00.000Z",
          mode: "humanize",
          model: "writer/palmyra-x5",
          sourceText: "Personal source",
          baseOutputText: "Personal history",
          currentOutputText: "Personal history",
          title: "Personal history",
          status: "ready",
          formatPreset: "none",
          toneLevel: 2,
          stripCliches: true,
          elabDepth: 2,
          isSaved: false,
          savedAt: null,
        },
        entryWork: {
          id: "entryWork",
          sessionId: "sessionWork",
          profileId: "work",
          createdAt: "2026-03-04T12:00:00.000Z",
          updatedAt: "2026-03-04T12:00:00.000Z",
          mode: "humanize",
          model: "writer/palmyra-x5",
          sourceText: "Work source",
          baseOutputText: "Work history",
          currentOutputText: "Work history",
          title: "Work history",
          status: "ready",
          formatPreset: "none",
          toneLevel: 2,
          stripCliches: true,
          elabDepth: 2,
          isSaved: false,
          savedAt: null,
        },
      },
      sessionsById: {
        sessionPersonal: {
          id: "sessionPersonal",
          profileId: "personal",
          startedAt: "2026-03-03T12:00:00.000Z",
          updatedAt: "2026-03-03T12:00:00.000Z",
          mode: "humanize",
          sourceTextSnapshot: "Personal source",
          threadKey: "personal::humanize::Personal source",
          entryIds: ["entryPersonal"],
          activeEntryId: "entryPersonal",
        },
        sessionWork: {
          id: "sessionWork",
          profileId: "work",
          startedAt: "2026-03-04T12:00:00.000Z",
          updatedAt: "2026-03-04T12:00:00.000Z",
          mode: "humanize",
          sourceTextSnapshot: "Work source",
          threadKey: "work::humanize::Work source",
          entryIds: ["entryWork"],
          activeEntryId: "entryWork",
        },
      },
      globalEntryOrder: ["entryWork", "entryPersonal"],
    });

    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    const promptMock = vi.spyOn(window, "prompt").mockReturnValue("RESET PERSONAL");

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open output history" }));
    expect(within(await screen.findByRole("list", { name: "Global output history" })).getAllByRole("button")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset profile" }));
    await screen.findByRole("button", { name: "Start onboarding" });

    const history = await loadOutputHistory();
    expect(Object.values(history.entriesById).map((entry) => entry.profileId)).toEqual(["work"]);
    expect(Object.values(history.sessionsById).map((session) => session.profileId)).toEqual(["work"]);

    confirmMock.mockRestore();
    promptMock.mockRestore();
  });


  test("submits editor input with Enter", async () => {
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

    const editor = screen.getByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(editor, {
      target: { value: "This paragraph is long enough to trigger the plain Enter submit path in the editor." },
    });

    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
    });
  });

  test("submits markdown-formatted editor input with Enter", async () => {
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

    const markdownInput = "# Draft heading\n\n- first point\n- second point with details";
    const editor = screen.getByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(editor, { target: { value: markdownInput } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
      expect(streamCall[1].payload.messages[0].content).toContain(markdownInput);
    });
  });

  test("does not submit editor input with Shift+Enter", async () => {
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

    const editor = screen.getByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(editor, {
      target: { value: "This paragraph is long enough to verify Shift+Enter does not submit a request." },
    });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });

    expect(invokeMock.mock.calls.some(([command]) => command === "openrouter_chat_stream")).toBe(false);
  });

  test("prevents model request when input is below minimum length", async () => {
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

    const editor = screen.getByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(editor, { target: { value: "too short" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(screen.getByRole("button", { name: "Humanize text" })).toBeDisabled();
    expect(invokeMock.mock.calls.some(([command]) => command === "openrouter_chat_stream")).toBe(false);
  });

  test("submits elaborate-mode editor input with Enter at 10+ chars", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));

    const editor = screen.getByPlaceholderText("Write something to elaborate on…");
    const elaborateInput = "ten chars!";
    fireEvent.change(editor, { target: { value: elaborateInput } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
      expect(streamCall[1].payload.messages[0].content).toContain(elaborateInput);
    });
  });

  test("reopens API key modal when OpenRouter reports missing key", async () => {
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

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: false, source: "missing" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") {
        throw new Error("OpenRouter API key not found. Open app settings and save your key.");
      }
      if (command === "openrouter_chat") {
        return { content: [{ text: "ok" }] };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This is a long enough input to trigger the humanize request path." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    await screen.findByText("OpenRouter API Key");
    expect(await screen.findByRole("alert")).toHaveTextContent(/OpenRouter API key is missing, invalid, or unreadable\./i);
    fireEvent.click(screen.getByRole("button", { name: "Open logs drawer" }));
    expect(await screen.findByRole("log", { name: "Process log" })).toHaveTextContent("OpenRouter API key missing. Opening API key dialog.");
  });

  test("shows procedural logging for network failures", async () => {
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

    invokeMock.mockImplementation(async (command) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat_stream") throw new Error("Failed to reach OpenRouter: connection refused");
      if (command === "openrouter_chat") return { content: [{ text: "ok" }] };
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "This is a long enough input to trigger the humanize request path." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent(/The app could not reach OpenRouter\. Check your connection and API URL, then try again\./i);
    fireEvent.click(screen.getByRole("button", { name: "Open logs drawer" }));
    expect(await screen.findByRole("log", { name: "Process log" })).toHaveTextContent("Network request failed.");
  });

  test("keyboard shortcut submits rewrite requests", async () => {
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

    fireEvent.change(screen.getByPlaceholderText("Paste AI-generated text here…"), {
      target: { value: "Bad grammer in this paragraph for testing shortcuts and checks." },
    });

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(invokeMock.mock.calls.some(([command]) => command === "openrouter_chat_stream")).toBe(true);
    });
  });

});
