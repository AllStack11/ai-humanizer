import { useState } from "react";
import { Modal } from "@mantine/core";
import { Button, Card } from "./AppUI.jsx";
import { WRITING_SAMPLE_TYPES, PROFILE_GOAL_OPTIONS, PROFILE_DOMAIN_OPTIONS } from "../constants/index.js";

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

export default function WritingProfileModal({ profile, health, profileLabel, hasProfile, confidence, meta, onUpdateMeta, onUpdateProfile, onClose }) {
  const [editingTrait, setEditingTrait] = useState(null);
  const [draftValue, setDraftValue]     = useState("");

  function startEdit(key) {
    setEditingTrait(key);
    setDraftValue(profile[key] || "");
  }

  function saveTrait() {
    onUpdateProfile({ [editingTrait]: draftValue });
    setEditingTrait(null);
  }

  return (
    <Modal
      opened
      onClose={onClose}
      centered
      size="1000px"
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
              {PROFILE_TRAITS.filter(([, key]) => profile[key]).map(([label, key]) => {
                const isEditing = editingTrait === key;
                return (
                  <div key={key} className="debug-block">
                    <div className="toolbar-row" style={{ marginBottom: 4, gap: 6 }}>
                      <p className="panel-title" style={{ margin: 0 }}>{label}</p>
                      {confidence?.[key] && (
                        <span className={`confidence-badge confidence-badge--${confidence[key]}`}>
                          {confidence[key]}
                        </span>
                      )}
                      {onUpdateProfile && (
                        isEditing ? (
                          <Button
                            variant="light"
                            size="sm"
                            iconOnly
                            onPress={saveTrait}
                            aria-label={`Save ${label}`}
                            tooltip="Save"
                            style={{ marginLeft: "auto" }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </Button>
                        ) : (
                          <Button
                            variant="light"
                            size="sm"
                            iconOnly
                            onPress={() => startEdit(key)}
                            aria-label={`Edit ${label}`}
                            tooltip="Edit"
                            style={{ marginLeft: "auto" }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </Button>
                        )
                      )}
                    </div>
                    {isEditing ? (
                      <textarea
                        className="app-input debug-block-content"
                        autoFocus
                        value={draftValue}
                        rows={4}
                        onChange={(e) => setDraftValue(e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", margin: 0, overflowY: "auto" }}
                      />
                    ) : (
                      <p className="debug-block-content" style={{ margin: 0 }}>{profile[key]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {onUpdateMeta && (
            <div>
              <h3 className="text-mono" style={{ margin: "0 0 8px", fontSize: 12 }}>Profile Context</h3>
              <Card className="app-card" radius="lg">
                <Card.Content className="panel-grid p-3">
                  <div>
                    <label className="text-mono" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Writing Goals</label>
                    <div className="toolbar-row" style={{ flexWrap: "wrap", gap: 6 }}>
                      {PROFILE_GOAL_OPTIONS.map(({ value, label }) => {
                        const active = meta?.goals?.includes(value);
                        return (
                          <button
                            key={value}
                            className={`profile-meta-chip${active ? " profile-meta-chip--active" : ""}`}
                            onClick={() => {
                              const current = meta?.goals || [];
                              onUpdateMeta({ goals: active ? current.filter(g => g !== value) : [...current, value] });
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="text-mono" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Content Domains</label>
                    <div className="toolbar-row" style={{ flexWrap: "wrap", gap: 6 }}>
                      {PROFILE_DOMAIN_OPTIONS.map(({ value, label }) => {
                        const active = meta?.domains?.includes(value);
                        return (
                          <button
                            key={value}
                            className={`profile-meta-chip${active ? " profile-meta-chip--active" : ""}`}
                            onClick={() => {
                              const current = meta?.domains || [];
                              onUpdateMeta({ domains: active ? current.filter(d => d !== value) : [...current, value] });
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="text-mono" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Target Audience</label>
                    <input
                      className="app-input"
                      type="text"
                      key={meta?.audience}
                      defaultValue={meta?.audience || ""}
                      placeholder="e.g. tech professionals, general public"
                      onBlur={(e) => onUpdateMeta({ audience: e.target.value })}
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label className="text-mono" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Notes</label>
                    <textarea
                      className="app-input"
                      key={meta?.notes}
                      defaultValue={meta?.notes || ""}
                      placeholder="Personal notes about this profile (not sent to AI)"
                      rows={2}
                      onBlur={(e) => onUpdateMeta({ notes: e.target.value })}
                      style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }}
                    />
                  </div>
                </Card.Content>
              </Card>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
