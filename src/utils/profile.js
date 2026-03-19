import { WRITING_SAMPLE_TYPES, DEFAULT_SAMPLE_TYPE, PROFILE_OPTIONS, PRIMARY_PROFILE_ID, DEFAULT_PROFILE_META } from '../constants/index.js';

function normalizeSampleTypeKey(rawValue = "") {
  return String(rawValue)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolveSampleType(rawType) {
  if (typeof rawType !== "string" || !rawType.trim()) return DEFAULT_SAMPLE_TYPE;
  const candidate = rawType.trim();
  if (WRITING_SAMPLE_TYPES.some((entry) => entry.value === candidate)) return candidate;

  const normalizedInput = normalizeSampleTypeKey(candidate);
  for (const type of WRITING_SAMPLE_TYPES) {
    if (normalizeSampleTypeKey(type.label) === normalizedInput) return type.value;
    if (normalizeSampleTypeKey(type.shortLabel) === normalizedInput) return type.value;
  }

  if (["question", "questions", "qa", "q a", "q and a", "question answer", "question answers"].includes(normalizedInput)) {
    return "question";
  }
  if (["text convo", "text conversation", "text msg", "text message", "texts"].includes(normalizedInput)) {
    return "text-convo";
  }
  return DEFAULT_SAMPLE_TYPE;
}

export function normalizeSampleSlot(slot, fallbackId) {
  return {
    id: slot?.id ?? fallbackId,
    text: slot?.text || "",
    type: resolveSampleType(slot?.type),
  };
}

export function getFilledSlots(slots) {
  return slots
    .map((slot, i) => normalizeSampleSlot(slot, i + 1))
    .filter(slot => slot.text.trim().length > 50);
}

export function formatSampleForPrompt(sample, index) {
  const typeLabel = WRITING_SAMPLE_TYPES.find(t => t.value === sample.type)?.label || "General writing";
  return `--- Sample ${index + 1} (${typeLabel}) ---\n${sample.text.trim()}`;
}

export function normalizeStoredStyles(rawStyles) {
  const normalized = {};
  const allEntries = Object.entries(rawStyles || {});
  for (const [id, style] of allEntries) {
    const sampleEntries = Array.isArray(style.sampleEntries)
      ? style.sampleEntries
          .map((sample, i) => normalizeSampleSlot(sample, i + 1))
          .filter(sample => sample.text.trim().length > 0)
      : (Array.isArray(style.samples) ? style.samples : [])
          .map((text, i) => normalizeSampleSlot({ id: i + 1, text, type: DEFAULT_SAMPLE_TYPE }, i + 1))
          .filter(sample => sample.text.trim().length > 0);
    const targetId = id === PRIMARY_PROFILE_ID ? "personal" : id;
    const profileName = PROFILE_OPTIONS.find((p) => p.id === targetId)?.label || style.name || "Custom";
    normalized[targetId] = {
      ...style,
      id: targetId,
      name: profileName,
      sampleEntries,
      samples: sampleEntries.map(sample => sample.text),
      sampleCount: sampleEntries.length,
      meta: normalizeProfileMeta(style.meta),
    };
  }
  if (!Object.keys(normalized).length) return normalized;
  return normalized;
}

export function normalizeProfileMeta(rawMeta) {
  return {
    goals:    Array.isArray(rawMeta?.goals)          ? rawMeta.goals    : DEFAULT_PROFILE_META.goals,
    audience: typeof rawMeta?.audience === "string"  ? rawMeta.audience : DEFAULT_PROFILE_META.audience,
    domains:  Array.isArray(rawMeta?.domains)        ? rawMeta.domains  : DEFAULT_PROFILE_META.domains,
    notes:    typeof rawMeta?.notes === "string"     ? rawMeta.notes    : DEFAULT_PROFILE_META.notes,
  };
}

const HIGH_EVIDENCE_TRAITS = new Set(["quirks", "humor", "transitionStyle"]);

const ALL_TRAIT_KEYS = [
  "tone", "sentenceStructure", "vocabulary", "punctuationHabits",
  "quirks", "perspective", "rhythm", "emotionalRegister",
  "formality", "humor", "transitionStyle",
];

export function computeTraitConfidence(profileRecord) {
  const sampleEntries = Array.isArray(profileRecord?.sampleEntries) ? profileRecord.sampleEntries : [];
  const sampleCount = sampleEntries.length;
  const typeDiversity = new Set(sampleEntries.map(e => e.type).filter(Boolean)).size;

  const confidence = {};
  for (const key of ALL_TRAIT_KEYS) {
    const hasValue = !!profileRecord?.profile?.[key];
    if (!hasValue) { confidence[key] = "low"; continue; }
    const needsHighEvidence = HIGH_EVIDENCE_TRAITS.has(key);
    const sampleThreshold = needsHighEvidence ? 4 : 3;
    const typeThreshold   = needsHighEvidence ? 3 : 2;
    if (sampleCount >= sampleThreshold && typeDiversity >= typeThreshold) {
      confidence[key] = "high";
    } else if (sampleCount >= 1) {
      confidence[key] = "medium";
    } else {
      confidence[key] = "low";
    }
  }
  return confidence;
}

export function collectCoverageGaps(sampleEntries = []) {
  const covered = new Set(
    (sampleEntries || [])
      .map((entry) => entry?.type)
      .filter((type) => WRITING_SAMPLE_TYPES.some((item) => item.value === type))
  );
  return WRITING_SAMPLE_TYPES.filter((item) => !covered.has(item.value));
}

export function computeProfileHealth(profileRecord) {
  if (!profileRecord) {
    return { score: 0, sampleCount: 0, typeCoverage: 0, missingTypes: WRITING_SAMPLE_TYPES.map((t) => t.label), lastUpdated: null };
  }
  const sampleEntries = Array.isArray(profileRecord.sampleEntries) ? profileRecord.sampleEntries : [];
  const sampleCount = sampleEntries.length;
  const missing = collectCoverageGaps(sampleEntries);
  const typeCoverage = WRITING_SAMPLE_TYPES.length - missing.length;
  const freshnessBonus = profileRecord.updatedAt ? 15 : 0;
  const score = Math.min(100, sampleCount * 8 + typeCoverage * 12 + freshnessBonus);
  return {
    score,
    sampleCount,
    typeCoverage,
    missingTypes: missing.map((item) => item.label),
    lastUpdated: profileRecord.updatedAt || null,
  };
}

export function hasTrainedProfile(profile) {
  const entryCount = Array.isArray(profile?.sampleEntries) ? profile.sampleEntries.length : 0;
  return !!(profile?.profile && entryCount > 0);
}
