import { describe, expect, test } from "vitest";
import { filterProfileForContext, describeProfileFilter } from "./profileFilter.js";

const FULL_PROFILE = {
  tone: "warm and conversational",
  sentenceStructure: "short, punchy sentences with occasional fragments",
  vocabulary: "accessible, colloquial, avoids jargon",
  punctuationHabits: "heavy em-dash use, minimal semicolons",
  quirks: "opens with rhetorical questions, ends paragraphs with one-liners",
  perspective: "first-person, direct address to reader",
  rhythm: "rapid, energetic, builds to a point",
  emotionalRegister: "highly expressive and emotionally charged",
  summary: "Casual and direct with a punchy, conversational tone. Uses rhetorical hooks and personal asides liberally.",
};

// ── filterProfileForContext ────────────────────────────────────────────────────

describe("filterProfileForContext", () => {
  describe("passthrough cases", () => {
    test("returns null when profile is null", () => {
      expect(filterProfileForContext(null, { toneLevel: 0, formatPreset: "none" })).toBeNull();
    });

    test("returns full profile for Very Casual tone with no preset", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: "none" });
      expect(Object.keys(result)).toEqual(Object.keys(FULL_PROFILE));
    });

    test("returns full profile for Casual tone with no preset", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 1, formatPreset: "none" });
      expect(Object.keys(result)).toEqual(Object.keys(FULL_PROFILE));
    });

    test("does not mutate the original profile object", () => {
      const snapshot = { ...FULL_PROFILE };
      filterProfileForContext(FULL_PROFILE, { toneLevel: 4, formatPreset: "report" });
      expect(FULL_PROFILE).toEqual(snapshot);
    });
  });

  describe("tone level rules", () => {
    test("suppresses punctuationHabits at Balanced tone (toneLevel=2)", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 2, formatPreset: "none" });
      expect(result).not.toHaveProperty("punctuationHabits");
    });

    test("does not suppress punctuationHabits below Balanced (toneLevel=1)", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 1, formatPreset: "none" });
      expect(result).toHaveProperty("punctuationHabits");
    });

    test("suppresses punctuationHabits, quirks, and emotionalRegister at Professional (toneLevel=3)", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 3, formatPreset: "none" });
      expect(result).not.toHaveProperty("punctuationHabits");
      expect(result).not.toHaveProperty("quirks");
      expect(result).not.toHaveProperty("emotionalRegister");
    });

    test("suppresses punctuationHabits, quirks, and emotionalRegister at Formal (toneLevel=4)", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 4, formatPreset: "none" });
      expect(result).not.toHaveProperty("punctuationHabits");
      expect(result).not.toHaveProperty("quirks");
      expect(result).not.toHaveProperty("emotionalRegister");
    });

    test("preserves tone, vocabulary, sentenceStructure, perspective, rhythm, summary at Professional", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 3, formatPreset: "none" });
      expect(result).toHaveProperty("tone");
      expect(result).toHaveProperty("vocabulary");
      expect(result).toHaveProperty("sentenceStructure");
      expect(result).toHaveProperty("perspective");
      expect(result).toHaveProperty("rhythm");
      expect(result).toHaveProperty("summary");
    });
  });

  describe("format preset rules", () => {
    test("suppresses punctuationHabits for all active presets", () => {
      for (const preset of ["email", "blog-post", "twitter-post", "youtube-description", "report"]) {
        const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: preset });
        expect(result, `preset=${preset}`).not.toHaveProperty("punctuationHabits");
      }
    });

    test("does not suppress punctuationHabits when preset is none", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 1, formatPreset: "none" });
      expect(result).toHaveProperty("punctuationHabits");
    });

    test("suppresses sentenceStructure and rhythm for twitter-post", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: "twitter-post" });
      expect(result).not.toHaveProperty("sentenceStructure");
      expect(result).not.toHaveProperty("rhythm");
    });

    test("preserves vocabulary, tone, quirks, perspective for twitter-post", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: "twitter-post" });
      expect(result).toHaveProperty("tone");
      expect(result).toHaveProperty("vocabulary");
      expect(result).toHaveProperty("quirks");
      expect(result).toHaveProperty("perspective");
    });

    test("suppresses quirks and emotionalRegister for report preset", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: "report" });
      expect(result).not.toHaveProperty("quirks");
      expect(result).not.toHaveProperty("emotionalRegister");
    });

    test("preserves sentenceStructure and rhythm for report preset", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: "report" });
      expect(result).toHaveProperty("sentenceStructure");
      expect(result).toHaveProperty("rhythm");
    });

    test("suppresses quirks for email preset", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: "email" });
      expect(result).not.toHaveProperty("quirks");
    });

    test("preserves emotionalRegister for email preset", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: "email" });
      expect(result).toHaveProperty("emotionalRegister");
    });

    test("does not suppress any extra fields for blog-post preset", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 0, formatPreset: "blog-post" });
      // Only punctuationHabits removed (the shared preset rule)
      expect(Object.keys(result)).toHaveLength(Object.keys(FULL_PROFILE).length - 1);
    });
  });

  describe("rule combinations", () => {
    test("Professional + report preset: suppresses punctuationHabits, quirks, emotionalRegister (deduped)", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 3, formatPreset: "report" });
      expect(result).not.toHaveProperty("punctuationHabits");
      expect(result).not.toHaveProperty("quirks");
      expect(result).not.toHaveProperty("emotionalRegister");
      // tone, vocabulary, sentenceStructure, perspective, rhythm, summary remain
      expect(Object.keys(result)).toHaveLength(6);
    });

    test("Formal + twitter-post: suppresses 5 fields, leaves tone, vocabulary, perspective, summary", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 4, formatPreset: "twitter-post" });
      expect(result).not.toHaveProperty("punctuationHabits");
      expect(result).not.toHaveProperty("quirks");
      expect(result).not.toHaveProperty("emotionalRegister");
      expect(result).not.toHaveProperty("sentenceStructure");
      expect(result).not.toHaveProperty("rhythm");
      expect(Object.keys(result)).toHaveLength(4);
      expect(result).toHaveProperty("tone");
      expect(result).toHaveProperty("vocabulary");
      expect(result).toHaveProperty("perspective");
      expect(result).toHaveProperty("summary");
    });

    test("Balanced + email: suppresses punctuationHabits and quirks", () => {
      const result = filterProfileForContext(FULL_PROFILE, { toneLevel: 2, formatPreset: "email" });
      expect(result).not.toHaveProperty("punctuationHabits");
      expect(result).not.toHaveProperty("quirks");
      expect(Object.keys(result)).toHaveLength(Object.keys(FULL_PROFILE).length - 2);
    });
  });
});

