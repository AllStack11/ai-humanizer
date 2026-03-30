import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OutputPanel from "./OutputPanel.jsx";

let mockEditor = null;

function createMockEditor(text, selection = { from: 0, to: 0 }) {
  const listeners = new Map();
  const dispatch = vi.fn();
  const transaction = {
    setMeta(key, value) {
      return { key, value };
    },
  };

  return {
    isDestroyed: false,
    state: {
      selection: { ...selection },
      tr: transaction,
      doc: {
        content: { size: text.length },
        textBetween(from, to) {
          return text.slice(from, to);
        },
      },
    },
    view: {
      dom: {
        contains: () => true,
      },
      dispatch,
    },
    commands: {
      setContent: vi.fn(),
      setTextSelection: vi.fn(),
    },
    setEditable: vi.fn(),
    on(event, handler) {
      listeners.set(event, handler);
    },
    off(event) {
      listeners.delete(event);
    },
    getText() {
      return text;
    },
    __dispatch: dispatch,
    __listeners: listeners,
  };
}

vi.mock("@mantine/core", () => ({
  Tooltip: ({ children }) => children,
}));

vi.mock("@tiptap/core", () => ({
  Extension: {
    create: () => ({}),
  },
}));

vi.mock("@tiptap/react", () => ({
  useEditor: () => mockEditor,
  EditorContent: () => <div data-testid="mock-editor" />,
}));

vi.mock("@tiptap/starter-kit", () => ({
  default: {
    configure: () => ({}),
  },
}));

vi.mock("@tiptap/extension-placeholder", () => ({
  default: {
    configure: () => ({}),
  },
}));

vi.mock("../lib/tiptap-highlighter.js", () => ({
  DynamicHighlighter: {
    configure: () => ({}),
  },
  SelectionAwareHighlighter: {},
}));

vi.mock("../utils/diff.js", () => ({
  buildClicheRanges: () => [],
}));

vi.mock("../utils/markdown.js", () => ({
  renderMarkdownToHtml: (text) => text,
}));

vi.mock("./GenerationLoadingToast.jsx", () => ({
  default: () => null,
}));

vi.mock("./AppUI.jsx", () => {
  function Button({ children, onPress, isDisabled, iconOnly, tooltip, ...props }) {
    return (
      <button type="button" onClick={onPress} disabled={isDisabled} {...props}>
        {children}
      </button>
    );
  }

  function Card({ children, className }) {
    return <div className={className}>{children}</div>;
  }

  Card.Content = function CardContent({ children, className }) {
    return <div className={className}>{children}</div>;
  };

  function Spinner() {
    return <div aria-label="loading" />;
  }

  return { Button, Card, Spinner };
});

const baseProps = {
  mode: "humanize",
  originalText: "Original text",
  outputText: "alpha bravo charlie delta echo foxtrot",
  outputWords: 6,
  outputUsage: null,
  isStreaming: false,
  onOutputChange: vi.fn(),
  showDiff: false,
  onToggleDiff: vi.fn(),
  isEdited: false,
  readabilityBefore: 0,
  readabilityAfter: 0,
  metricSnapshotBefore: {
    fkgl: 0,
    gunningFog: 0,
    smog: 0,
    colemanLiau: 0,
    ari: 0,
    lexicalDiversity: 0,
    averageSentenceLength: 0,
    sentenceLengthVariance: 0,
    passiveVoiceRatio: 0,
    fillerDensity: 0,
    repetitionScore: 0,
    concretenessScore: 0,
  },
  metricSnapshotAfter: {
    fkgl: 0,
    gunningFog: 0,
    smog: 0,
    colemanLiau: 0,
    ari: 0,
    lexicalDiversity: 0,
    averageSentenceLength: 0,
    sentenceLengthVariance: 0,
    passiveVoiceRatio: 0,
    fillerDensity: 0,
    repetitionScore: 0,
    concretenessScore: 0,
  },
  delta: {
    beforeWords: 6,
    afterWords: 6,
    wordDelta: 0,
    beforeChars: 39,
    afterChars: 39,
    charDelta: 0,
  },
  copied: false,
  onCopy: vi.fn(),
  onRegenerate: vi.fn(),
  onRegenerateWithFeedback: vi.fn(),
  onCancelGeneration: vi.fn(),
  cliches: [],
  onPartialRegen: vi.fn(),
  isPartialStreaming: false,
  partialHighlight: null,
  onClearPartialHighlight: vi.fn(),
  progressLabel: "",
  progressTone: "neutral",
  processSteps: [],
};

