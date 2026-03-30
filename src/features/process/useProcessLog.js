import { useState } from "react";
import { classifyRequestIssue } from "../app/helpers.js";

export function useProcessLog() {
  const [processSteps, setProcessSteps] = useState([]);
  const [processSummary, setProcessSummary] = useState("");
  const [processError, setProcessError] = useState("");
  const [processNeedsApiKey, setProcessNeedsApiKey] = useState(false);

  function pushProcessStep(message, level = "info", detail = "") {
    setProcessSteps((prev) => [
      ...prev.slice(-11),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message,
        level,
        detail,
        timestamp: new Date().toISOString(),
      },
    ]);
  }

  function startProcessLog(message, detail = "") {
    setProcessSummary(message);
    setProcessError("");
    setProcessNeedsApiKey(false);
    setProcessSteps([
      {
        id: `${Date.now()}-start`,
        message,
        level: "info",
        detail,
        timestamp: new Date().toISOString(),
      },
    ]);
  }

  function logRequestFailure(prefix, message) {
    const issue = classifyRequestIssue(message);
    const level = issue.status === "canceled" ? "warning" : "error";
    pushProcessStep(`${prefix} ${issue.summary}`, level, issue.detail || message);
    setProcessSummary(`${prefix} ${issue.summary}`);
    setProcessError(message);
    setProcessNeedsApiKey(issue.kind === "auth");
  }

  function completeProcess(summary) {
    setProcessSummary(summary);
    setProcessError("");
    setProcessNeedsApiKey(false);
  }

  function resetProcessLog() {
    setProcessSteps([]);
    setProcessSummary("");
    setProcessError("");
    setProcessNeedsApiKey(false);
  }

  return {
    processSteps,
    processSummary,
    processError,
    processNeedsApiKey,
    setProcessSummary,
    setProcessError,
    setProcessNeedsApiKey,
    pushProcessStep,
    startProcessLog,
    logRequestFailure,
    completeProcess,
    resetProcessLog,
  };
}
