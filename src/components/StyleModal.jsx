import { useState, useEffect } from "react";
import { Modal, NativeSelect } from "@mantine/core";
import { Button, Card, TextArea } from "./AppUI.jsx";
import { load, save } from "../lib/storage.js";
import { normalizeSampleSlot, getFilledSlots, resolveSampleType } from "../utils/profile.js";
import { WRITING_SAMPLE_TYPES, DEFAULT_SAMPLE_TYPE, DEFAULT_SLOTS, STYLE_MODAL_DRAFT_KEY, PROFILE_GOAL_OPTIONS, PROFILE_DOMAIN_OPTIONS } from "../constants/index.js";

function ModalIcon({ children }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      {children}
    </span>
  );
}

export default function StyleModal({ profileId, hasProfile, loading, health, profileLabel, sampleCount = 0, sampleEntries = [], profile = null, meta = null, onTrainProfile, onUpdateMeta, onClose }) {
  const initialSlots = [];
  const [trainSlots, setTrainSlots] = useState(initialSlots);
  const [poolInput, setPoolInput] = useState("");
  const [poolType, setPoolType] = useState(DEFAULT_SAMPLE_TYPE);
  const [dropActive, setDropActive] = useState(false);

  const filledSlots = getFilledSlots(trainSlots);
  const totalChars = trainSlots.reduce((sum, slot) => sum + slot.text.trim().length, 0);

  function nextSlotId(slots) {
    if (!slots.length) return 1;
    return Math.max(...slots.map((slot) => slot.id)) + 1;
  }

  function getSampleTypeLabel(rawType) {
    const resolvedType = resolveSampleType(rawType);
    return WRITING_SAMPLE_TYPES.find((type) => type.value === resolvedType)?.label || "Writing";
  }

  function addBlankPiece() {
    const nextType = resolveSampleType(poolType);
    setTrainSlots((prev) => [...prev, normalizeSampleSlot({ id: nextSlotId(prev), text: "", type: nextType }, nextSlotId(prev))]);
  }

  function splitPoolTextIntoPieces(rawText) {
    const raw = (rawText || "").trim();
    if (!raw) return [];
    return [raw];
  }

  function appendPoolText(rawText, type = poolType) {
    const pieces = splitPoolTextIntoPieces(rawText);
    if (!pieces.length) return;
    const resolvedType = resolveSampleType(type);

    setTrainSlots((prev) => {
      let idCursor = nextSlotId(prev);
      const additions = pieces.map((piece) => normalizeSampleSlot({ id: idCursor++, text: piece, type: resolvedType }, idCursor));
      return [...prev, ...additions];
    });
  }

  useEffect(() => {
    (async () => {
      if (!hasProfile) {
        setTrainSlots(initialSlots);
        setPoolInput("");
        setPoolType(DEFAULT_SAMPLE_TYPE);
        return;
      }
      const draft = await load(`${STYLE_MODAL_DRAFT_KEY}:${profileId}`);
      if (!draft || typeof draft !== "object") {
        if (sampleEntries.length) {
          setTrainSlots(sampleEntries.map((slot, index) => normalizeSampleSlot(slot, index + 1)));
        }
        return;
      }
      if (Array.isArray(draft.trainSlots) && draft.trainSlots.length) {
        const normalizedSlots = draft.trainSlots.map((slot, index) => normalizeSampleSlot(slot, index + 1));
        setTrainSlots(normalizedSlots);
      } else if (Array.isArray(draft.trainSlots) && !draft.trainSlots.length) {
        if (sampleEntries.length) {
          setTrainSlots(sampleEntries.map((slot, index) => normalizeSampleSlot(slot, index + 1)));
        } else {
          setTrainSlots(initialSlots);
        }
      }
      if (typeof draft.poolInput === "string") setPoolInput(draft.poolInput);
      if (typeof draft.poolType === "string") setPoolType(resolveSampleType(draft.poolType));
    })();
  }, [hasProfile]);

  useEffect(() => {
    if (!profileId) return;
    save(`${STYLE_MODAL_DRAFT_KEY}:${profileId}`, {
      trainSlots,
      poolInput,
      poolType,
      updatedAt: new Date().toISOString(),
    });
  }, [trainSlots, poolInput, poolType, profileId]);

  function resetDraft() {
    setTrainSlots(initialSlots);
    setPoolInput("");
    setPoolType(DEFAULT_SAMPLE_TYPE);
    save(`${STYLE_MODAL_DRAFT_KEY}:${profileId}`, null);
  }

  function removeSlot(id) {
    setTrainSlots((prev) => prev.filter((slot) => slot.id !== id));
  }

  function addPastedContent() {
    appendPoolText(poolInput, poolType);
    setPoolInput("");
  }

  async function handleDrop(event) {
    event.preventDefault();
    setDropActive(false);

    const text = event.dataTransfer?.getData("text/plain")?.trim();
    if (text) {
      appendPoolText(text, poolType);
      return;
    }

    const firstFile = event.dataTransfer?.files?.[0];
    if (!firstFile) return;
    if (!firstFile.type.startsWith("text/") && !firstFile.name.endsWith(".md") && !firstFile.name.endsWith(".txt")) return;

    const fileText = await firstFile.text();
    appendPoolText(fileText, poolType);
  }

  async function handleSubmit() {
    const ok = await onTrainProfile(trainSlots);
    if (!ok) return;
    if (hasProfile) {
      setPoolInput("");
      return;
    }
    resetDraft();
  }

  return (
    <Modal opened onClose={onClose} centered size="xl" classNames={{ content: "modal-content", body: "panel-grid" }} withCloseButton={false}>
        <div className="toolbar-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{hasProfile ? "Grow Your Writing Profile" : "Onboard Your Writing Profile"}</h2>
          <Button
            variant="light"
            onPress={onClose}
            aria-label="Close style modal"
            tooltip="Close the style pieces modal"
            iconOnly
          >
            <ModalIcon>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </ModalIcon>
          </Button>
        </div>

        <p style={{ marginTop: 0, marginBottom: 16, fontSize: 13, color: "#655d52" }}>
          Build a style pool by dropping or pasting your writing. Every piece stays editable and can be refined over time.
        </p>


        <Card className="app-card" radius="lg">
          <Card.Content
            className="panel-grid p-3"
              style={{
                border: dropActive ? "1px dashed var(--accent, #a56b2f)" : "1px dashed #d6cbb9",
                borderRadius: 12,
                background: dropActive ? "var(--accent-soft)" : "rgba(255,255,255,0.72)",
              }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={handleDrop}
          >
            <label className="text-mono" style={{ fontSize: 11 }}>Drop / Paste Writing</label>
            <TextArea
              value={poolInput}
              onChange={(e) => setPoolInput(e.target.value)}
              placeholder="Paste writing snippets. Each paste is added as one style piece."
              style={{ minHeight: 120 }}
            />
            <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
              <div className="toolbar-row">
                <span className="text-mono" style={{ fontSize: 11 }}>Classify as</span>
                <NativeSelect
                  value={poolType}
                  onChange={(e) => setPoolType(resolveSampleType(e.currentTarget.value))}
                  className="app-select-wrap"
                  data={WRITING_SAMPLE_TYPES.map((type) => ({ value: type.value, label: type.label }))}
                  styles={{ input: { minWidth: 180 } }}
                />
              </div>
              <Button
                color="primary"
                onPress={addPastedContent}
                isDisabled={!poolInput.trim()}
                aria-label="Add to style pool"
                tooltip="Add the pasted writing as a new style piece"
                iconOnly
              >
                <ModalIcon>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </ModalIcon>
              </Button>
            </div>
          </Card.Content>
        </Card>

        <h3 className="text-mono" style={{ margin: "14px 0 8px", fontSize: 12 }}>Style Pieces ({trainSlots.length})</h3>
        <div className="panel-grid">
          {trainSlots.map((slot) => (
            <Card key={slot.id} className="app-card" radius="lg">
              <Card.Content className="panel-grid p-3">
                <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
                  <label className="text-mono" htmlFor={`sample-type-${slot.id}`} style={{ fontSize: 11 }}>Piece {slot.id}</label>
                  <div className="toolbar-row">
                    <span className="text-mono" style={{ fontSize: 11 }}>{slot.text.trim().length.toLocaleString()} chars</span>
                    <Button
                      variant="bordered"
                      size="sm"
                      onPress={() => removeSlot(slot.id)}
                      isDisabled={false}
                      aria-label={`Remove style piece ${slot.id}`}
                      tooltip={`Remove style piece ${slot.id}`}
                      iconOnly
                    >
                      <ModalIcon>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="m19 6-1 14H6L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </ModalIcon>
                    </Button>
                  </div>
                </div>

                <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
                  <span className="text-mono" style={{ fontSize: 11 }}>Sample form</span>
                  <NativeSelect
                    id={`sample-type-${slot.id}`}
                    value={slot.type}
                    onChange={(e) => {
                      const nextType = resolveSampleType(e.currentTarget.value);
                      setTrainSlots((prev) => prev.map((sample) => sample.id === slot.id ? { ...sample, type: nextType } : sample));
                    }}
                    className="app-select-wrap"
                    data={WRITING_SAMPLE_TYPES.map((type) => ({ value: type.value, label: type.label }))}
                    styles={{ input: { minWidth: 180 } }}
                  />
                </div>

                <TextArea
                  value={slot.text}
                  onChange={(e) => setTrainSlots((prev) => prev.map((sample) => sample.id === slot.id ? { ...sample, text: e.target.value } : sample))}
                  placeholder={`Paste ${getSampleTypeLabel(slot.type).toLowerCase()} here. Aim for 150+ chars.`}
                  style={{ minHeight: 130 }}
                />
              </Card.Content>
            </Card>
          ))}
        </div>

        {onUpdateMeta && (
          <div style={{ marginTop: 20 }}>
            <h3 className="text-mono" style={{ margin: "0 0 8px", fontSize: 12 }}>Profile Context</h3>
            <Card className="app-card" radius="lg">
              <Card.Content className="panel-grid p-3">
                <div>
                  <label className="text-mono" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Writing Goals</label>
                  <div className="toolbar-row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {PROFILE_GOAL_OPTIONS.map(({ value, label }) => {
                      const active = meta?.goals?.includes(value);
                      return (
                        <button
                          key={value}
                          className={`profile-meta-chip${active ? " profile-meta-chip--active" : ""}`}
                          onClick={() => {
                            const current = meta?.goals || [];
                            onUpdateMeta({ goals: active ? current.filter(g => g !== value) : [...current, value] });
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-mono" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Content Domains</label>
                  <div className="toolbar-row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {PROFILE_DOMAIN_OPTIONS.map(({ value, label }) => {
                      const active = meta?.domains?.includes(value);
                      return (
                        <button
                          key={value}
                          className={`profile-meta-chip${active ? " profile-meta-chip--active" : ""}`}
                          onClick={() => {
                            const current = meta?.domains || [];
                            onUpdateMeta({ domains: active ? current.filter(d => d !== value) : [...current, value] });
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-mono" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Target Audience</label>
                  <input
                    className="app-input"
                    type="text"
                    defaultValue={meta?.audience || ""}
                    placeholder="e.g. tech professionals, general public"
                    onBlur={(e) => onUpdateMeta({ audience: e.target.value })}
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label className="text-mono" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Notes</label>
                  <textarea
                    className="app-input"
                    defaultValue={meta?.notes || ""}
                    placeholder="Personal notes about this profile (not sent to AI)"
                    rows={2}
                    onBlur={(e) => onUpdateMeta({ notes: e.target.value })}
                    style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }}
                  />
                </div>
              </Card.Content>
            </Card>
          </div>
        )}

        <div className="toolbar-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
          <span className="text-mono" style={{ fontSize: 11 }}>
            {filledSlots.length} sample{filledSlots.length !== 1 ? "s" : ""} ready · {totalChars.toLocaleString()} chars
          </span>
          <div className="toolbar-row">
            <Button
              variant="bordered"
              onPress={addBlankPiece}
              aria-label="Add blank style piece"
              tooltip="Create an empty style piece you can fill in manually"
              iconOnly
            >
              <ModalIcon>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M12 8v8" />
                  <path d="M8 12h8" />
                </svg>
              </ModalIcon>
            </Button>
            <Button
              color="primary"
              onPress={handleSubmit}
              isDisabled={loading || !filledSlots.length}
              aria-label={loading ? "Processing style profile" : hasProfile ? "Merge into profile" : "Create profile"}
              tooltip={loading ? "Training in progress" : hasProfile ? "Merge these style pieces into the current profile" : "Create a new writing profile from these style pieces"}
              iconOnly
            >
              <ModalIcon>
                {loading ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-9-9" />
                  </svg>
                ) : hasProfile ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m8 12 4 4 8-8" />
                    <path d="M16 8h4v4" />
                    <path d="M12 16H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m22 11-7-7-10 10" />
                    <path d="M16 5h6v6" />
                    <path d="M12 20H5a1 1 0 0 1-1-1v-7" />
                  </svg>
                )}
              </ModalIcon>
            </Button>
          </div>
        </div>
    </Modal>
  );
}
