import { useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "@mantine/core";
import { Extension } from "@tiptap/core";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Button, Card, Spinner } from "./AppUI.jsx";
import GenerationLoadingToast from "./GenerationLoadingToast.jsx";
import { renderMarkdownToHtml } from "../utils/markdown.js";
import { DynamicHighlighter, SelectionAwareHighlighter } from "../lib/tiptap-highlighter.js";
import { buildClicheRanges, buildDiffHighlightRanges } from "../utils/diff.js";
import {
  estimateTokenCount,
  expandSelectionToWordBoundaries,
  mapRawOffsetToVisibleOffset,
  mapVisibleOffsetToRawOffset,
} from "../utils/index.js";

const EDITOR_BLOCK_SEPARATOR = "\n\n";
const OUTPUT_EDITOR_KEYS_EXTENSION = Extension.create({
  name: "outputEditorKeys",
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => false,
    };
  },
});

function getEditorText(editor) {
  return editor.getText({ blockSeparator: EDITOR_BLOCK_SEPARATOR });
}

function countPanelWords(text) {
  return String(text || "").trim() ? String(text || "").trim().split(/\s+/).length : 0;
}

function findEditorPosForVisibleOffset(doc, targetOffset) {
  const maxPos = doc.content.size;
  const clampedTarget = Math.max(0, Math.min(Number(targetOffset) || 0, doc.textBetween(0, maxPos, EDITOR_BLOCK_SEPARATOR, EDITOR_BLOCK_SEPARATOR).length));
  let low = 0;
  let high = maxPos;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const currentLength = doc.textBetween(0, mid, EDITOR_BLOCK_SEPARATOR, EDITOR_BLOCK_SEPARATOR).length;
    if (currentLength < clampedTarget) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

// Read-only TipTap display editor with full markdown rendering, cliché highlighting,
// and selection-aware highlight decorations.
function OutputDisplayEditor({
  outputText,
  cliches,
  extraHighlightRanges = [],
  lockedHighlight,
  rawHighlight,
  isPartialStreaming,
  onSelectionReady,
  onSelectionClear,
  onClearCompletedHighlight,
  containerRef,
  enableSelectionActions = true,
}) {
  const wrapperRef = useRef(null);

  const editor = useEditor({
    editable: true, // keep editable so TipTap tracks selection state
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit,
      DynamicHighlighter.configure({
        getRanges: (text) => {
          if (!text) return [];
          return [
            ...buildClicheRanges(text, cliches).map((r) => ({ start: r.start, end: r.end, kind: "cliche" })),
            ...extraHighlightRanges,
          ];
        },
      }),
      SelectionAwareHighlighter,
    ],
    content: renderMarkdownToHtml(outputText),
    editorProps: {
      // Block all input so the editor is visually read-only
      handleDOMEvents: {
        beforeinput: () => true,
        paste: () => true,
        drop: () => true,
      },
      attributes: { class: "output-display-tiptap", spellcheck: "false" },
    },
  });

  // Update content when outputText changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(renderMarkdownToHtml(outputText || ""), false);
  }, [editor, outputText]);

  // Refresh cliché decorations when cliches list changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta("dynamicHighlighterUpdate", true));
  }, [editor, cliches, extraHighlightRanges]);

  // Drive the selection-lock decoration from props
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (rawHighlight?.rawEnd > rawHighlight?.rawStart) {
      const visibleFrom = mapRawOffsetToVisibleOffset(outputText, rawHighlight.rawStart);
      const visibleTo = mapRawOffsetToVisibleOffset(outputText, rawHighlight.rawEnd);
      const from = findEditorPosForVisibleOffset(editor.state.doc, visibleFrom);
      const to = findEditorPosForVisibleOffset(editor.state.doc, visibleTo);
      const className = rawHighlight.phase === "completed" ? "mark-selection-completed" : "mark-regen-pending";
      editor.view.dispatch(
        editor.state.tr.setMeta("selectionLock", { from, to, className })
      );
    } else if (lockedHighlight) {
      const className = isPartialStreaming ? "mark-regen-pending" : "mark-selection-active";
      editor.view.dispatch(
        editor.state.tr.setMeta("selectionLock", { from: lockedHighlight.from, to: lockedHighlight.to, className })
      );
    } else {
      editor.view.dispatch(
        editor.state.tr.setMeta("selectionLock", { from: 0, to: 0, className: "" })
      );
    }
  }, [editor, lockedHighlight, rawHighlight, isPartialStreaming, outputText]);

  // Live selection → CSS class on wrapper only (no React state → no re-render → selection never disrupted)
  useEffect(() => {
    if (!editor || !enableSelectionActions) return;
    function onSelectionUpdate({ editor: ed }) {
      const { from, to } = ed.state.selection;
      if (from === to) { wrapperRef.current?.classList.remove("has-valid-selection"); return; }
      const fullText = ed.state.doc.textBetween(0, ed.state.doc.content.size, EDITOR_BLOCK_SEPARATOR, EDITOR_BLOCK_SEPARATOR);
      const visibleFrom = ed.state.doc.textBetween(0, from, EDITOR_BLOCK_SEPARATOR, EDITOR_BLOCK_SEPARATOR).length;
      const visibleTo = ed.state.doc.textBetween(0, to, EDITOR_BLOCK_SEPARATOR, EDITOR_BLOCK_SEPARATOR).length;
      const expanded = expandSelectionToWordBoundaries(fullText, visibleFrom, visibleTo);
      const words = expanded.text.trim().split(/\s+/).filter(Boolean).length;
      wrapperRef.current?.classList.toggle("has-valid-selection", words >= 6);
    }
    editor.on("selectionUpdate", onSelectionUpdate);
    return () => editor.off("selectionUpdate", onSelectionUpdate);
  }, [editor]);

  // Tooltip on pointer release (single state update, after selection is final)
  useEffect(() => {
    if (!editor || !enableSelectionActions) return;
    function onPointerUp() {
      if (isPartialStreaming) return;
      const { from, to } = editor.state.selection;
      if (from === to) { onSelectionClear(); return; }
      // Verify selection is inside this editor
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { onSelectionClear(); return; }
      if (!editor.view.dom.contains(sel.getRangeAt(0).commonAncestorContainer)) { onSelectionClear(); return; }
      const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, EDITOR_BLOCK_SEPARATOR, EDITOR_BLOCK_SEPARATOR);
      const visibleFrom = editor.state.doc.textBetween(0, from, EDITOR_BLOCK_SEPARATOR, EDITOR_BLOCK_SEPARATOR).length;
      const visibleTo = editor.state.doc.textBetween(0, to, EDITOR_BLOCK_SEPARATOR, EDITOR_BLOCK_SEPARATOR).length;
      const expanded = expandSelectionToWordBoundaries(fullText, visibleFrom, visibleTo);
      const expandedFrom = findEditorPosForVisibleOffset(editor.state.doc, expanded.start);
      const expandedTo = findEditorPosForVisibleOffset(editor.state.doc, expanded.end);
      const rawSelection = expandSelectionToWordBoundaries(
        outputText,
        mapVisibleOffsetToRawOffset(outputText, expanded.start),
        mapVisibleOffsetToRawOffset(outputText, expanded.end)
      );
      const rawStart = rawSelection.start;
      const rawEnd = rawSelection.end;
      const words = expanded.text.trim().split(/\s+/).filter(Boolean).length;
      if (words < 6) { onSelectionClear(); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      onClearCompletedHighlight?.();
      onSelectionReady({
        text: expanded.text,
        from: expandedFrom,
        to: expandedTo,
        rawStart,
        rawEnd,
        anchorX: rect.right - containerRect.left,
        anchorTop: rect.top - containerRect.top,
        anchorBottom: rect.bottom - containerRect.top,
      });
    }
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, [editor, enableSelectionActions, isPartialStreaming, outputText, onClearCompletedHighlight]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapperRef} className="output-display-editor-wrap">
      <EditorContent editor={editor} />
    </div>
  );
}

