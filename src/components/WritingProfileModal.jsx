import { Modal } from "@mantine/core";
import { Button, Card } from "./AppUI.jsx";
import { WRITING_SAMPLE_TYPES } from "../constants/index.js";

const PROFILE_TRAITS = [
  ["Tone", "tone"],
  ["Emotional Register", "emotionalRegister"],
  ["Vocabulary", "vocabulary"],
  ["Perspective", "perspective"],
  ["Sentence Structure", "sentenceStructure"],
  ["Rhythm", "rhythm"],
  ["Punctuation Habits", "punctuationHabits"],
  ["Quirks", "quirks"],
  ["Formality", "formality"],
  ["Humor", "humor"],
  ["Transition Style", "transitionStyle"],
];

export default function WritingProfileModal({ profile, health, profileLabel, hasProfile, confidence, onClose }) {
  return (
    <Modal
      opened
      onClose={onClose}
      centered
      size="lg"
      classNames={{ content: "modal-content", body: "panel-grid" }}
      withCloseButton={false}
    >
      <div className="toolbar-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>
          {profileLabel ? `${profileLabel} Writing Profile` : "Writing Profile"}
        </h2>
        <Button
          variant="light"
          onPress={onClose}
          aria-label="Close profile modal"
          tooltip="Close"
          iconOnly
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      </div>

      {health ? (
        <Card className="app-card style-health-card" radius="lg">
          <Card.Content className="toolbar-row style-health-strip p-3">
            <span className="style-health-chip text-mono">
              {`${health.sampleCount || 0} sample${health.sampleCount === 1 ? "" : "s"}`}
            </span>
            <span className="text-mono style-health-kicker">Profile health</span>
            <span className="style-health-score">{health.score}/100</span>
            <span className="text-mono style-health-meta">
              coverage {health.typeCoverage}/{WRITING_SAMPLE_TYPES.length}
            </span>
          </Card.Content>
        </Card>
      ) : null}

      {!hasProfile ? (
        <Card className="app-card" radius="lg">
          <Card.Content className="p-3" style={{ textAlign: "center", padding: "32px 16px" }}>
            <p style={{ margin: 0, color: "#9b8e7e", fontSize: 14 }}>
              No profile trained yet. Add writing samples to get started.
            </p>
          </Card.Content>
        </Card>
      ) : (
        <>
          {profile?.summary && (
            <div className="debug-block" style={{ borderRadius: 12, overflow: "hidden" }}>
              <p className="panel-title" style={{ marginBottom: 6 }}>Summary</p>
              <p className="debug-block-content" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
                {profile.summary}
              </p>
            </div>
          )}

          {profile && (
            <div className="diagnostic-log-detail-grid">
              {PROFILE_TRAITS.filter(([, key]) => profile[key]).map(([label, key]) => (
                <div key={key} className="debug-block">
                  <div className="toolbar-row" style={{ marginBottom: 4, gap: 6 }}>
                    <p className="panel-title" style={{ margin: 0 }}>{label}</p>
                    {confidence?.[key] && (
                      <span className={`confidence-badge confidence-badge--${confidence[key]}`}>
                        {confidence[key]}
                      </span>
                    )}
                  </div>
                  <p className="debug-block-content" style={{ margin: 0 }}>{profile[key]}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
