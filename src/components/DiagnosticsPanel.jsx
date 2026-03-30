import { Button, Card } from "./AppUI.jsx";
import { classifyRequestIssue } from "../features/app/helpers.js";

const ROUTE_LABELS = {
  "app:init:start": "App startup started",
  "app:init:profiles_loaded": "Profiles loaded",
  "app:init:config_loaded": "App configuration loaded",
  "app:init:failed": "App startup failed",
  "app:profile:active_changed": "Active profile changed",
  "profile:reset": "Profile reset",
  "profile:train:json_parse_failed": "Profile training parse failed",
  "profile:train:invalid_profile_shape": "Profile training invalid shape",
  "profile:train:request_failed": "Profile training request failed",
};

const STATUS_META = {
  success: { label: "Success", tone: "success" },
  ok: { label: "Success", tone: "success" },
  info: { label: "Info", tone: "info" },
  warning: { label: "Warning", tone: "warning" },
  canceled: { label: "Canceled", tone: "warning" },
  failed: { label: "Failed", tone: "error" },
  error: { label: "Error", tone: "error" },
};

function startCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getFriendlyRouteLabel(route) {
  if (!route || typeof route !== "string") return "Unknown diagnostic event";
  if (ROUTE_LABELS[route]) return ROUTE_LABELS[route];
  const parts = String(route).split(":").filter(Boolean);
  if (!parts.length) return "Unknown event";
  return parts.map(startCase).join(" -> ");
}

function getStatusMeta(status) {
  const key = String(status || "info").toLowerCase();
  return STATUS_META[key] || { label: startCase(key) || "Info", tone: "info" };
}

function resolveRoute(log) {
  if (typeof log?.route === "string" && log.route.trim()) return log.route.trim();
  if (typeof log?.request?.route === "string" && log.request.route.trim()) return log.request.route.trim();
  if (typeof log?.request?.event === "string" && log.request.event.trim()) return log.request.event.trim();
  return "unknown-route";
}

function resolveStatus(log) {
  const raw = typeof log?.status === "string" ? log.status.trim().toLowerCase() : "";
  if (raw) return raw;
  if (log?.error && classifyRequestIssue(log.error).status === "canceled") return "canceled";
  if (log?.error) return "error";
  return "info";
}

function resolveIssue(log) {
  if (log?.errorSummary || log?.errorDetail || log?.userMessage) {
    return {
      summary: log.errorSummary || "Request failed.",
      detail: log.errorDetail || log.error || "",
      userMessage: log.userMessage || log.error || "",
      kind: log.errorKind || "request_failed",
    };
  }
  return classifyRequestIssue(log?.error || "");
}

function resolveModeLabel(log) {
  if (log?.stream === true) return "Streaming";
  if (log?.stream === false) return "Event / JSON";
  return "Unknown mode";
}

function resolveModelOrTokens(log) {
  if (log?.usage?.total_tokens != null) return `${log.usage.total_tokens} tokens`;
  if (typeof log?.model === "string" && log.model.trim()) return `Model: ${log.model.trim()}`;
  return "Model: n/a";
}

function EventIcon({ route, statusTone }) {
  if (statusTone === "error") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  const normalized = String(route || "").toLowerCase();
  if (normalized.includes("init")) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12 5 5L20 7" />
      </svg>
    );
  }

  if (normalized.includes("profile")) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21a8 8 0 1 0-16 0" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }

  if (normalized.includes("stream")) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12h5" />
        <path d="M17 12h5" />
        <path d="M7 12a5 5 0 0 1 10 0" />
      </svg>
    );
  }

  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  );
}

