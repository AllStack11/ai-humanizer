import { useEffect, useRef, useState } from "react";
import { NativeSelect, Popover } from "@mantine/core";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Button, Card } from "./AppUI.jsx";
import ToggleSwitch from "./ToggleSwitch.jsx";
import { DynamicHighlighter } from "../lib/tiptap-highlighter.js";
import { isTauriRuntime, tauriInvoke } from "../lib/tauri.js";
import { ELAB_DEPTHS, OUTPUT_PRESET_OPTIONS, TONE_LEVELS } from "../constants/index.js";
import { buildClicheRanges } from "../utils/index.js";
import { renderMarkdownToHtml } from "../utils/markdown.js";
import { serializeTiptapEditorToMarkdown } from "../utils/tiptapMarkdown.js";

const ADD_CUSTOM_MODEL_VALUE = "__add_custom_model__";
const IS_TEST_ENV =
  typeof import.meta !== "undefined" &&
  Boolean(import.meta.env?.MODE === "test" || import.meta.env?.VITEST);

function ModelSelector({ selectedModel, modelOptions, onModelChange, onAddModel, onRemoveModel }) {
  const [open, setOpen] = useState(false);
  const current = modelOptions.find((m) => m.value === selectedModel);
  const label = current?.label || selectedModel || "Select model";

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="top-start"
      offset={4}
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          className="editor-model-select"
          onClick={() => setOpen((o) => !o)}
          aria-label="Select model"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            cursor: "pointer",
            textAlign: "left",
            background: "transparent",
            border: 0,
            boxShadow: "none",
            padding: "4px 0",
            minHeight: 34,
            color: "var(--editor-overlay-text)",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}>
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      </Popover.Target>
      <Popover.Dropdown
        style={{
          padding: 4,
          minWidth: 220,
          maxHeight: 280,
          overflowY: "auto",
          borderRadius: 10,
        }}
      >
        {modelOptions.map((m) => (
          <div
            key={m.value}
            style={{
              display: "flex",
              alignItems: "center",
              borderRadius: 7,
              background: m.value === selectedModel ? "rgba(120,90,50,0.12)" : "transparent",
            }}
          >
            <button
              type="button"
              onClick={() => { onModelChange(m.value); setOpen(false); }}
              style={{
                flex: 1,
                textAlign: "left",
                padding: "7px 10px",
                fontSize: 13,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemoveModel(m.value); }}
              aria-label={`Remove ${m.label}`}
              style={{
                padding: "4px 8px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                opacity: 0.45,
                flexShrink: 0,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.45"; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        ))}
        <div style={{ borderTop: "1px solid rgba(120,100,80,0.15)", marginTop: 3, paddingTop: 3 }}>
          <button
            type="button"
            onClick={() => { setOpen(false); onAddModel(); }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "7px 10px",
              fontSize: 13,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              borderRadius: 7,
              opacity: 0.75,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(120,90,50,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.75"; e.currentTarget.style.background = "transparent"; }}
          >
            + Add custom model…
          </button>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

function normalizeMarkdown(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\n+$/, "").trim();
}

function serializeEditorMarkdown(editor) {
  return serializeTiptapEditorToMarkdown(editor);
}

function TiptapInput({
  inputText,
  onChange,
  mode,
  cliches,
  canAttemptSubmit,
  onSubmit,
}) {
  const hasFocusedRef = useRef(false);
  const canSubmitRef = useRef(canAttemptSubmit);
  const onSubmitRef = useRef(onSubmit);

  canSubmitRef.current = canAttemptSubmit;
  onSubmitRef.current = onSubmit;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        strike: false,
      }),
      Placeholder.configure({
        placeholder: mode === "humanize" ? "Paste AI-generated text here…" : "Write something to elaborate on…",
      }),
      DynamicHighlighter.configure({
        getRanges: (text) => {
          if (!text) return [];
          return buildClicheRanges(text, cliches).map((range) => ({
            start: range.start,
            end: range.end,
            kind: "cliche",
          }));
        },
      }),
    ],
    content: renderMarkdownToHtml(inputText),
    onUpdate: ({ editor }) => {
      const markdown = serializeEditorMarkdown(editor);
      if (normalizeMarkdown(markdown) !== normalizeMarkdown(inputText)) {
        onChange(markdown);
      }
    },
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.key !== "Enter" || event.shiftKey) return false;
        if (!canSubmitRef.current) return false;
        event.preventDefault();
        window.setTimeout(() => onSubmitRef.current?.(), 0);
        return true;
      },
      attributes: {
        class: "editor-textarea tiptap-editor",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;

    if (!hasFocusedRef.current) {
      hasFocusedRef.current = true;
      queueMicrotask(() => {
        try {
          editor.commands.focus("end");
        } catch {}
      });
    }

    const editorMarkdown = serializeEditorMarkdown(editor);
    if (normalizeMarkdown(editorMarkdown) !== normalizeMarkdown(inputText)) {
      const { from, to } = editor.state.selection;
      try {
        editor.commands.setContent(renderMarkdownToHtml(inputText), false);
      } catch {
        editor.commands.setContent("", false);
      }
      try {
        editor.commands.setTextSelection({
          from: Math.min(from, editor.state.doc.content.size),
          to: Math.min(to, editor.state.doc.content.size),
        });
      } catch {}
    }

    editor.view.dispatch(editor.state.tr.setMeta("dynamicHighlighterUpdate", true));
  }, [inputText, editor, cliches]);

  return <EditorContent editor={editor} style={{ display: "flex", flex: 1, minHeight: 0 }} />;
}

