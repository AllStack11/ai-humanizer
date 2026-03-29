import { Modal } from "@mantine/core";
import { Button, Input } from "./AppUI.jsx";
import { isTauriRuntime } from "../lib/tauri.js";

import { useState } from "react";

export default function ApiKeyModal({
  required,
  value,
  source,
  apiUrl,
  apiKeyFile,
  loading,
  onChange,
  onApiUrlChange,
  onApiKeyFileChange,
  onSave,
  onClear,
  onClose,
}) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSaveClick = () => {
    if (source !== "missing" && !showConfirm) {
      setShowConfirm(true);
    } else {
      onSave();
      setShowConfirm(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      centered
      size="lg"
      withCloseButton={false}
      closeOnClickOutside={!required}
      classNames={{ content: "modal-content", body: "panel-grid" }}
      zIndex={500}
    >
        <div className="toolbar-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>OpenRouter API Key</h2>
          <Button
            variant="light"
            onPress={onClose}
            isDisabled={required}
            aria-label="Close API key modal"
            tooltip="Dismiss API key settings"
            iconOnly
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </Button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <p style={{ marginTop: 0, marginBottom: 8, fontSize: 13, color: "#655d52" }}>
            Configure endpoint + secret storage. For localhost providers (for example Ollama), API key can be empty.
            {!isTauriRuntime() && " On the web, settings are stored in your browser's local storage."}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#8b8376" }}>Active Source:</span>
            <span className="text-mono" style={{ 
              fontSize: 11, 
              padding: "2px 6px", 
              borderRadius: 4, 
              background: source === "environment" ? "#dcfce7" : source === "device" ? "#fef9c3" : "#f3f4f6",
              color: source === "environment" ? "#166534" : source === "device" ? "#854d0e" : "#374151"
            }}>
              {source || "missing"}
            </span>
          </div>
        </div>

        {showConfirm && (
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            borderRadius: 8, 
            background: "#fffbeb", 
            border: "1px solid #fef3c7",
            display: "flex",
            flexDirection: "column",
            gap: 10
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round">
                <path d="m12 9 0 4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>Change API Key?</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#b45309" }}>
              This will override the current key from <strong>{source}</strong>. Are you sure you want to proceed?
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button size="sm" variant="light" onPress={() => setShowConfirm(false)}>Cancel</Button>
              <Button size="sm" color="primary" onPress={onSave}>Confirm Change</Button>
            </div>
          </div>
        )}

        <div className="panel-grid">
          <Input
            value={apiUrl}
            onChange={(e) => onApiUrlChange(e.target.value)}
            placeholder="API URL (optional): https://openrouter.ai/api/v1/chat/completions"
          />
          <Input
            value={apiKeyFile}
            onChange={(e) => onApiKeyFileChange(e.target.value)}
            placeholder="Key file path (optional): .voice-humanizer/openrouter_api_key"
          />
          <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="sk-or-..." autoFocus />
        </div>

        <div className="toolbar-row" style={{ justifyContent: "space-between", marginTop: 16 }}>
          <Button
            variant="bordered"
            onPress={onClear}
            isDisabled={loading}
            aria-label="Clear saved key"
            tooltip="Remove the saved API key from local storage"
            iconOnly
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="m19 6-1 14H6L5 6" />
            </svg>
          </Button>
          <Button
            color="primary"
            onPress={handleSaveClick}
            isDisabled={loading || !value.trim() || showConfirm}
            aria-label={loading ? "Saving API key" : "Save API key"}
            tooltip={loading ? "Saving provider settings" : "Save the API key and provider settings"}
            iconOnly
          >
            {loading ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                <path d="M17 21v-8H7v8" />
                <path d="M7 3v5h8" />
              </svg>
            )}
          </Button>
        </div>
    </Modal>
  );
}