describe("OutputPanel partial regeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor = createMockEditor(baseProps.outputText, { from: 2, to: baseProps.outputText.length - 2 });

    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      removeAllRanges: vi.fn(),
      getRangeAt: () => ({
        commonAncestorContainer: document.body,
        getBoundingClientRect: () => ({
          top: 20,
          bottom: 36,
          left: 0,
          right: 190,
          width: 190,
          height: 16,
        }),
      }),
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect() {
      if (this.classList?.contains("output-regen-zone")) {
        return { top: 0, left: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0 };
      }
      if (this.classList?.contains("selection-regen-tooltip")) {
        return { top: 0, left: 0, right: 80, bottom: 20, width: 80, height: 20, x: 0, y: 0 };
      }
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("expands partial-word selections before triggering partial regen", async () => {
    const onPartialRegen = vi.fn();
    render(<OutputPanel {...baseProps} onPartialRegen={onPartialRegen} />);

    fireEvent.pointerUp(document);
    fireEvent.click(await screen.findByText("Regenerate"));

    expect(onPartialRegen).toHaveBeenCalledWith(
      "alpha bravo charlie delta echo foxtrot",
      0,
      baseProps.outputText.length
    );
  });

  test("keeps the raw replacement end aligned to the full trailing word", async () => {
    const onPartialRegen = vi.fn();
    mockEditor = createMockEditor(baseProps.outputText, { from: 0, to: baseProps.outputText.length - 1 });
    render(<OutputPanel {...baseProps} onPartialRegen={onPartialRegen} />);

    fireEvent.pointerUp(document);
    fireEvent.click(await screen.findByText("Regenerate"));

    expect(onPartialRegen).toHaveBeenCalledWith(
      "alpha bravo charlie delta echo foxtrot",
      0,
      baseProps.outputText.length
    );
  });

  test("clamps the regenerate tooltip inside the output container", async () => {
    render(<OutputPanel {...baseProps} />);

    fireEvent.pointerUp(document);

    const tooltip = await screen.findByText("Regenerate");
    await waitFor(() => {
      expect(tooltip.parentElement).toHaveStyle({ left: "112px" });
    });
  });

  test("switches partial highlight from pending to completed and then clears it", async () => {
    const { rerender } = render(
      <OutputPanel
        {...baseProps}
        isPartialStreaming
        partialHighlight={{ rawStart: 0, rawEnd: 5, phase: "pending" }}
      />
    );

    await waitFor(() => {
      expect(mockEditor.__dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "selectionLock",
          value: expect.objectContaining({ className: "mark-regen-pending" }),
        })
      );
    });

    rerender(
      <OutputPanel
        {...baseProps}
        isPartialStreaming={false}
        partialHighlight={{ rawStart: 0, rawEnd: 5, phase: "completed" }}
      />
    );

    await waitFor(() => {
      expect(mockEditor.__dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "selectionLock",
          value: expect.objectContaining({ className: "mark-selection-completed" }),
        })
      );
    });

    rerender(<OutputPanel {...baseProps} partialHighlight={null} />);

    await waitFor(() => {
      expect(mockEditor.__dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "selectionLock",
          value: expect.objectContaining({ className: "" }),
        })
      );
    });
  });
});
