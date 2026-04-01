import { useState } from "react";
import { Modal } from "@mantine/core";
import { Button } from "./AppUI.jsx";

export default function ResetConfirmModal({ onClose, onConfirm }) {
  const [confirmStepOpen, setConfirmStepOpen] = useState(false);

  return (
    <Modal
      opened
      onClose={onClose}
      centered
      size="sm"
      withCloseButton={false}
      closeOnClickOutside={true}
      classNames={{ content: "modal-content", body: "panel-grid" }}
      zIndex={500}
    >
      <div className="toolbar-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Reset To Factory Settings</h2>
        <Button
          variant="light"
          onPress={onClose}
          aria-label="Close reset modal"
          tooltip="Cancel"
          iconOnly
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      </div>

      <p style={{ marginTop: 0, marginBottom: 8, fontSize: 13 }}>
        This will permanently erase all app-managed local data and return the app to first-launch state. <strong>This cannot be undone.</strong>
      </p>

      <ul style={{ margin: "0 0 16px 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
        <li>All writing profiles (custom profiles deleted, built-in profiles reset)</li>
        <li>Output history and session data</li>
        <li>Saved preferences, model choices, and runtime API settings</li>
        <li>Stored API keys and local provider configuration</li>
        <li>AI terms, hidden terms, and punctuation bans</li>
        <li>Style backups and imported custom models</li>
        <li>Debug logs and request history</li>
      </ul>

      <p style={{ marginTop: 0, marginBottom: 16, fontSize: 12, color: "#655d52" }}>
        Environment-provided API keys are outside the app and cannot be cleared here.
      </p>

      {confirmStepOpen && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            fontSize: 13,
            color: "#991b1b",
          }}
        >
          Are you sure? This will immediately wipe your local profiles, settings, logs, and stored API credentials.
        </div>
      )}

      <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
        <Button variant="bordered" onPress={onClose} aria-label="Cancel factory reset">
          Cancel
        </Button>
        {confirmStepOpen ? (
          <Button color="danger" variant="solid" onPress={onConfirm} aria-label="Confirm final factory reset">
            Yes, Reset Everything
          </Button>
        ) : (
          <Button color="danger" variant="solid" onPress={() => setConfirmStepOpen(true)} aria-label="Continue factory reset">
            Continue
          </Button>
        )}
      </div>
    </Modal>
  );
}