function SelectionRegenTooltip({ tooltip, isLoading, onRegenerate, onDismiss, containerRef }) {
  const tooltipRef = useRef(null);
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!tooltip || !tooltipRef.current || !containerRef.current) {
      setPosition(null);
      return;
    }

    const gutter = 8;
    const verticalGap = 6;
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const maxLeft = Math.max(gutter, containerRect.width - tooltipRect.width - gutter);
    const left = Math.min(Math.max(tooltip.anchorX, gutter), maxLeft);

    let top = tooltip.anchorBottom + verticalGap;
    if (top + tooltipRect.height + gutter > containerRect.height) {
      top = Math.max(gutter, tooltip.anchorTop - tooltipRect.height - verticalGap);
    }

    setPosition({ left, top });
  }, [tooltip, containerRef, isLoading]);

  if (!tooltip) return null;
  return (
    <div
      ref={tooltipRef}
      className="selection-regen-tooltip"
      style={{ left: position?.left ?? tooltip.anchorX, top: position?.top ?? tooltip.anchorBottom + 6 }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {isLoading ? (
        <Spinner size="xs" />
      ) : (
        <button
          className="selection-regen-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onRegenerate}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 2v6h-6"/>
            <path d="M3 22v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.13-3.36L21 8"/>
            <path d="M20.49 15a9 9 0 0 1-14.13 3.36L3 16"/>
          </svg>
          Regenerate
        </button>
      )}
      {!isLoading && (
        <button className="selection-regen-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18"/>
            <path d="m6 6 12 12"/>
          </svg>
        </button>
      )}
    </div>
  );
}

