import { useState, useEffect, useRef } from "react";
import { Modal } from "@mantine/core";
import { Button, Input } from "./AppUI.jsx";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export function isNonImageOnlyCatalogModel(model) {
  const inputModalities = model?.architecture?.input_modalities;

  if (!Array.isArray(inputModalities) || inputModalities.length === 0) return false;
  if (inputModalities.every((modality) => modality === "image")) return false;

  return true;
}

function fmtContext(ctx) {
  if (!ctx) return "";
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1)}M ctx`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K ctx`;
  return `${ctx} ctx`;
}

export default function AddModelModal({ opened, onClose, onAdd, apiKey }) {
  const [query, setQuery] = useState("");
  const [models, setModels] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [loading, setLoading] = useState(false);
  const [modelId, setModelId] = useState("");
  const [modelLabel, setModelLabel] = useState("");
  const [selected, setSelected] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!opened) return;
    setQuery("");
    setModelId("");
    setModelLabel("");
    setSelected(null);
    setFetchError("");
    fetchModels();
    setTimeout(() => searchRef.current?.focus(), 80);
  }, [opened]);

  async function fetchModels() {
    setLoading(true);
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(OPENROUTER_MODELS_URL, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = (json.data || [])
        .filter(isNonImageOnlyCatalogModel)
        .sort((a, b) =>
        (a.name || a.id).localeCompare(b.name || b.id)
      );
      setModels(list);
    } catch (err) {
      setFetchError("Could not load models from OpenRouter. You can still enter a model ID manually.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = query.trim()
    ? models.filter((m) => {
        const q = query.toLowerCase();
        return (
          (m.id || "").toLowerCase().includes(q) ||
          (m.name || "").toLowerCase().includes(q)
        );
      })
    : models;

  function selectModel(m) {
    setSelected(m);
    setModelId(m.id);
    setModelLabel(m.name || m.id);
  }

  function handleAdd() {
    const value = modelId.trim();
    if (!value) return;
    onAdd({ value, label: modelLabel.trim() || value });
  }

  const canAdd = modelId.trim().length > 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="lg"
      withCloseButton={false}
      classNames={{ content: "modal-content", body: "panel-grid" }}
    >
      <div className="toolbar-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Add Model</h2>
        <Button
          variant="light"
          onPress={onClose}
          aria-label="Close add model modal"
          iconOnly
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      </div>

      <p style={{ marginTop: 0, marginBottom: 10, fontSize: 13, color: "#655d52" }}>
        Search OpenRouter models or paste a model ID directly.
      </p>

      <Input
        ref={searchRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={loading ? "Loading models…" : "Search models (e.g. gpt-4o, claude, mistral)"}
        style={{ marginBottom: 6 }}
      />

      {fetchError && (
        <p style={{ fontSize: 12, color: "#b04a2a", margin: "4px 0 6px" }}>{fetchError}</p>
      )}

      {!fetchError && (
        <div
          style={{
            border: "1px solid rgba(120,100,80,0.18)",
            borderRadius: 10,
            overflowY: "auto",
            maxHeight: 240,
            marginBottom: 10,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          {loading && (
            <div style={{ padding: "16px 14px", fontSize: 13, color: "#888" }}>Loading…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: "16px 14px", fontSize: 13, color: "#888" }}>No models match your search.</div>
          )}
          {!loading && filtered.map((m) => (
            <div
              key={m.id}
              onClick={() => selectModel(m)}
              style={{
                padding: "8px 14px",
                cursor: "pointer",
                borderBottom: "1px solid rgba(120,100,80,0.1)",
                background: selected?.id === m.id ? "rgba(120,90,50,0.12)" : "transparent",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
              onMouseEnter={(e) => {
                if (selected?.id !== m.id)
                  e.currentTarget.style.background = "rgba(120,90,50,0.06)";
              }}
              onMouseLeave={(e) => {
                if (selected?.id !== m.id)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.name || m.id}
                </div>
                <div style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.id}
                </div>
              </div>
              {m.context_length ? (
                <span style={{ fontSize: 11, color: "#999", flexShrink: 0 }}>
                  {fmtContext(m.context_length)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="panel-grid" style={{ gap: 6 }}>
        <Input
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="Model ID (e.g. openai/gpt-4o-mini)"
        />
        <Input
          value={modelLabel}
          onChange={(e) => setModelLabel(e.target.value)}
          placeholder="Display name (optional)"
        />
      </div>

      <div className="toolbar-row" style={{ justifyContent: "flex-end", marginTop: 14, gap: 8 }}>
        <Button variant="light" onPress={onClose}>
          Cancel
        </Button>
        <Button color="primary" onPress={handleAdd} isDisabled={!canAdd}>
          Add Model
        </Button>
      </div>
    </Modal>
  );
}
