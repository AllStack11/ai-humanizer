import { useMemo } from "react";

function inferActiveProgressStep(progressLabel) {
  const text = String(progressLabel || "").toLowerCase();
  if (!text) return 0;
  if (text.includes("complete") || text.includes("final") || text.includes("done") || text.includes("success")) return 2;
  if (
    text.includes("stream") ||
    text.includes("rewrite") ||
    text.includes("expand") ||
    text.includes("model") ||
    text.includes("generat")
  ) return 1;
  return 0;
}

export default function GenerationLoadingToast({
  progressLabel,
  progressTone = "neutral",
  processSteps = [],
  onCancel,
}) {
  const visibleSteps = useMemo(
    () => processSteps.slice(-2).map((step) => ({ id: step.id, message: step.message })),
    [processSteps]
  );
  const activeStepIndex = inferActiveProgressStep(progressLabel);
  const progressPercent = `${Math.max(18, Math.min(100, ((activeStepIndex + 1) / 3) * 100))}%`;

  return (
    <section
      className={`generation-loading-toast generation-loading-toast--integrated generation-loading-toast--${progressTone}`}
      aria-live="polite"
      aria-label={progressLabel || "Generation progress"}
    >
      <div className="generation-loading-toast-copy">
        <span className="text-mono generation-loading-toast-kicker">Generation activity</span>
        <span className="generation-loading-toast-label">{progressLabel || "Working..."}</span>
      </div>
      <div className="generation-loading-toast-actions">
        <button
          type="button"
          className="generation-loading-toast-cancel"
          onClick={() => onCancel?.()}
        >
          Cancel generation
        </button>
      </div>
      {visibleSteps.length ? (
        <div
          className="generation-loading-toast-log-scroll"
          role="log"
          aria-label="Generation activity log"
        >
          {visibleSteps.map((step, index) => (
            <div key={step.id} className="generation-loading-toast-log-line">
              <span className="generation-loading-toast-log-bullet" aria-hidden="true" />
              <span className={`generation-loading-toast-log-message${index === visibleSteps.length - 1 ? " is-current" : ""}`}>
                {step.message}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="generation-loading-toast-track generation-loading-toast-track--integrated" aria-hidden="true">
        <span className="generation-loading-toast-bar" style={{ width: progressPercent }} />
      </div>
    </section>
  );
}