function DiagnosticsContent({ requestLogs, logsLoading, onRefresh, onClear }) {
  return (
    <Card className="app-card" radius="lg">
      <Card.Content className="panel-grid p-3">
        <div className="toolbar-row text-mono diagnostics-toolbar-row">
          <span>Recent requests: {requestLogs.length}</span>
          <span>{logsLoading ? "Refreshing..." : "Live (2.5s poll)"}</span>
          <Button size="sm" variant="bordered" onPress={onRefresh} aria-label="Refresh request logs" tooltip="Reload the latest request logs" iconOnly>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </Button>
          <Button size="sm" variant="bordered" onPress={onClear} aria-label="Clear request logs" tooltip="Delete the stored request log history" iconOnly>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="m19 6-1 14H6L5 6" />
            </svg>
          </Button>
        </div>

        {requestLogs.length === 0 ? (
          <div className="diagnostics-empty">No request logs yet.</div>
        ) : (
          requestLogs.map((log, index) => {
            const resolvedRoute = resolveRoute(log);
            const resolvedStatus = resolveStatus(log);
            const statusMeta = getStatusMeta(resolvedStatus);
            const issue = resolveIssue(log);
            const fallbackId = `${log?.startedAt || "log"}-${resolvedRoute}-${index}`;

            return (
            <details key={log?.id || fallbackId} className="debug-log">
              <summary className="diagnostic-log-summary">
                <div className="diagnostic-log-heading">
                  <span className={`diagnostic-log-icon diagnostic-log-icon--${statusMeta.tone}`} aria-hidden="true">
                    <EventIcon route={resolvedRoute} statusTone={statusMeta.tone} />
                  </span>
                  <div className="diagnostic-log-heading-copy">
                    <span className="diagnostic-log-title">{getFriendlyRouteLabel(resolvedRoute)}</span>
                    <span className="text-mono diagnostic-log-route" title={resolvedRoute}>
                      {resolvedRoute}
                    </span>
                  </div>
                </div>
                <div className="text-mono diagnostic-log-meta">
                  <span className={`diagnostic-chip diagnostic-chip--status diagnostic-chip--${statusMeta.tone}`}>
                    {statusMeta.label}
                  </span>
                  <span className="diagnostic-chip">{resolveModeLabel(log)}</span>
                  <span className="diagnostic-chip">{log.durationMs != null ? `${log.durationMs} ms` : "No duration"}</span>
                  <span className="diagnostic-chip">{resolveModelOrTokens(log)}</span>
                </div>
              </summary>
              <div className="diagnostic-log-detail-grid">
                {log.error ? <DebugBlock title="Issue summary" content={issue.summary || "(empty)"} danger={resolvedStatus !== "canceled"} /> : null}
                {log.userMessage || issue.userMessage ? <DebugBlock title="User-facing message" content={log.userMessage || issue.userMessage || "(empty)"} /> : null}
                {log.errorDetail || issue.detail ? <DebugBlock title="Issue detail" content={log.errorDetail || issue.detail || "(empty)"} danger={resolvedStatus !== "canceled"} /> : null}
                <DebugBlock title="System prompt" content={log.request?.system || "(empty)"} />
                <DebugBlock title="User prompt/messages" content={JSON.stringify(log.request?.messages || [], null, 2)} />
                <DebugBlock title="Usage / tokens" content={JSON.stringify(log.usage || {}, null, 2)} />
                <DebugBlock title="Response preview" content={log.responsePreview || "(empty)"} />
                {log.error ? <DebugBlock title="Error" content={log.error} danger /> : null}
              </div>
            </details>
          );
          })
        )}
      </Card.Content>
    </Card>
  );
}

export default function DiagnosticsPanel({
  logsOpen,
  onToggle,
  requestLogs,
  logsLoading,
  onRefresh,
  onClear,
  collapsible = true,
}) {
  if (!collapsible) {
    return <DiagnosticsContent requestLogs={requestLogs} logsLoading={logsLoading} onRefresh={onRefresh} onClear={onClear} />;
  }

  return (
    <details open={logsOpen} onToggle={onToggle}>
      <summary className="text-mono diagnostics-summary-toggle">
        Diagnostics {logsOpen ? "▲" : "▼"}
      </summary>
      <DiagnosticsContent requestLogs={requestLogs} logsLoading={logsLoading} onRefresh={onRefresh} onClear={onClear} />
    </details>
  );
}

function DebugBlock({ title, content, danger = false }) {
  return (
    <div className="debug-block">
      <div className="text-mono debug-block-title">{title}</div>
      <pre className={`debug-block-content${danger ? " debug-block-content--danger" : ""}`}>
        {content}
      </pre>
    </div>
  );
}
