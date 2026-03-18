import { useRef } from "react";
import { NativeSelect, Text } from "@mantine/core";
import { Button, Card } from "./AppUI.jsx";
import { APP_THEME_OPTIONS } from "../constants/index.js";
import { isTauriRuntime } from "../lib/tauri.js";

export default function ManagementPanel({
  themeKey,
  onThemeChange,
  clichesUpdatedAt,
  cliches,
  onRefreshCliches,
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
          <Button variant="bordered" onPress={onRefreshCliches} isDisabled={clicheFetching} aria-label="Refresh AI terms" tooltip="Refresh the AI-term filter list" iconOnly>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </Button>
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

      {isTauriRuntime() ? (
        <Card className="app-card">
          <Card.Content className="panel-grid p-3">
            <label className="panel-title">
              Provider
            </label>
            <Button variant="bordered" onPress={onOpenApiKey} aria-label="Open API key settings" tooltip="Open API key settings" iconOnly>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7.5" cy="15.5" r="5.5" />
                <path d="m21 2-9.6 9.6" />
                <path d="m15.5 5.5 3 3" />
              </svg>
            </Button>
          </Card.Content>
        </Card>
      ) : null}

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
    </div>
  );
}
