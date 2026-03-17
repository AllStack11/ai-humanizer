const PROFILE_FILTER_RULES = [
  {
    // Balanced/Professional/Formal tones enforce their own punctuation norms
    when: ({ toneLevel }) => toneLevel >= 2,
    suppress: ["punctuationHabits"],
  },
  {
    // Format presets impose structure that overrides personal punctuation habits
    when: ({ formatPreset }) => formatPreset !== "none",
    suppress: ["punctuationHabits"],
  },
  {
    // Professional/Formal: quirks undermine credibility; emotional expressiveness conflicts with measured tone
    when: ({ toneLevel }) => toneLevel >= 3,
    suppress: ["quirks", "emotionalRegister"],
  },
  {
    // Twitter posts: character limit physically enforces its own structure and rhythm
    when: ({ formatPreset }) => formatPreset === "twitter-post",
    suppress: ["sentenceStructure", "rhythm"],
  },
  {
    // Reports require objectivity — personal quirks and emotional expression compromise this
    when: ({ formatPreset }) => formatPreset === "report",
    suppress: ["quirks", "emotionalRegister"],
  },
  {
    // Email preset: professional correspondence can't have idiosyncratic quirks
    when: ({ formatPreset }) => formatPreset === "email",
    suppress: ["quirks"],
  },
];

export function filterProfileForContext(profile, context) {
  if (!profile) return profile;
  const suppressed = new Set();
  for (const rule of PROFILE_FILTER_RULES) {
    if (rule.when(context)) rule.suppress.forEach((f) => suppressed.add(f));
  }
  if (!suppressed.size) return profile;
  return Object.fromEntries(Object.entries(profile).filter(([key]) => !suppressed.has(key)));
}

export function describeProfileFilter(profile, filteredProfile) {
  if (!profile) return { message: "No profile.", detail: "" };
  const allFields = Object.keys(profile);
  const sentFields = Object.keys(filteredProfile);
  const suppressedFields = allFields.filter((f) => !sentFields.includes(f));
  const message = suppressedFields.length
    ? `Profile filtered: ${suppressedFields.length} field${suppressedFields.length > 1 ? "s" : ""} suppressed.`
    : "Full profile sent.";
  const detail = [
    `Sent: ${sentFields.join(", ")}`,
    suppressedFields.length ? `Suppressed: ${suppressedFields.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  return { message, detail };
}
