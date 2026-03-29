import { useRef, useState } from "react";
import { Modal, NativeSelect, Text, TextInput } from "@mantine/core";
import { Button, Card } from "./AppUI.jsx";
import { APP_THEME_OPTIONS } from "../constants/index.js";
import { isTauriRuntime } from "../lib/tauri.js";

export default function ManagementPanel({
  themeKey,
  onThemeChange,
  clichesUpdatedAt,
  cliches,
  onRefreshCliches,
  onUpdateCliches,
  clicheFetching,
  hasProfile,
  isCustomProfile,
  onExportProfile,
  onImportProfile,
  onOpenApiKey,
  onResetProfile,
  onDeleteProfile,
  onFullAppReset,
}) {
  const importInputRef = useRef(null);
  const [clicheListOpen, setClicheListOpen] = useState(false);
  const [newTerm, setNewTerm] = useState("");

  return (
    <div className="panel-grid controls-panel">
      <Card className="app-card">
        <Card.Content className="panel-grid p-3">
          <label className="panel-title">
            Appearance
          </label>
          <NativeSelect
            aria-label="Theme"
            value={themeKey}
            onChange={(e) => onThemeChange(e.target.value)}
            data={APP_THEME_OPTIONS.map((theme) => ({ value: theme.value, label: theme.label }))}
            className="app-select-wrap"
          />
        </Card.Content>
      </Card>

      <Card className="app-card">
        <Card.Content className="panel-grid p-3">
          <label className="panel-title">
            AI Terms
          </label>
          <Text className="text-mono" size="xs">{clichesUpdatedAt ? `${cliches.length} terms · ${clichesUpdatedAt.toLocaleDateString()}` : "Not loaded yet"}</Text>
          <div className="toolbar-row">
            <Button variant="bordered" onPress={onRefreshCliches} isDisabled={clicheFetching} aria-label="Refresh AI terms" tooltip="Refresh the AI-term filter list" iconOnly>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </Button>
            <Button variant="bordered" onPress={() => setClicheListOpen(true)} aria-label="View AI terms" tooltip="View all AI terms" iconOnly>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </Button>
          </div>
        </Card.Content>
      </Card>

      <Card className="app-card">
        <Card.Content className="panel-grid p-3">
          <label className="panel-title">
            Profile Data
          </label>
          <div className="toolbar-row">
            {hasProfile ? (
              <Button variant="bordered" onPress={onExportProfile} aria-label="Export profile" tooltip="Export the current profile" iconOnly>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              </Button>
            ) : null}
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={(e) => {
                onImportProfile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button variant="bordered" onPress={() => importInputRef.current?.click()} aria-label="Import profile" tooltip="Import a saved profile" iconOnly>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 21V9" />
                <path d="m7 14 5-5 5 5" />
                <path d="M5 3h14" />
              </svg>
            </Button>
            {hasProfile ? (
              <Button color="danger" variant="bordered" onPress={onResetProfile} aria-label="Reset profile" tooltip="Reset the current profile data" iconOnly>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="m19 6-1 14H6L5 6" />
                </svg>
              </Button>
            ) : null}
            {isCustomProfile ? (
              <Button color="danger" variant="solid" onPress={onDeleteProfile} aria-label="Delete profile" tooltip="Permanently delete this custom profile" iconOnly>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </Button>
            ) : null}
          </div>
        </Card.Content>
      </Card>

      <Card className="app-card">
        <Card.Content className="panel-grid p-3">
          <label className="panel-title">
            Provider
          </label>
          <div className="toolbar-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#655d52" }}>API Key & Custom URL</span>
            <Button variant="bordered" onPress={onOpenApiKey} aria-label="Open API key settings" tooltip="Manage API keys and providers" iconOnly>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7.5" cy="15.5" r="5.5" />
                <path d="m21 2-9.6 9.6" />
                <path d="m15.5 5.5 3 3" />
              </svg>
            </Button>
          </div>
        </Card.Content>
      </Card>

      <Card className="app-card">
        <Card.Content className="panel-grid p-3">
          <label className="panel-title" style={{ color: "#b91c1c" }}>
            Danger Zone
          </label>
          <Button color="danger" variant="bordered" onPress={onFullAppReset} aria-label="Full app data reset" tooltip="Delete all local app data" iconOnly>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </Button>
        </Card.Content>
      </Card>
      <Modal
        opened={clicheListOpen}
        onClose={() => { setClicheListOpen(false); setNewTerm(""); }}
        title={<strong>AI Terms ({cliches.length})</strong>}
        zIndex={500}
        scrollAreaComponent="div"
        styles={{ body: { maxHeight: "60vh", overflowY: "auto" } }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "4px 0 12px" }}>
          {cliches.map((term, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px 2px 8px",
                borderRadius: 4,
                border: "1px solid var(--app-border, rgba(255,255,255,0.12))",
                background: "var(--app-surface, rgba(255,255,255,0.04))",
              }}
            >
              <Text size="xs" className="text-mono">{term}</Text>
              <button
                aria-label={`Remove ${term}`}
                onClick={() => onUpdateCliches(cliches.filter((_, j) => j !== i))}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  opacity: 0.5,
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = 0.5)}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <TextInput
            placeholder="Add a term…"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const t = newTerm.trim().toLowerCase();
                if (t && !cliches.includes(t)) { onUpdateCliches([...cliches, t]); }
                setNewTerm("");
              }
            }}
            size="xs"
            style={{ flex: 1 }}
            classNames={{ input: "text-mono" }}
          />
          <button
            aria-label="Add term"
            onClick={() => {
              const t = newTerm.trim().toLowerCase();
              if (t && !cliches.includes(t)) { onUpdateCliches([...cliches, t]); }
              setNewTerm("");
            }}
            style={{
              background: "none",
              border: "1px solid var(--app-border, rgba(255,255,255,0.15))",
              borderRadius: 4,
              padding: "4px 8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </Modal>
    </div>
  );
}
