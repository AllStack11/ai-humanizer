import { Modal } from "@mantine/core";
import { Button } from "./AppUI.jsx";

export default function ResetConfirmModal({ onClose, onConfirm }) {
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
        <h2 style={{ margin: 0 }}>Reset App Data</h2>
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
        This will permanently erase all local app data. <strong>This cannot be undone.</strong>
      </p>

      <ul style={{ margin: "0 0 16px 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
        <li>All writing profiles (custom profiles deleted, built-in profiles reset)</li>
        <li>Output history and session data</li>
        <li>Saved drafts and preferences</li>
        <li>API key (stored on disk)</li>
        <li>Style backups</li>
        <li>Debug logs and request history</li>
      </ul>

      <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
        <Button variant="bordered" onPress={onClose} aria-label="Cancel reset">
          Cancel
        </Button>
        <Button color="danger" variant="solid" onPress={onConfirm} aria-label="Confirm full reset">
          Reset Everything
        </Button>
      </div>
    </Modal>
  );
}
