import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createTheme, MantineProvider } from "@mantine/core";
import App, {
  analyzeHumanizeInput,
  buildAiTermsStoragePayload,
  buildClicheRanges,
  buildDiffHighlightRanges,
  buildDiffSegments,
  buildHumanizeUserPrompt,
  buildMirrorSegments,
  buildVisibleAiTerms,
  collectCoverageGaps,
  computeProfileHealth,
  computeReadabilityScore,
  computeWordCharDelta,
  countWords,
  getFormatPresetInstruction,
  normalizeStoredAiTerms,
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

function buildStructuredStreamText(output, fieldName = "output") {
  return fieldName === "output" ? output : JSON.stringify({ [fieldName]: output });
}

function buildFinalizeResponse(args, fallback = "Hello world.") {
  const userPrompt = args?.payload?.messages?.[0]?.content || "";
  const draftMatch = userPrompt.match(/<draft_output>\n([\s\S]*?)\n<\/draft_output>/);
  const rawDraft = (draftMatch?.[1] || fallback).trim();
  const parsedDraft = (() => {
    try {
      const parsed = JSON.parse(rawDraft);
      return typeof parsed?.output === "string" ? parsed.output : rawDraft;
    } catch {
      return rawDraft;
    }
  })();
  const draft = parsedDraft
    .replace(/^Here is the rewritten text:\s*/i, "")
    .replace(/^Rewritten passage:\s*/i, "")
    .trim();
  return { content: [{ text: JSON.stringify({ output: draft }) }] };
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
        profile: { vocabulary: "plain and direct" },
        sampleEntries: [{ id: 1, text: "old sample", type: "general" }],
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    });

    expect(normalized.personal).toBeTruthy();
    expect(normalized.personal.name).toBe("Personal");
    expect(normalized.personal.sampleCount).toBe(1);
  });

  test("normalizeStoredStyles materializes built-in profiles with the same record shape", () => {
    const normalized = normalizeStoredStyles({});

    expect(normalized.personal).toMatchObject({
      id: "personal",
      name: "Personal",
      isCustom: false,
      profile: null,
      sampleEntries: [],
      sampleCount: 0,
    });
    expect(normalized.work).toMatchObject({
      id: "work",
      name: "Work",
      isCustom: false,
      profile: null,
      sampleEntries: [],
      sampleCount: 0,
    });
    expect(normalized.social).toMatchObject({
      id: "social",
      name: "Social Media",
      isCustom: false,
      profile: null,
      sampleEntries: [],
      sampleCount: 0,
    });
  });

  test("normalizeStoredStyles resolves legacy question sample type labels", () => {
    const normalized = normalizeStoredStyles({
      personal: {
        id: "personal",
        name: "Personal",
        profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
          sampleEntries: [{ id: 1, text: "old sample", type: "general" }],
        },
      },
      customModels: [
        { value: "custom/model-one", label: "Model One" },
        { value: "custom/model-one", label: "Duplicate label ignored" },
      ],
    });

    expect(normalized.styles.personal).toBeTruthy();
    expect(normalized.styles.work).toBeTruthy();
    expect(normalized.styles.social).toBeTruthy();
    expect(normalized.customModels).toEqual([{ value: "custom/model-one", label: "Model One" }]);
  });

  test("normalizeStoredProfileData migrates legacy customProfiles into style records", () => {
    const normalized = normalizeStoredProfileData(
      {
        styles: {},
        customModels: [],
      },
      [{ id: "freelance-pitches", label: "Freelance Pitches" }]
    );

    expect(normalized.styles["freelance-pitches"]).toMatchObject({
      id: "freelance-pitches",
      name: "Freelance Pitches",
      isCustom: true,
      profile: null,
      sampleCount: 0,
    });
  });

  test("normalizeStoredProfileData keeps custom profile labels on existing migrated records", () => {
    const normalized = normalizeStoredProfileData(
      {
        styles: {
          "freelance-pitches": {
            profile: { vocabulary: "direct" },
            sampleEntries: [{ id: 1, text: "Pitch sample", type: "general" }],
          },
        },
      },
      [{ id: "freelance-pitches", label: "Freelance Pitches" }]
    );

    expect(normalized.styles["freelance-pitches"]).toMatchObject({
      id: "freelance-pitches",
      name: "Freelance Pitches",
      isCustom: true,
    });
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

  test("normalizeStoredAiTerms migrates the legacy flat array shape", () => {
    const normalized = normalizeStoredAiTerms(["Delve", " robust ", "", "Delve"], "2026-03-31T10:00:00.000Z");

    expect(normalized).toEqual({
      generatedTerms: ["delve", "robust"],
      customTerms: [],
      punctuationTerms: [],
      hiddenTerms: [],
      updatedAt: "2026-03-31T10:00:00.000Z",
    });
  });

  test("buildVisibleAiTerms hides removed generated terms and keeps custom and punctuation terms separate", () => {
    const visible = buildVisibleAiTerms({
      generatedTerms: ["delve", "robust", "agentic slop", "—"],
      customTerms: ["agentic slop", "must-keep"],
      punctuationTerms: ["—", "..."],
      hiddenTerms: ["robust"],
    });

    expect(visible).toEqual({
      generatedTerms: ["delve"],
      customTerms: ["agentic slop", "must-keep"],
      punctuationTerms: ["—", "..."],
    });
  });

  test("buildAiTermsStoragePayload normalizes and preserves the structured AI term shape", () => {
    const payload = buildAiTermsStoragePayload({
      generatedTerms: [" Delve ", "robust"],
      customTerms: ["Must-Keep", "must-keep"],
      punctuationTerms: [" — ", "...", "..."],
      hiddenTerms: ["robust", ""],
      updatedAt: "2026-03-31T12:00:00.000Z",
    });

    expect(payload).toEqual({
      generatedTerms: ["delve", "robust"],
      customTerms: ["must-keep"],
      punctuationTerms: ["—", "..."],
      hiddenTerms: ["robust"],
      updatedAt: "2026-03-31T12:00:00.000Z",
    });
  });

  test("buildDiffSegments reports insertions and deletions", () => {
    const segments = buildDiffSegments("alpha beta", "alpha gamma beta");
    expect(segments.some((seg) => seg.type === "added" && seg.text.includes("gamma"))).toBe(true);
  });

  test("buildDiffHighlightRanges returns pane-specific ranges and ignores whitespace-only diffs", () => {
    expect(buildDiffHighlightRanges("alpha beta", "alpha  beta")).toEqual({
      before: [],
      after: [],
    });

    expect(buildDiffHighlightRanges("alpha beta", "alpha gamma beta")).toEqual({
      before: [],
      after: [{ start: 6, end: 11, class: "mark-diff-added" }],
    });

    expect(buildDiffHighlightRanges("alpha gamma beta", "alpha beta")).toEqual({
      before: [{ start: 6, end: 11, class: "mark-diff-removed" }],
      after: [],
    });
  });

  test("buildDiffHighlightRanges aligns rewritten response chunks before marking additions", () => {
    const before = "currently in llm output panel there is 4 buttons embedded within the editor. Move those buttons into a vertical toolbar that is rendered to the right of the llm output panel but inside the parent output panel";
    const after = "Currently, four buttons are embedded within the LLM output panel editor. These buttons should be relocated to a vertical toolbar, positioned to the right of the LLM output panel while remaining within the parent output panel.";

    const ranges = buildDiffHighlightRanges(before, after);
    const highlightedText = ranges.after.map((range) => after.slice(range.start, range.end));

    expect(ranges.before.length).toBeGreaterThan(0);
    expect(ranges.after.length).toBeGreaterThan(0);
    expect(highlightedText.join(" ")).toMatch(/four buttons|relocated|positioned|remaining/i);
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
    const prompt = buildHumanizeUserPrompt("Hey how are you doing today", { tone: 3 });

    expect(analysis.conversational).toBe(true);
    expect(analysis.questionLike).toBe(true);
    expect(prompt).toMatch(/style instructions already provided/i);
    expect(prompt).not.toMatch(/target voice/i);
    expect(prompt).toMatch(/Tone target: "Professional"/i);
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
    localStorage.setItem("cliches-v3", JSON.stringify({
      generatedTerms: ["delve"],
      customTerms: [],
      punctuationTerms: [],
      hiddenTerms: [],
      updatedAt: new Date().toISOString(),
    }));
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
      if (command === "openrouter_chat") return buildFinalizeResponse(args);
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("Hello world.");
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        await new Promise((resolve) => setTimeout(resolve, 40));
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
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
      if (command === "openrouter_chat") return buildFinalizeResponse(args);
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("Hello world.");
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
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

  test("starts with a clear editor after app remount even if the previous session had input", async () => {
    setStoredProfileData({
      personal: {
        id: "personal",
        name: "Personal",
        profile: { vocabulary: "plain and direct" },
        sampleEntries: [{ id: 1, text: "this is a sample entry with enough content", type: "general" }],
        sampleCount: 1,
        updatedAt: new Date().toISOString(),
      },
    });

    const firstRender = renderWithMantine(<App />);
    const firstEditor = await screen.findByPlaceholderText("Paste AI-generated text here…");
    fireEvent.change(firstEditor, {
      target: { value: "Draft from the first mounted app session." },
    });
    expect(firstEditor).toHaveValue("Draft from the first mounted app session.");

    firstRender.unmount();

    renderWithMantine(<App />);
    const secondEditor = await screen.findByPlaceholderText("Paste AI-generated text here…");
    expect(secondEditor).toHaveValue("");
    expect(secondEditor).not.toHaveValue("Draft from the first mounted app session.");
  });

  test("streams and applies one-off instructions plus output presets", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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
    expect(streamCall[1].payload.system).toMatch(/blog post/i);
    expect(streamCall[1].payload.messages[0].content).toMatch(/Extra instruction: make this sound more confident/i);
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
          profile: { vocabulary: "plain and direct" },
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
    fireEvent.change(screen.getByRole("combobox", { name: "Output format preset" }), {
      target: { value: "report" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Elaboration depth" }), {
      target: { value: "4" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Elaborate text" }));

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
    });

    const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
    expect(streamCall[1].payload.system).toMatch(/Preset requirement:/);
    expect(streamCall[1].payload.system).toMatch(/Format as a report/i);
    expect(streamCall[1].payload.system).toMatch(/Primary constraint: keep the elaboration deep but bounded/i);
    expect(streamCall[1].payload.system).toMatch(/Stop rule: once the thought has been extended enough/i);
    expect(streamCall[1].payload.system).not.toMatch(/add a concrete example at the end/i);
    expect(streamCall[1].payload.messages[0].content).toContain("<source_text>");
    expect(streamCall[1].payload.messages[0].content).toMatch(/Tone target: "Balanced"/i);
    expect(streamCall[1].payload.messages[0].content).toMatch(/Depth target: 7.?10 sentences\./i);
    expect(streamCall[1].payload.messages[0].content).toContain("Source format: plain_text.");
    expect(streamCall[1].payload.messages[0].content).toMatch(/Extra instruction: add a concrete example at the end/i);
    expect(await screen.findByRole("region", { name: "LLM output" })).toBeInTheDocument();
  });

  test("elaborate mode uses its own tone slider for prompt and temperature", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
          sampleEntries: [{ id: 1, text: "this is a sample entry with enough content", type: "general" }],
          sampleCount: 1,
          updatedAt: new Date().toISOString(),
        },
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.change(screen.getByRole("slider", { name: "Rewrite tone" }), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));
    fireEvent.change(screen.getByRole("slider", { name: "Elaborate tone" }), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByPlaceholderText("Write something to elaborate on…"), {
      target: { value: "A concise draft that should expand in a more formal register." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Elaborate text" }));

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
    });

    const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
    expect(streamCall[1].payload.messages[0].content).toMatch(/Tone target: "Formal"/i);
    expect(streamCall[1].payload.messages[0].content).not.toMatch(/Tone target: "Very Casual"/i);
    expect(streamCall[1].payload.temperature).toBe(0.6);
  });

  test("keeps plain-text elaborate requests out of markdown mode for non-structured presets", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
          sampleEntries: [{ id: 1, text: "this is a sample entry with enough content", type: "general" }],
          sampleCount: 1,
          updatedAt: new Date().toISOString(),
        },
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));
    fireEvent.change(screen.getByPlaceholderText("Write something to elaborate on…"), {
      target: { value: "Plain text draft that should stay plain even when we elaborate it further." },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Output format preset" }), {
      target: { value: "email" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Elaborate text" }));

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
    });

    const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
    expect(streamCall[1].payload.system).toMatch(/Keep the output plain text as well/i);
    expect(streamCall[1].payload.system).not.toMatch(/source already uses markdown/i);
    expect(streamCall[1].payload.system).not.toMatch(/light preset-appropriate structure/i);
    expect(streamCall[1].payload.messages[0].content).toContain("Source format: plain_text.");
  });

  test("preserves markdown guidance for markdown elaborate input", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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
      if (command === "openrouter_chat") return buildFinalizeResponse(args, "First sentence. Second sentence. Third sentence.");
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("First sentence. Second sentence. Third sentence.");
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);
    await screen.findByRole("button", { name: /add personal samples/i });

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));
    fireEvent.change(screen.getByPlaceholderText("Write something to elaborate on…"), {
      target: { value: "# Draft heading\n\n- first point\n- second point" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Elaborate text" }));

    await waitFor(() => {
      const streamCall = invokeMock.mock.calls.find(([command]) => command === "openrouter_chat_stream");
      expect(streamCall).toBeTruthy();
    });

    const streamCall = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream").at(-1);
    expect(streamCall[1].payload.system).toMatch(/source already uses markdown/i);
    expect(streamCall[1].payload.system).toMatch(/Preserve that markdown style/i);
    expect(streamCall[1].payload.messages[0].content).toContain("Source format: markdown.");
  });

  test("submits a single elaborate request for the selected very-short depth", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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
      if (command === "openrouter_chat") return buildFinalizeResponse(args, "First sentence. Second sentence. Third sentence.");
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("First sentence. Second sentence. Third sentence.");
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
    fireEvent.change(screen.getByPlaceholderText("Write something to elaborate on…"), {
      target: { value: "Keep this thought moving." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Elaborate text" }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "LLM output" })).toHaveTextContent("First sentence. Second sentence. Third sentence.");
    });

    const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0][1].payload.system).toMatch(/Primary constraint: keep the elaboration very short/i);
    expect(streamCalls[0][1].payload.system).not.toMatch(/Depth target:/i);
    expect(streamCalls[0][1].payload.system).toMatch(/brief follow-on detail or clarification/i);
    expect(streamCalls[0][1].payload.system).toMatch(/Do not add setup, recap, transition sentences, conclusions, or extra examples/i);
    expect(streamCalls[0][1].payload.messages[0].content).toMatch(/Tone target: "Balanced"/i);
    expect(streamCalls[0][1].payload.messages[0].content).toMatch(/Depth target: 1.?2 short sentences\./i);
  });

  test.skip("stores one-off instructions in output history entries", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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

  test("keeps a single humanize request and strips wrapper text from the output", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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
      if (command === "openrouter_chat") return buildFinalizeResponse(args, "hey how are you doing today?");
      if (command === "openrouter_chat_stream") {
        streamCount += 1;
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText(
          streamCount === 1
            ? "Here is the rewritten text:\nhey how are you doing today?"
            : "hey how are you doing today?"
        );
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
      const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
      expect(streamCalls).toHaveLength(1);
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "LLM output" })).toHaveTextContent("hey how are you doing today?");
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Open logs drawer" }));
    expect(await screen.findByRole("log", { name: "Process log" })).toHaveTextContent(
      "Streaming finished. Applying final cleanup."
    );
    expect(screen.getByRole("log", { name: "Process log" })).toHaveTextContent(
      "Removed wrapper text from the generated output."
    );

    const streamCalls = invokeMock.mock.calls.filter(([command]) => command === "openrouter_chat_stream");
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0][1].payload.messages[0].content).toMatch(/Tone target: "Balanced"/i);
    expect(streamCalls[0][1].payload.messages[0].content).toMatch(/Do not answer it/i);
    expect(invokeMock.mock.calls.some(([command]) => command === "openrouter_chat")).toBe(false);
  });

  test("strips leaked thinking blocks from streamed humanize output and logs the cleanup", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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
      if (command === "openrouter_chat") return buildFinalizeResponse(args, "hey how are you doing today?");
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = `<thinking>
Need to inspect the target voice first.
</thinking>

hey how are you doing today?`;
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

    expect(screen.getByRole("region", { name: "LLM output" })).not.toHaveTextContent("Need to inspect the target voice first.");
    expect(screen.getByRole("region", { name: "LLM output" })).not.toHaveTextContent("<thinking>");

    fireEvent.click(screen.getByRole("button", { name: "Open logs drawer" }));
    expect(await screen.findByRole("log", { name: "Process log" })).toHaveTextContent(
      "Removed reasoning text from the generated output."
    );
  });

  test("shows active generation logs at the bottom of the output panel and hides them after streaming completes", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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
      if (command === "openrouter_chat") return buildFinalizeResponse(args);
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("Hello world.");
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
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
    expect(generationLog).toHaveTextContent(/Preparing prompt and opening model stream\./i);
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
          profile: { vocabulary: "plain and direct" },
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
      if (command === "openrouter_chat") return buildFinalizeResponse(args, "Hello again");
      if (command === "openrouter_chat_stream") {
        streamCallCount += 1;
        if (streamCallCount === 1) {
          return new Promise(() => {});
        }
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("Hello again");
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
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
          profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText(`History output ${streamCount}`);
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText(`Regenerated output ${streamCount}`);
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText(`Collapsible output ${streamCount}`);
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText(`Feedback output ${streamCount}`);
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText("Shared preview expansion output that is long enough to wrap into multiple lines for the session history card.");
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText("Immutable history output");
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText(`Session continuity output ${streamCount}`);
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText(`Mode switch continuity output ${streamCount}`);
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText("Single session output");
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
          profile: { vocabulary: "plain and direct" },
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
      if (command === "openrouter_chat") {
        return buildFinalizeResponse(args, "Persistent LLM output across mode switch");
      }
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("Persistent LLM output across mode switch");
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
      expect(screen.getByRole("region", { name: "LLM output" })).toHaveTextContent("Persistent LLM output across mode switch");
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to elaborate mode" }));

    expect(screen.getByRole("region", { name: "LLM output" })).toHaveTextContent("Persistent LLM output across mode switch");
  });

  test.skip("treats send after editing source text as a regeneration in the same session", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText(`Edited source regen output ${streamCount}`);
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText(`New chat output ${streamCount}`);
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText("Archive management output");
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
          profile: { vocabulary: "plain and direct" },
          sampleEntries: [{ id: 1, text: "enough content for personal", type: "general" }],
          sampleCount: 1,
          updatedAt: new Date().toISOString(),
        },
        work: {
          id: "work",
          name: "Work",
          profile: { vocabulary: "professional and clear" },
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText("Unsaved archive result");
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
          profile: { vocabulary: "plain and direct" },
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
        const fullText = buildStructuredStreamText("Persisted across remount");
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
          profile: { vocabulary: "plain and direct" },
          sampleEntries: [{ id: 1, text: "this is a sample entry with enough content", type: "general" }],
          sampleCount: 1,
          updatedAt: new Date().toISOString(),
        },
        work: {
          id: "work",
          name: "Work",
          profile: { vocabulary: "professional and clear" },
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
          profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
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
          profile: { vocabulary: "plain and direct" },
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

  test("preserves custom AI terms when a manual refresh resolves after the custom term is added", async () => {
    let resolveRefresh;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") {
        await refreshPromise;
        return {
          content: [{
            text: JSON.stringify(Array.from({ length: 24 }, (_, i) => `fresh-term-${i + 1}`)),
          }],
        };
      }
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("Hello world.");
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "View AI terms" }));
    const addTermInput = await screen.findByPlaceholderText("Add a term…");

    fireEvent.click(screen.getByRole("button", { name: "Refresh AI terms" }));
    fireEvent.change(addTermInput, {
      target: { value: "my custom phrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add term" }));

    await waitFor(() => {
      expect(screen.getByText("my custom phrase")).toBeInTheDocument();
    });

    resolveRefresh();

    await waitFor(() => {
      expect(screen.getByText("fresh-term-1")).toBeInTheDocument();
      expect(screen.getByText("my custom phrase")).toBeInTheDocument();
    });

    const storedTerms = JSON.parse(localStorage.getItem("cliches-v3"));
    expect(storedTerms.customTerms).toContain("my custom phrase");
    expect(storedTerms.generatedTerms).toContain("fresh-term-1");
  });

  test("clears all AI terms from the settings drawer and resets stored AI term state", async () => {
    localStorage.setItem("cliches-v3", JSON.stringify({
      generatedTerms: ["delve", "robust"],
      customTerms: ["must-keep"],
      punctuationTerms: ["—"],
      hiddenTerms: ["hidden-buzzword"],
      updatedAt: "2026-03-31T12:00:00.000Z",
    }));
    localStorage.setItem("cliches-ts-v3", JSON.stringify("2026-03-31T12:00:00.000Z"));

    renderWithMantine(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByText("4 active terms")).toBeInTheDocument();
      expect(screen.getByText("1 generated term hidden locally")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear all AI terms" }));

    await waitFor(() => {
      expect(screen.getByText("0 active terms")).toBeInTheDocument();
      expect(screen.queryByText("1 generated term hidden locally")).not.toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole("button", { name: "View AI terms" }));

    await waitFor(() => {
      expect(screen.queryByText("must-keep")).not.toBeInTheDocument();
      expect(screen.queryByText("—")).not.toBeInTheDocument();
      expect(screen.queryByText("delve")).not.toBeInTheDocument();
      expect(screen.queryByText("robust")).not.toBeInTheDocument();
      expect(screen.getByText("Custom terms (0)")).toBeInTheDocument();
      expect(screen.getByText("Punctuation bans (0)")).toBeInTheDocument();
      expect(screen.getByText("Generated terms (0)")).toBeInTheDocument();
    });

    const storedTerms = JSON.parse(localStorage.getItem("cliches-v3"));
    expect(storedTerms).toEqual({
      generatedTerms: [],
      customTerms: [],
      punctuationTerms: [],
      hiddenTerms: [],
      updatedAt: null,
    });
  });

  test("adds punctuation bans from the AI terms modal and persists them", async () => {
    renderWithMantine(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "View AI terms" }));
    await screen.findByText("Punctuation bans (0)");
    fireEvent.change(screen.getByPlaceholderText("Add punctuation…"), {
      target: { value: "—" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add punctuation" }));

    await waitFor(() => {
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    const storedTerms = JSON.parse(localStorage.getItem("cliches-v3"));
    expect(storedTerms.punctuationTerms).toContain("—");
  });

  test("caps refreshed generated AI terms so the list does not keep growing", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "has_api_key") return true;
      if (command === "get_api_key_status") return { hasKey: true, source: "test" };
      if (command === "get_styles_backup") return { styles: {}, savedAt: null };
      if (command === "save_styles_backup") return { ok: true, savedAt: new Date().toISOString() };
      if (command === "get_request_logs") return { logs: [] };
      if (command === "openrouter_chat") {
        return {
          content: [{
            text: JSON.stringify(Array.from({ length: 95 }, (_, i) => `fresh-term-${i + 1}`)),
          }],
        };
      }
      if (command === "openrouter_chat_stream") {
        const requestId = args.requestId;
        const fullText = buildStructuredStreamText("Hello world.");
        streamListener?.({ payload: { requestId, chunk: fullText, fullText, done: false, error: null } });
        streamListener?.({ payload: { requestId, chunk: null, fullText, done: true, error: null } });
        return { ok: true };
      }
      return { ok: true };
    });

    renderWithMantine(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Refresh AI terms" }));

    await waitFor(() => {
      const storedTerms = JSON.parse(localStorage.getItem("cliches-v3"));
      expect(storedTerms.generatedTerms).toHaveLength(60);
      expect(storedTerms.generatedTerms[0]).toBe("fresh-term-1");
      expect(storedTerms.generatedTerms[59]).toBe("fresh-term-60");
    });
  });

  test("keyboard shortcut submits rewrite requests", async () => {
    setStoredProfileData({
        personal: {
          id: "personal",
          name: "Personal",
          profile: { vocabulary: "plain and direct" },
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
