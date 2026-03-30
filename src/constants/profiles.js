export const WRITER_DRAFT_KEY = "writer-editor-draft-v1";
export const STYLE_MODAL_DRAFT_KEY = "style-modal-draft-v1";
export const MODEL_PREF_KEY = "selected-model-v1";
export const FEATURE_MODEL_PREF_KEY = "feature-model-v1";
export const CUSTOM_PROFILES_KEY = "custom-profiles-v1";

export const WRITING_SAMPLE_TYPES = [
  { value: "general", label: "General writing", shortLabel: "General" },
  { value: "question", label: "Questions / Q&A", shortLabel: "Q&A" },
  { value: "journal", label: "Journal entry", shortLabel: "Journal" },
  { value: "text-convo", label: "Text conversation", shortLabel: "Text convo" },
  { value: "email", label: "Email", shortLabel: "Email" },
];

export const DEFAULT_SAMPLE_TYPE = WRITING_SAMPLE_TYPES[0].value;

export const PROFILE_OPTIONS = [
  { id: "personal", label: "Personal" },
  { id: "work", label: "Work" },
  { id: "social", label: "Social Media" },
];

export const DEFAULT_SLOTS = [
  { id: 1, text: "", type: DEFAULT_SAMPLE_TYPE },
  { id: 2, text: "", type: DEFAULT_SAMPLE_TYPE },
];

export const PROFILE_GOAL_OPTIONS = [
  { value: "inform",    label: "Inform" },
  { value: "persuade",  label: "Persuade" },
  { value: "entertain", label: "Entertain" },
  { value: "connect",   label: "Connect" },
  { value: "inspire",   label: "Inspire" },
];

export const PROFILE_DOMAIN_OPTIONS = [
  { value: "technology", label: "Technology" },
  { value: "personal",   label: "Personal" },
  { value: "business",   label: "Business" },
  { value: "creative",   label: "Creative" },
  { value: "academic",   label: "Academic" },
];

export const DEFAULT_PROFILE_META = {
  goals:    [],
  audience: "",
  domains:  [],
  notes:    "",
};