const READABILITY_TOOLTIP = (
  <div className="output-readability-tooltip">
    <strong>Readability score</strong>
    <span>
      This is a Flesch Reading Ease estimate. Higher scores usually mean the text is easier to read.
    </span>
    <span>
      It is derived from sentence length and estimated syllables per word: 206.835 - 1.015 x
      (words / sentences) - 84.6 x (syllables / words).
    </span>
    <span>
      In this app, syllables are approximated from vowel groups, so treat the number as a quick directional signal.
    </span>
  </div>
);

const METRIC_TOOLTIP_COPY = {
  fkgl: {
    title: "Flesch-Kincaid Grade Level",
    description: "Estimated U.S. school grade needed to understand the text.",
    interpretation: "Lower is generally easier for broad audiences.",
  },
  gunningFog: {
    title: "Gunning Fog Index",
    description: "Readability estimate based on sentence length and complex-word usage.",
    interpretation: "Lower means simpler, more direct prose.",
  },
  smog: {
    title: "SMOG Index",
    description: "Grade-level estimate based on polysyllabic words across sentences.",
    interpretation: "Lower usually means easier to read quickly.",
  },
  colemanLiau: {
    title: "Coleman-Liau Index",
    description: "Grade-level estimate using letters per word and sentence length.",
    interpretation: "Lower indicates less dense writing.",
  },
  ari: {
    title: "Automated Readability Index",
    description: "Grade-level estimate using characters per word and words per sentence.",
    interpretation: "Lower is generally more approachable.",
  },
  lexicalDiversity: {
    title: "Lexical Diversity",
    description: "Unique words divided by total words (shown as percent).",
    interpretation: "Higher can mean more variety; very high may feel less consistent in tone.",
  },
  averageSentenceLength: {
    title: "Average Sentence Length",
    description: "Average number of words per sentence.",
    interpretation: "Shorter often feels clearer; longer can add nuance but may reduce scanability.",
  },
  sentenceLengthVariance: {
    title: "Sentence Length Variance",
    description: "How uneven sentence lengths are throughout the text.",
    interpretation: "Moderate variance often sounds natural; extremes may feel choppy or rambling.",
  },
  passiveVoiceRatio: {
    title: "Passive Voice Ratio",
    description: "Share of sentences flagged as likely passive voice (shown as percent).",
    interpretation: "Lower often feels more direct and active.",
  },
  fillerDensity: {
    title: "Filler Density",
    description: "Filler or hedging terms per 100 words.",
    interpretation: "Lower usually sounds more confident and concise.",
  },
  repetitionScore: {
    title: "Repetition Score",
    description: "Repeated trigram phrases as a percentage of total trigrams.",
    interpretation: "Lower reduces redundancy; high values can indicate looping phrasing.",
  },
  concretenessScore: {
    title: "Concreteness Score",
    description: "Proxy estimate of concrete wording versus abstract wording (shown as percent).",
    interpretation: "Higher often feels more tangible and specific.",
  },
};

const EXTRA_METRICS = [
  { key: "fkgl", label: "FKGL" },
  { key: "gunningFog", label: "Fog" },
  { key: "smog", label: "SMOG" },
  { key: "colemanLiau", label: "CLI" },
  { key: "ari", label: "ARI" },
  { key: "lexicalDiversity", label: "LexDiv", percent: true, ratio: true },
  { key: "averageSentenceLength", label: "Avg Sent" },
  { key: "sentenceLengthVariance", label: "Sent Var" },
  { key: "passiveVoiceRatio", label: "Passive", percent: true, ratio: true },
  { key: "fillerDensity", label: "Filler/100w", percent: true },
  { key: "repetitionScore", label: "Repeat", percent: true },
  { key: "concretenessScore", label: "Concrete", percent: true },
];

const COLLAPSED_METRIC_PREVIEW = [
  { key: "readability", label: "Readability" },
  { key: "fkgl", label: "FKGL" },
  { key: "inputTokens", label: "Input tokens" },
  { key: "outputTokens", label: "Output tokens" },
];

const METRIC_DIRECTION = {
  readability: "higher",
  fkgl: "lower",
  gunningFog: "lower",
  smog: "lower",
  colemanLiau: "lower",
  ari: "lower",
  lexicalDiversity: "higher",
  averageSentenceLength: "lower",
  sentenceLengthVariance: "lower",
  passiveVoiceRatio: "lower",
  fillerDensity: "lower",
  repetitionScore: "lower",
  concretenessScore: "higher",
  inputTokens: "neutral",
  outputTokens: "neutral",
  words: "neutral",
  chars: "neutral",
  draftState: "neutral",
};

function formatMetricValue(value, options = {}) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const scaled = options.ratio ? numeric * 100 : numeric;
  const rounded = Math.round(scaled * 10) / 10;
  return options.percent ? `${rounded}%` : `${rounded}`;
}