// ── describeProfileFilter ──────────────────────────────────────────────────────

describe("describeProfileFilter", () => {
  test("returns 'No profile.' when profile is null", () => {
    const { message, detail } = describeProfileFilter(null, null);
    expect(message).toBe("No profile.");
    expect(detail).toBe("");
  });

  test("returns 'Full profile sent.' when nothing is suppressed", () => {
    const { message, detail } = describeProfileFilter(FULL_PROFILE, { ...FULL_PROFILE });
    expect(message).toBe("Full profile sent.");
    expect(detail).toMatch(/^Sent:/);
    expect(detail).not.toContain("Suppressed:");
  });

  test("sent detail lists all field names when nothing suppressed", () => {
    const { detail } = describeProfileFilter(FULL_PROFILE, { ...FULL_PROFILE });
    for (const key of Object.keys(FULL_PROFILE)) {
      expect(detail).toContain(key);
    }
  });

  test("reports singular '1 field suppressed' correctly", () => {
    const { punctuationHabits: _, ...filtered } = FULL_PROFILE;
    const { message } = describeProfileFilter(FULL_PROFILE, filtered);
    expect(message).toBe("Profile filtered: 1 field suppressed.");
  });

  test("reports plural '2 fields suppressed' correctly", () => {
    const { quirks: _a, emotionalRegister: _b, ...filtered } = FULL_PROFILE;
    const { message } = describeProfileFilter(FULL_PROFILE, filtered);
    expect(message).toBe("Profile filtered: 2 fields suppressed.");
  });

  test("detail includes suppressed field names after the separator", () => {
    const { punctuationHabits: _a, quirks: _b, ...filtered } = FULL_PROFILE;
    const { detail } = describeProfileFilter(FULL_PROFILE, filtered);
    expect(detail).toContain("Suppressed:");
    expect(detail).toContain("punctuationHabits");
    expect(detail).toContain("quirks");
  });

  test("detail separates sent and suppressed sections with ·", () => {
    const { punctuationHabits: _, ...filtered } = FULL_PROFILE;
    const { detail } = describeProfileFilter(FULL_PROFILE, filtered);
    expect(detail).toContain(" · ");
  });

  test("matches real filterProfileForContext output for Professional tone", () => {
    const filtered = filterProfileForContext(FULL_PROFILE, { toneLevel: 3, formatPreset: "none" });
    const { message, detail } = describeProfileFilter(FULL_PROFILE, filtered);
    expect(message).toBe("Profile filtered: 3 fields suppressed.");
    expect(detail).toContain("Suppressed:");
    expect(detail).toContain("punctuationHabits");
    expect(detail).toContain("quirks");
    expect(detail).toContain("emotionalRegister");
  });
});
