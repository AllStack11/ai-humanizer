import { NativeSelect } from "@mantine/core";
import { Button, Card } from "./AppUI.jsx";
import { APP_VERSION } from "../constants/index.js";
import { formatRelativeTime } from "../utils/format.js";

export default function Topbar({
  activeProfileId,
  onProfileChange,
  profiles,
  onAddProfile,
  hasProfile,
  activeProfile,
  backupStatus,
  backupLastSavedAt,
  backupError,
  onRetryBackup,
  onOpenStyleModal,
  onOpenManagement,
  onOpenProfileModal,
}) {
  const backupTone = backupStatus === "error" ? "error" : backupStatus === "ok" ? "ok" : "live";
  const backupLabel =
    backupStatus === "retrying"
      ? "Retrying backup…"
      : backupStatus === "saving"
        ? "Saving backup…"
        : backupStatus === "ok" && backupLastSavedAt
          ? `Backed up ${formatRelativeTime(backupLastSavedAt)}`
          : backupStatus === "error"
            ? "Backup failed"
            : "Backup idle";

  return (
    <header className="app-sticky">
      <Card className="app-card" radius="lg">
        <Card.Content className="panel-grid p-4">
          <div className="app-topbar">
            <div className="toolbar-row" style={{ marginRight: "auto", gap: 12 }}>
              <span className="brand-mark">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </span>
              <div>
                <div className="brand-title">Voice Humanizer</div>
                <div className="brand-subtitle">AI polish tuned to your writing voice · v{APP_VERSION}</div>
              </div>
            </div>

            <div className="app-topbar-actions">
              <div className="app-topbar-controls">
                <NativeSelect
                  aria-label="Profile"
                  value={activeProfileId}
                  onChange={(e) => {
                    if (e.target.value === "__add_new__") {
                      onAddProfile();
                    } else {
                      onProfileChange(e.target.value);
                    }
                  }}
                  data={[
                    ...(profiles || []).map((p) => ({ value: p.id, label: p.label })),
                    { value: "__add_new__", label: "＋ Add profile…" },
                  ]}
                  className="app-select-wrap"
                  styles={{ input: { minWidth: 220 } }}
                />

                <Button
                  size="sm"
                  variant="bordered"
                  onPress={onOpenProfileModal}
                  aria-label="View writing profile"
                  tooltip="View your writing profile"
                  iconOnly
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </Button>

                <Button
                  size="sm"
                  color="primary"
                  variant="solid"
                  onPress={onOpenStyleModal}
                  aria-label={hasProfile ? `Add ${activeProfile.name} samples` : "Start onboarding"}
                  tooltip={hasProfile ? `Add more ${activeProfile.name} writing samples` : "Start profile onboarding"}
                  iconOnly
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </Button>

                <Button
                  size="sm"
                  variant="bordered"
                  onPress={onOpenManagement}
                  aria-label="Settings"
                  tooltip="Open app management"
                  iconOnly
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.12a1.7 1.7 0 0 0-.4-1.08 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H2.8a2 2 0 1 1 0-4h.12a1.7 1.7 0 0 0 1.08-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.08V2.8a2 2 0 1 1 4 0v.12a1.7 1.7 0 0 0 .4 1.08 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.08.4h.12a2 2 0 1 1 0 4h-.12a1.7 1.7 0 0 0-1.08.4 1.7 1.7 0 0 0-.6 1Z" />
                  </svg>
                </Button>
              </div>

              <div className="app-topbar-status text-mono">
                <span
                  className={`backup-status backup-status--${backupTone}${backupStatus === "saving" || backupStatus === "retrying" ? " is-live" : ""}`}
                  title={backupStatus === "error" ? backupError : undefined}
                >
                  <span className="backup-status-dot" aria-hidden="true" />
                  <span>{backupLabel}</span>
                </span>
                {backupStatus === "error" ? (
                  <span style={{ color: "#b91c1c" }} title={backupError}>
                    <Button
                      size="sm"
                      color="danger"
                      variant="light"
                      onPress={onRetryBackup}
                      aria-label="Retry backup"
                      tooltip="Try saving the local backup again"
                      iconOnly
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                        <path d="M21 3v6h-6" />
                      </svg>
                    </Button>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </Card.Content>
      </Card>
    </header>
  );
}