function getCollapsedMetricValue(metricKey, {
  readabilityAfter, metricSnapshotAfter, delta, inputTokenCount, inputTokenIsEstimated, outputTokenCount, outputTokenIsEstimated,
}) {
  if (metricKey === "readability") return formatMetricValue(readabilityAfter);
  if (metricKey === "words") return formatMetricValue(delta?.afterWords);
  if (metricKey === "inputTokens") return `${inputTokenIsEstimated ? "~" : ""}${formatMetricValue(inputTokenCount)}`;
  if (metricKey === "outputTokens") return `${outputTokenIsEstimated ? "~" : ""}${formatMetricValue(outputTokenCount)}`;

  const metric = EXTRA_METRICS.find((item) => item.key === metricKey);
  return formatMetricValue(metricSnapshotAfter?.[metricKey], metric);
}

function getMetricTrend(metricKey, beforeValue, afterValue, tolerance = 0.001) {
  const before = Number(beforeValue);
  const after = Number(afterValue);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return "neutral";
  if (Math.abs(after - before) <= tolerance) return "neutral";

  const direction = METRIC_DIRECTION[metricKey] || "neutral";
  if (direction === "higher") return after > before ? "better" : "worse";
  if (direction === "lower") return after < before ? "better" : "worse";
  return after > before ? "up" : "down";
}

function MetricTooltipContent({ metric }) {
  const copy = METRIC_TOOLTIP_COPY[metric.key];
  if (!copy) return null;
  return (
    <div className="output-readability-tooltip">
      <strong>{copy.title}</strong>
      <span>{copy.description}</span>
      <span>{copy.interpretation}</span>
    </div>
  );
}

function MetricIcon({ metricKey }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    className: "output-metric-icon",
  };

  if (metricKey === "readability") return <svg {...common}><path d="M4 19V5" /><path d="M10 19V9" /><path d="M16 19v-6" /><path d="M22 19v-9" /></svg>;
  if (metricKey === "fkgl" || metricKey === "gunningFog" || metricKey === "smog" || metricKey === "colemanLiau" || metricKey === "ari") {
    return <svg {...common}><path d="M4 20h16" /><path d="m7 16 4-4 3 2 4-6" /></svg>;
  }
  if (metricKey === "lexicalDiversity") return <svg {...common}><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><circle cx="12" cy="16" r="3" /></svg>;
  if (metricKey === "averageSentenceLength" || metricKey === "sentenceLengthVariance") return <svg {...common}><path d="M4 7h16" /><path d="M4 12h10" /><path d="M4 17h13" /></svg>;
  if (metricKey === "passiveVoiceRatio") return <svg {...common}><path d="M4 12h9" /><path d="m10 9 3 3-3 3" /><path d="M20 7v10" /></svg>;
  if (metricKey === "fillerDensity") return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>;
  if (metricKey === "repetitionScore") return <svg {...common}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>;
  if (metricKey === "concretenessScore") return <svg {...common}><path d="m12 2 8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-4Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (metricKey === "inputTokens") return <svg {...common}><path d="M20 12H6" /><path d="m10 8-4 4 4 4" /><rect x="4" y="5" width="16" height="14" rx="2" /></svg>;
  if (metricKey === "outputTokens") return <svg {...common}><path d="M4 12h14" /><path d="m14 8 4 4-4 4" /><rect x="4" y="5" width="16" height="14" rx="2" /></svg>;
  if (metricKey === "words") return <svg {...common}><path d="M4 5h16" /><path d="M4 12h12" /><path d="M4 19h8" /></svg>;
  if (metricKey === "chars") return <svg {...common}><path d="M4 20 10 4l6 16" /><path d="M6 14h8" /></svg>;
  if (metricKey === "draftState") return <svg {...common}><path d="m4 20 4-1 10-10-3-3L5 16l-1 4Z" /><path d="m13 6 3 3" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
}

function MetricLabel({ metricKey, label }) {
  return (
    <span className="output-metric-label">
      <MetricIcon metricKey={metricKey} />
      <span className="text-mono output-toolbar-metric">{label}</span>
    </span>
  );
}