function EditorIcon({ children }) {
  return (
    <span className="editor-action-icon" aria-hidden="true">
      {children}
    </span>
  );
}

function ToolbarRangeControl({ value, onChange, options, ariaLabel }) {
  const max = Math.max(options.length - 1, 0);
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), max);
  const valuePct = max === 0 ? 0 : (safeValue / max) * 100;
  const activeOption = options[safeValue] || options[0];

  return (
    <div className="editor-range-control" aria-label={ariaLabel}>
      <div className="editor-range-track-wrap" style={{ "--editor-range-pct": `${valuePct}%` }}>
        <div className="editor-range-bubble" aria-hidden="true">
          {activeOption?.label}
        </div>
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={safeValue}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          aria-label={ariaLabel}
          className="editor-range-input"
        />
        <div className="editor-range-marks" aria-hidden="true">
          {options.map((option, index) => (
            <span key={`${option.label}-${index}`} className={`editor-range-mark${index <= safeValue ? " is-active" : ""}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolbarScale({ label, children }) {
  return (
    <div className="editor-toolbar-control">
      <span className="text-mono editor-toolbar-label">{label}</span>
      {children}
    </div>
  );
}

export default function WriterPanel({
  inputText,
  onChange,
  mode,
  onModeChange,
  loading,
  hasStyle,
  words,
  cliches,
  toneLevel,
  onToneLevelChange,
  stripCliches,
  onStripClichesChange,
  elabDepth,
  onElabDepthChange,
  formatPreset,
  onFormatPresetChange,
  oneOffInstruction,
  onOneOffInstructionChange,
  selectedModel,
  onModelChange,
  modelOptions,
  onAddModel,
  onRemoveModel,
  onNewChat,
  onSubmit,
}) {
  const textareaRef = useRef(null);
  const instructionInputRef = useRef(null);
  const previousInstructionRef = useRef(oneOffInstruction);
  const minChars = mode === "humanize" ? 20 : 10;
  const inputLength = inputText.trim().length;
  const meetsMinimum = inputLength >= minChars;
  const busy = loading;
  const canAttemptSubmit = !busy && meetsMinimum;
  const [instructionOpen, setInstructionOpen] = useState(Boolean(oneOffInstruction?.trim()));

  function submitSoon() {
    window.setTimeout(() => onSubmit?.(), 0);
  }

  async function pasteFromClipboard() {
    try {
      let pastedText = "";

      if (isTauriRuntime()) {
        try {
          if (isTauriRuntime()) {
            const nativeText = await tauriInvoke("read_clipboard_text");
            if (typeof nativeText === "string") pastedText = nativeText;
          } else {
            const nativeText = await navigator.clipboard.readText();
            if (typeof nativeText === "string") pastedText = nativeText;
          }
        } catch {}
      }

      if (!pastedText && navigator?.clipboard?.readText) {
        const browserText = await navigator.clipboard.readText();
        if (typeof browserText === "string") pastedText = browserText;
      }

      if (typeof pastedText !== "string") return;
      onChange(pastedText);
    } catch {}
  }

  useEffect(() => {
    if (!IS_TEST_ENV) return;
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const hadInstruction = Boolean(previousInstructionRef.current?.trim());
    const hasInstruction = Boolean(oneOffInstruction?.trim());

    if (!hadInstruction && hasInstruction) {
      setInstructionOpen(true);
    }

    previousInstructionRef.current = oneOffInstruction;
  }, [oneOffInstruction]);

  useEffect(() => {
    if (!instructionOpen) return;
    instructionInputRef.current?.focus();
  }, [instructionOpen]);

  return (
    <>
      <Card
        className={`app-card editor-card editor-card--${mode}`}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        radius="lg"
      >
        <Card.Content className="p-0" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div className="editor-topbar">
            <div className="toolbar-row editor-topbar-controls" style={{ gap: 8 }}>
              <Button
                size="sm"
                color={mode === "humanize" ? "primary" : "default"}
                variant={mode === "humanize" ? "solid" : "bordered"}
                onPress={() => onModeChange("humanize")}
                aria-label="Switch to humanize mode"
                tooltip="Rewrite text to sound like your voice"
                iconOnly
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 12h16" />
                  <path d="M4 18h10" />
                  <path d="M4 6h13" />
                </svg>
              </Button>
              <Button
                size="sm"
                color={mode === "elaborate" ? "primary" : "default"}
                variant={mode === "elaborate" ? "solid" : "bordered"}
                onPress={() => onModeChange("elaborate")}
                aria-label="Switch to elaborate mode"
                tooltip="Expand the draft with more detail"
                iconOnly
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 12h8" />
                  <path d="M4 18h16" />
                  <path d="M4 6h5" />
                  <path d="M16 9v6" />
                  <path d="M13 12h6" />
                </svg>
              </Button>
              {mode === "elaborate" ? (
                <ToolbarScale label="Depth">
                  <ToolbarRangeControl
                    value={elabDepth}
                    onChange={onElabDepthChange}
                    options={ELAB_DEPTHS}
                    ariaLabel="Elaboration depth"
                  />
                </ToolbarScale>
              ) : null}
              {(mode === "humanize" || mode === "elaborate") ? (
                <ToolbarScale label="Tone">
                  <ToolbarRangeControl
                    value={toneLevel}
                    onChange={onToneLevelChange}
                    options={TONE_LEVELS}
                    ariaLabel={mode === "humanize" ? "Rewrite tone" : "Elaborate tone"}
                  />
                </ToolbarScale>
              ) : null}
              <ToolbarScale label="Preset">
                <NativeSelect
                  value={formatPreset}
                  onChange={(event) => onFormatPresetChange(event.currentTarget.value)}
                  aria-label="Output format preset"
                  className="app-select-wrap editor-topbar-select"
                  data={OUTPUT_PRESET_OPTIONS.map((preset) => ({ value: preset.value, label: preset.label }))}
                />
              </ToolbarScale>
              <ToolbarScale label="AI filter">
                <ToggleSwitch value={stripCliches} onChange={onStripClichesChange} />
              </ToolbarScale>
            </div>

            <div className="toolbar-row editor-topbar-meta">
              <Button
                size="sm"
                variant="bordered"
                onPress={() => onNewChat?.()}
                aria-label="Start new chat"
                tooltip="Start a new session"
                iconOnly
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </Button>
            </div>
          </div>

          <div className="editor-wrap tiptap-wrap">
            <div className="editor-canvas">
              {IS_TEST_ENV ? (
                <textarea
                  ref={textareaRef}
                  className="editor-textarea"
                  placeholder={mode === "humanize" ? "Paste AI-generated text here…" : "Write something to elaborate on…"}
                value={inputText}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && canAttemptSubmit) {
                    event.preventDefault();
                    submitSoon();
                  }
                }}
                autoFocus
              />
            ) : (
              <TiptapInput
                inputText={inputText}
                onChange={onChange}
                mode={mode}
                cliches={cliches}
                canAttemptSubmit={canAttemptSubmit}
                onSubmit={onSubmit}
              />
            )}
              <div className="editor-command-row">
                <div className="toolbar-row editor-quick-actions">
                  <Button
                    size="sm"
                    variant="bordered"
                    onPress={pasteFromClipboard}
                    aria-label="Paste input"
                    iconOnly
                  >
                    <EditorIcon>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="3" width="6" height="4" rx="1" />
                        <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                      </svg>
                    </EditorIcon>
                  </Button>
                  <Button size="sm" variant="light" onPress={() => onChange("")} isDisabled={!inputText} aria-label="Clear input" tooltip="Clear the editor" iconOnly>
                    <EditorIcon>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="m19 6-1 14H6L5 6" />
                      </svg>
                    </EditorIcon>
                  </Button>
                </div>

                <div className="editor-command-right">
                  <div className={`editor-instruction-dock${instructionOpen ? " is-open" : ""}`}>
                    <div className="editor-instruction-panel" aria-hidden={!instructionOpen}>
                      <input
                        ref={instructionInputRef}
                        type="text"
                        className="editor-instruction-input"
                        value={oneOffInstruction}
                        onChange={(e) => onOneOffInstructionChange(e.target.value)}
                        placeholder="One-off instruction (example: cut 30 words)"
                        aria-label="One-off instruction"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant={instructionOpen ? "solid" : "bordered"}
                      color={oneOffInstruction?.trim() ? "primary" : "default"}
                      onPress={() => setInstructionOpen((open) => !open)}
                      aria-label={instructionOpen ? "Hide one-off instruction" : "Show one-off instruction"}
                      className="editor-instruction-trigger"
                      iconOnly
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    </Button>
                  </div>

                  <div className="toolbar-row editor-send-cluster">
                    <ModelSelector
                      selectedModel={selectedModel}
                      modelOptions={modelOptions}
                      onModelChange={onModelChange}
                      onAddModel={onAddModel}
                      onRemoveModel={onRemoveModel}
                    />
                    <Button
                      color="primary"
                      onPress={submitSoon}
                      isDisabled={!canAttemptSubmit}
                      aria-label={
                        loading
                          ? mode === "humanize" ? "Rewriting" : "Expanding"
                          : !hasStyle
                            ? "Onboard profile first"
                            : mode === "humanize" ? "Humanize text" : "Elaborate text"
                      }
                      tooltip={
                        loading
                          ? mode === "humanize" ? "Rewriting your draft" : "Expanding your draft"
                          : inputLength === 0
                            ? "Enter some text before sending"
                          : !hasStyle
                            ? "Press send after onboarding a profile"
                            : !meetsMinimum
                              ? mode === "humanize"
                                ? "Paste some text to humanize (20+ chars)"
                                : "Write something to elaborate on (10+ chars)"
                          : hasStyle
                              ? mode === "humanize"
                                ? "Send the draft to rewrite in your voice"
                                : "Expand the draft with more detail"
                              : ""
                      }
                      iconOnly
                      className="editor-send-button"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14" />
                        <path d="m19 12-7-7-7 7" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="editor-meta-outside" aria-hidden="true">
              <span className="text-mono editor-meta-outside-item">{words} words</span>
            </div>
          </div>

        </Card.Content>
      </Card>
    </>
  );
}
