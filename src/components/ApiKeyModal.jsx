import { Modal } from "@mantine/core";
import { Button, Input } from "./AppUI.jsx";

export default function ApiKeyModal({
  required,
  value,
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

        <p style={{ marginTop: 0, marginBottom: 14, fontSize: 13, color: "#655d52" }}>
          Configure endpoint + secret storage. For localhost providers (for example Ollama), API key can be empty.
        </p>

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
            onPress={onSave}
            isDisabled={loading || !value.trim()}
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