function MetricsPanel({
  readabilityBefore,
  readabilityAfter,
  metricSnapshotBefore,
  metricSnapshotAfter,
  inputTokenCount,
  inputTokenIsEstimated,
  outputTokenCount,
  outputTokenIsEstimated,
  delta,
  isEdited,
}) {
  const [open, setOpen] = useState(false);
  const trackedMetricCount = EXTRA_METRICS.length + 6;

  return (
    <section className={`output-metrics-panel${open ? " is-open" : ""}`} aria-label="Text metrics">
      <button
        type="button"
        className="output-metrics-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={open ? "Collapse text metrics" : "Expand text metrics"}
      >
        <span className="output-metrics-toggle-labels">
          <span className="text-mono output-metrics-toggle-title">Text metrics</span>
          {!open ? (
            <span className="output-metrics-toggle-preview" aria-hidden="true">
              {COLLAPSED_METRIC_PREVIEW.map((metric) => (
                <span
                  key={metric.key}
                  className="output-metrics-toggle-preview-item"
                  title={metric.label}
                >
                  <span className="output-metrics-toggle-preview-icon">
                    <MetricIcon metricKey={metric.key} />
                  </span>
                  <span className="output-metrics-toggle-preview-copy">
                    <span className="text-mono output-metrics-toggle-preview-value">
                      {getCollapsedMetricValue(metric.key, {
                        readabilityAfter,
                        metricSnapshotAfter,
                        delta,
                        inputTokenCount,
                        inputTokenIsEstimated,
                        outputTokenCount,
                        outputTokenIsEstimated,
                      })}
                    </span>
                  </span>
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <span className="output-metrics-toggle-meta">
          <span className="text-mono output-toolbar-metric">{trackedMetricCount} tracked</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points={open ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="output-metrics-grid">
          <div className={`output-metric-item output-metric-item--${getMetricTrend("readability", readabilityBefore, readabilityAfter, 0.05)}`}>
            <Tooltip label={READABILITY_TOOLTIP} withArrow multiline maw={320} openDelay={500}>
              <span className="output-toolbar-metric--interactive" tabIndex={0} role="note">
                <MetricLabel metricKey="readability" label="Readability" />
              </span>
            </Tooltip>
            <span className="text-mono output-toolbar-metric">{readabilityBefore}</span>
            <span className="text-mono output-toolbar-metric">→</span>
            <span className={`text-mono output-toolbar-metric output-metric-value output-metric-value--${getMetricTrend("readability", readabilityBefore, readabilityAfter, 0.05)}`}>{readabilityAfter}</span>
          </div>
          {EXTRA_METRICS.map((metric) => (
            <div key={metric.key} className={`output-metric-item output-metric-item--${getMetricTrend(metric.key, metricSnapshotBefore?.[metric.key], metricSnapshotAfter?.[metric.key], 0.005)}`}>
              <Tooltip label={<MetricTooltipContent metric={metric} />} withArrow multiline maw={320} openDelay={500}>
                <span className="output-toolbar-metric--interactive" tabIndex={0} role="note">
                  <MetricLabel metricKey={metric.key} label={metric.label} />
                </span>
              </Tooltip>
              <span className="text-mono output-toolbar-metric">{formatMetricValue(metricSnapshotBefore?.[metric.key], metric)}</span>
              <span className="text-mono output-toolbar-metric">→</span>
              <span className={`text-mono output-toolbar-metric output-metric-value output-metric-value--${getMetricTrend(metric.key, metricSnapshotBefore?.[metric.key], metricSnapshotAfter?.[metric.key], 0.005)}`}>{formatMetricValue(metricSnapshotAfter?.[metric.key], metric)}</span>
            </div>
          ))}
          <div className="output-metric-item output-metric-item--neutral">
            <MetricLabel metricKey="words" label="Words" />
            <span className="text-mono output-toolbar-metric">{delta.beforeWords}</span>
            <span className="text-mono output-toolbar-metric">→</span>
            <span className={`text-mono output-toolbar-metric output-metric-value output-metric-value--${delta.wordDelta === 0 ? "neutral" : delta.wordDelta > 0 ? "up" : "down"}`}>{delta.afterWords} ({delta.wordDelta >= 0 ? "+" : ""}{delta.wordDelta})</span>
          </div>
          <div className="output-metric-item output-metric-item--neutral">
            <MetricLabel metricKey="chars" label="Chars" />
            <span className="text-mono output-toolbar-metric">{delta.beforeChars}</span>
            <span className="text-mono output-toolbar-metric">→</span>
            <span className={`text-mono output-toolbar-metric output-metric-value output-metric-value--${delta.charDelta === 0 ? "neutral" : delta.charDelta > 0 ? "up" : "down"}`}>{delta.afterChars} ({delta.charDelta >= 0 ? "+" : ""}{delta.charDelta})</span>
          </div>
          <div className="output-metric-item output-metric-item--neutral">
            <MetricLabel metricKey="inputTokens" label="Input tokens" />
            <span className="text-mono output-toolbar-metric">-</span>
            <span className="text-mono output-toolbar-metric">→</span>
            <span className="text-mono output-toolbar-metric">{`${inputTokenIsEstimated ? "~" : ""}${inputTokenCount}`}</span>
          </div>
          <div className="output-metric-item output-metric-item--neutral">
            <MetricLabel metricKey="outputTokens" label="Output tokens" />
            <span className="text-mono output-toolbar-metric">-</span>
            <span className="text-mono output-toolbar-metric">→</span>
            <span className="text-mono output-toolbar-metric">{`${outputTokenIsEstimated ? "~" : ""}${outputTokenCount}`}</span>
          </div>
          <div className="output-metric-item output-metric-item--neutral">
            <MetricLabel metricKey="draftState" label="Draft state" />
            <span className="text-mono output-toolbar-metric">-</span>
            <span className="text-mono output-toolbar-metric">→</span>
            <span className="text-mono output-toolbar-metric">{isEdited ? "Edited draft" : "Model draft"}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function OutputPanel({
  mode,
  originalText,
  outputText,
  outputWords,
  inputUsage,
  outputUsage,
  outputLikelyHitTokenLimit = false,
  isStreaming,
  onOutputChange,
  isEdited,
  readabilityBefore,
  readabilityAfter,
  metricSnapshotBefore,
  metricSnapshotAfter,
  delta,
  copied = false,
  onCopy,
  onRegenerate,
  onRegenerateWithFeedback,
  onCancelGeneration,
  cliches = [],
  onPartialRegen,
  isPartialStreaming = false,
  partialHighlight = null,
  onClearPartialHighlight,
  progressLabel,
  progressTone = "neutral",
  processSteps = [],
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [lockedHighlight, setLockedHighlight] = useState(null);
  const outputZoneRef = useRef(null);

  // Clear tooltip (and locked highlight if idle) on any click outside the tooltip
  useEffect(() => {
    function onPointerDown() {
      setTooltip(null);
      if (!isPartialStreaming) setLockedHighlight(null);
      onClearPartialHighlight?.();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isPartialStreaming, onClearPartialHighlight]);

  // Streaming-only markdown: used only during main generation (no TipTap overhead during stream)
  const streamingHtml = useMemo(
    () => (isStreaming && outputText ? renderMarkdownToHtml(outputText) : ""),
    [isStreaming, outputText]
  );
  const streamStartMsRef = useRef(0);
  const streamPrevLengthRef = useRef(0);
  const [streamPulse, setStreamPulse] = useState(false);
  const [streamStats, setStreamStats] = useState({
    chars: 0,
    words: 0,
    chunks: 0,
    charsPerSecond: 0,
    wordsPerSecond: 0,
  });
  const estimatedInputTokens = useMemo(() => estimateTokenCount(originalText), [originalText]);
  const inputTokenIsEstimated = inputUsage?.sourceText !== originalText || inputUsage?.promptTokens == null;
  const inputTokenCount = inputTokenIsEstimated ? estimatedInputTokens : inputUsage.promptTokens;
  const estimatedOutputTokens = useMemo(() => estimateTokenCount(outputText), [outputText]);
  const outputTokenCount = outputUsage?.completionTokens ?? estimatedOutputTokens;
  const outputTokenIsEstimated = outputUsage?.completionTokens == null;
  const originalWords = useMemo(() => countPanelWords(originalText), [originalText]);
  const compareDiffRanges = useMemo(() => {
    if (!compareOpen) return { before: [], after: [] };
    return buildDiffHighlightRanges(originalText || "", outputText || "");
  }, [compareOpen, originalText, outputText]);

  useEffect(() => {
    if (!isStreaming) {
      streamStartMsRef.current = 0;
      streamPrevLengthRef.current = 0;
      setStreamPulse(false);
      setStreamStats({
        chars: 0,
        words: 0,
        chunks: 0,
        charsPerSecond: 0,
        wordsPerSecond: 0,
      });
      return;
    }
    if (!streamStartMsRef.current) streamStartMsRef.current = Date.now();
    if (outputText.length === 0) {
      streamPrevLengthRef.current = 0;
      setStreamStats((prev) => ({ ...prev, chars: 0, words: 0, charsPerSecond: 0, wordsPerSecond: 0 }));
    }
  }, [isStreaming, outputText.length]);

  useEffect(() => {
    if (!isStreaming) return;
    const previousLength = streamPrevLengthRef.current;
    const nextLength = outputText.length;
    if (nextLength <= previousLength) return;

    streamPrevLengthRef.current = nextLength;
    const elapsedSeconds = Math.max((Date.now() - streamStartMsRef.current) / 1000, 0.001);
    const wordCount = countPanelWords(outputText);
    setStreamPulse(true);
    setStreamStats((prev) => ({
      chars: nextLength,
      words: wordCount,
      chunks: prev.chunks + 1,
      charsPerSecond: Math.max(1, Math.round(nextLength / elapsedSeconds)),
      wordsPerSecond: Math.max(0.1, Math.round((wordCount / elapsedSeconds) * 10) / 10),
    }));
  }, [isStreaming, outputText]);

  useEffect(() => {
    if (!streamPulse) return;
    const timeoutId = window.setTimeout(() => setStreamPulse(false), 240);
    return () => window.clearTimeout(timeoutId);
  }, [streamPulse]);

  function submitRegenerateWithFeedback() {
    const feedback = feedbackText.trim();
    if (!feedback) return;
    onRegenerateWithFeedback?.(feedback);
    setFeedbackOpen(false);
    setFeedbackText("");
  }

  function handlePartialRegen() {
    if (!tooltip) return;
    const { text, from, to, rawStart, rawEnd } = tooltip;
    if (rawEnd > rawStart) setLockedHighlight({ from, to });
    onClearPartialHighlight?.();
    window.getSelection()?.removeAllRanges();
    setTooltip(null);
    if (!(rawEnd > rawStart)) return;
    onPartialRegen?.(text, rawStart, rawEnd);
  }

  return (
    <Card className="app-card output-panel-card" radius="lg">
      <Card.Content className="panel-grid p-4">
        {isStreaming ? (
          <div className="panel-grid">
            <div className="toolbar-row output-stream-head">
              <div className="toolbar-row" style={{ gap: 10 }}>
                <Spinner />
                <span className="panel-title">Generating Preview</span>
              </div>
              <span className="text-mono output-stream-mode">{mode === "humanize" ? "Humanize" : "Elaborate"}</span>
            </div>
          </div>
        ) : null}

        <div className={`output-stream-box-wrap${compareOpen ? " output-stream-box-wrap--compare" : ""}`}>
          <div className={`output-source-card${compareOpen ? " output-source-card--compare" : ""}`} role="note" aria-label="Original user input">
            {compareOpen ? (
              <div className="output-editor-shell output-source-shell">
                <div className="output-stream-box-shell">
                  <div className="output-stream-box-tools output-stream-box-tools--static">
                    <div className="output-stream-labels">
                      <span className="text-mono output-role-label">User text</span>
                    </div>
                  </div>
                  <div
                    className="output-stream-box output-markdown-view output-source-box"
                    aria-label="Original user input"
                    role="region"
                  >
                    {originalText?.trim() ? (
                      <OutputDisplayEditor
                        outputText={originalText}
                        cliches={[]}
                        extraHighlightRanges={compareDiffRanges.before}
                        lockedHighlight={null}
                        rawHighlight={null}
                        isPartialStreaming={false}
                        onSelectionReady={() => {}}
                        onSelectionClear={() => {}}
                        onClearCompletedHighlight={() => {}}
                        containerRef={outputZoneRef}
                        enableSelectionActions={false}
                      />
                    ) : (
                      <p className="output-markdown-placeholder">No input provided</p>
                    )}
                  </div>
                </div>
                <div className="editor-meta-outside" aria-hidden="true">
                  <span className="text-mono editor-meta-outside-item">{originalWords} words</span>
                </div>
              </div>
            ) : (
              <>
                <div className="output-source-head">
                  <span className="text-mono output-source-badge">User text</span>
                </div>
                <p className="output-source-text">
                  {originalText?.trim()
                    ? originalText.trim().slice(0, 220)
                    : "No input provided"}
                </p>
              </>
            )}
          </div>
          <div className="output-llm-column">
            <div className="output-llm-panel">
              <div className="output-editor-shell">
                <div className="output-stream-box-shell">
                  <div className="output-stream-box-tools">
                    <div className="output-stream-labels">
                      <span className="text-mono output-role-label">LLM output</span>
                      {outputLikelyHitTokenLimit ? (
                        <span className="text-mono output-token-cap-badge" role="status" aria-label="Response may be truncated by token limit">
                          Near token limit
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="output-regen-zone" ref={outputZoneRef}>
                    <div
                      className={`output-stream-box output-markdown-view${isStreaming ? " is-streaming" : ""}${streamPulse ? " output-stream-box--pulse" : ""}`}
                      aria-label="LLM output"
                      role="region"
                    >
                      {outputText?.trim() ? (
                        isStreaming ? (
                          <>
                            <div className="output-markdown-content" dangerouslySetInnerHTML={{ __html: streamingHtml }} />
                            <span className="output-stream-caret" aria-hidden="true" />
                          </>
                        ) : (
                          <OutputDisplayEditor
                            outputText={outputText}
                            cliches={cliches}
                            extraHighlightRanges={compareDiffRanges.after}
                            lockedHighlight={lockedHighlight}
                            rawHighlight={partialHighlight}
                            isPartialStreaming={isPartialStreaming}
                            onSelectionReady={setTooltip}
                            onSelectionClear={() => setTooltip(null)}
                            onClearCompletedHighlight={onClearPartialHighlight}
                            containerRef={outputZoneRef}
                          />
                        )
                      ) : (
                        <p className="output-markdown-placeholder">
                          {isStreaming ? "Waiting for model output..." : "Generated response"}
                        </p>
                      )}
                    </div>
                    <SelectionRegenTooltip
                      tooltip={tooltip}
                      isLoading={isPartialStreaming}
                      onRegenerate={handlePartialRegen}
                      onDismiss={() => setTooltip(null)}
                      containerRef={outputZoneRef}
                    />
                  </div>
                </div>
                <div className="editor-meta-outside" aria-hidden="true">
                  <span className="text-mono editor-meta-outside-item">{outputWords} words</span>
                </div>
              </div>

              <div className="output-stream-actions output-stream-actions--sidebar" aria-label="Output actions" role="toolbar">
                <div className="output-feedback-trigger">
                  <div className={`output-feedback-slideout${feedbackOpen ? " is-open" : ""}`}>
                    <textarea
                      className="output-regenerate-feedback-input"
                      value={feedbackText}
                      onChange={(event) => setFeedbackText(event.target.value)}
                      aria-label="Regenerate feedback input"
                      placeholder="Add feedback for the next regeneration."
                      rows={3}
                    />
                    <div className="toolbar-row output-regenerate-feedback-actions">
                      <Button
                        size="sm"
                        variant="solid"
                        color="primary"
                        onPress={submitRegenerateWithFeedback}
                        isDisabled={!feedbackText.trim() || isStreaming}
                        aria-label="Regenerate with feedback"
                        tooltip="Regenerate with feedback"
                        iconOnly
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 2v6h-6" />
                          <path d="M3 22v-6h6" />
                          <path d="M3.51 9a9 9 0 0 1 14.13-3.36L21 8" />
                          <path d="M20.49 15a9 9 0 0 1-14.13 3.36L3 16" />
                        </svg>
                      </Button>
                      <Button
                        size="sm"
                        variant="bordered"
                        onPress={() => {
                          setFeedbackOpen(false);
                          setFeedbackText("");
                        }}
                        aria-label="Cancel regenerate feedback"
                        tooltip="Cancel"
                        iconOnly
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                  <Button
                    className="output-stream-copy"
                    variant={feedbackOpen ? "solid" : "bordered"}
                    color={feedbackOpen ? "primary" : "default"}
                    size="sm"
                    onPress={() => {
                      setFeedbackOpen((prev) => !prev);
                      if (feedbackOpen) setFeedbackText("");
                    }}
                    isDisabled={isStreaming || !originalText?.trim()}
                    aria-label={feedbackOpen ? "Hide regenerate feedback" : "Open regenerate feedback"}
                    tooltip={feedbackOpen ? "Hide feedback input" : "Regenerate with feedback"}
                    iconOnly
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 2v6h-6" />
                      <path d="M3 22v-6h6" />
                      <path d="M3.51 9a9 9 0 0 1 14.13-3.36L21 8" />
                      <path d="M20.49 15a9 9 0 0 1-14.13 3.36L3 16" />
                      <path d="M8 12h8" />
                    </svg>
                  </Button>
                </div>
                <Button
                  className="output-stream-copy"
                  variant={compareOpen ? "solid" : "bordered"}
                  color={compareOpen ? "primary" : "default"}
                  size="sm"
                  onPress={() => setCompareOpen((prev) => !prev)}
                  isDisabled={!originalText?.trim() && !outputText?.trim()}
                  aria-label={compareOpen ? "Close side by side comparison" : "Open side by side comparison"}
                  tooltip={compareOpen ? "Close compare view" : "Compare user vs LLM"}
                  iconOnly
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="8" height="16" rx="1.5" />
                    <rect x="13" y="4" width="8" height="16" rx="1.5" />
                  </svg>
                </Button>
                <Button
                  className="output-stream-copy"
                  variant="bordered"
                  color="default"
                  size="sm"
                  onPress={onRegenerate}
                  isDisabled={isStreaming || !originalText?.trim()}
                  aria-label="Regenerate output"
                  tooltip="Regenerate output"
                  iconOnly
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 2v6h-6" />
                    <path d="M3 22v-6h6" />
                    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L21 8" />
                    <path d="M20.49 15a9 9 0 0 1-14.13 3.36L3 16" />
                  </svg>
                </Button>
                <Button
                  className="output-stream-copy"
                  variant={copied ? "solid" : "bordered"}
                  color={copied ? "primary" : "default"}
                  size="sm"
                  onPress={onCopy}
                  isDisabled={!outputText?.trim()}
                  aria-label={copied ? "Output copied" : "Copy output"}
                  tooltip={copied ? "Copied" : "Copy output text"}
                  iconOnly
                >
                  {copied ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className={`output-metrics-detached${compareOpen ? " output-metrics-detached--compare" : ""}`}>
          <MetricsPanel
            readabilityBefore={readabilityBefore}
            readabilityAfter={readabilityAfter}
            metricSnapshotBefore={metricSnapshotBefore}
            metricSnapshotAfter={metricSnapshotAfter}
            inputTokenCount={inputTokenCount}
            inputTokenIsEstimated={inputTokenIsEstimated}
            outputTokenCount={outputTokenCount}
            outputTokenIsEstimated={outputTokenIsEstimated}
            delta={delta}
            isEdited={isEdited}
          />
        </div>

        {isStreaming ? (
          <GenerationLoadingToast
            progressLabel={progressLabel}
            progressTone={progressTone}
            processSteps={processSteps}
            onCancel={onCancelGeneration}
          />
        ) : null}

      </Card.Content>
    </Card>
  );
}
