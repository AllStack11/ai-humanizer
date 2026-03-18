import { describe, expect, test } from "vitest";
import { dedupeSampleEntries } from "./helpers.js";

// ── dedupeSampleEntries ────────────────────────────────────────────────────────

describe("dedupeSampleEntries", () => {
  describe("edge cases", () => {
    test("returns empty array for empty input", () => {
      expect(dedupeSampleEntries([])).toEqual([]);
    });

    test("returns empty array for null input", () => {
      expect(dedupeSampleEntries(null)).toEqual([]);
    });

    test("returns empty array for undefined input", () => {
      expect(dedupeSampleEntries(undefined)).toEqual([]);
    });

    test("skips entries with empty text", () => {
      const entries = [
        { id: 1, text: "", type: "general" },
        { id: 2, text: "   ", type: "general" },
      ];
      expect(dedupeSampleEntries(entries)).toHaveLength(0);
    });

    test("skips empty entries but keeps valid ones", () => {
      const entries = [
        { id: 1, text: "", type: "general" },
        { id: 2, text: "Valid sample text that is long enough here.", type: "general" },
      ];
      const result = dedupeSampleEntries(entries);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Valid sample text that is long enough here.");
    });
  });

  describe("deduplication logic", () => {
    test("preserves unique entries", () => {
      const entries = [
        { id: 1, text: "First unique sample text here.", type: "general" },
        { id: 2, text: "Second unique sample text here.", type: "general" },
      ];
      expect(dedupeSampleEntries(entries)).toHaveLength(2);
    });

    test("removes exact duplicate text of the same type", () => {
      const entries = [
        { id: 1, text: "Duplicate sample text here.", type: "general" },
        { id: 2, text: "Duplicate sample text here.", type: "general" },
      ];
      expect(dedupeSampleEntries(entries)).toHaveLength(1);
    });

    test("keeps same text with different types as distinct entries", () => {
      const entries = [
        { id: 1, text: "Same text content here.", type: "general" },
        { id: 2, text: "Same text content here.", type: "email" },
      ];
      expect(dedupeSampleEntries(entries)).toHaveLength(2);
    });

    test("deduplicates case-insensitively", () => {
      const entries = [
        { id: 1, text: "same text content here.", type: "general" },
        { id: 2, text: "SAME TEXT CONTENT HERE.", type: "general" },
      ];
      expect(dedupeSampleEntries(entries)).toHaveLength(1);
    });

    test("deduplicates with whitespace normalization", () => {
      const entries = [
        { id: 1, text: "same  text  content.", type: "general" },
        { id: 2, text: "same text content.", type: "general" },
      ];
      expect(dedupeSampleEntries(entries)).toHaveLength(1);
    });

    test("preserves the first occurrence when deduplicating", () => {
      const entries = [
        { id: 1, text: "Original text content here.", type: "general" },
        { id: 2, text: "Original text content here.", type: "general" },
      ];
      const result = dedupeSampleEntries(entries);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Original text content here.");
    });
  });

  describe("ID renumbering", () => {
    test("renumbers IDs starting from 1", () => {
      const entries = [
        { id: 99, text: "First sample text here.", type: "general" },
        { id: 42, text: "Second sample text here.", type: "general" },
      ];
      const result = dedupeSampleEntries(entries);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    test("renumbers IDs sequentially after deduplication", () => {
      const entries = [
        { id: 1, text: "First sample text here.", type: "general" },
        { id: 2, text: "Duplicate sample text here.", type: "general" },
        { id: 3, text: "Duplicate sample text here.", type: "general" },
        { id: 4, text: "Third sample text here.", type: "general" },
      ];
      const result = dedupeSampleEntries(entries);
      expect(result).toHaveLength(3);
      expect(result.map((e) => e.id)).toEqual([1, 2, 3]);
    });
  });

  // ── Profile merge / remerge scenarios ─────────────────────────────────────

  describe("profile merge scenarios", () => {
    test("merging existing and new entries removes overlapping samples", () => {
      const existingEntries = [
        { id: 1, text: "Existing sample one for profile training.", type: "general" },
        { id: 2, text: "Existing sample two for profile training.", type: "general" },
      ];
      const newEntries = [
        { id: 1, text: "Existing sample one for profile training.", type: "general" }, // duplicate
        { id: 2, text: "Brand new sample added during remerge.", type: "general" },
      ];
      const result = dedupeSampleEntries([...existingEntries, ...newEntries]);
      expect(result).toHaveLength(3);
    });

    test("remerge: existing samples preserved and new unique samples appended", () => {
      const existingEntries = [
        { id: 1, text: "First original writing sample for profile.", type: "general" },
        { id: 2, text: "Second original sample for profile use.", type: "journal" },
      ];
      const newEntries = [
        { id: 1, text: "Second original sample for profile use.", type: "journal" }, // duplicate
        { id: 2, text: "New writing sample added on remerge.", type: "general" },
        { id: 3, text: "Another fresh sample added for remerge.", type: "email" },
      ];
      const result = dedupeSampleEntries([...existingEntries, ...newEntries]);
      expect(result).toHaveLength(4);
      expect(result.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    });

    test("remerge: all-duplicate new batch leaves existing samples unchanged", () => {
      const existingEntries = [
        { id: 1, text: "First original writing sample here.", type: "general" },
        { id: 2, text: "Second original writing sample here.", type: "general" },
      ];
      const duplicateNewEntries = [
        { id: 1, text: "First original writing sample here.", type: "general" },
        { id: 2, text: "Second original writing sample here.", type: "general" },
      ];
      const result = dedupeSampleEntries([...existingEntries, ...duplicateNewEntries]);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("First original writing sample here.");
      expect(result[1].text).toBe("Second original writing sample here.");
    });

    test("remerge: cross-type samples with same text are both kept", () => {
      const existingEntries = [
        { id: 1, text: "Sample text that appears in two forms.", type: "general" },
      ];
      const newEntries = [
        { id: 1, text: "Sample text that appears in two forms.", type: "email" }, // different type
      ];
      const result = dedupeSampleEntries([...existingEntries, ...newEntries]);
      expect(result).toHaveLength(2);
    });

    test("deduped result preserves type from original entries", () => {
      const existingEntries = [
        { id: 1, text: "Original email sample text here.", type: "email" },
      ];
      const newEntries = [
        { id: 1, text: "New general writing sample added.", type: "general" },
      ];
      const result = dedupeSampleEntries([...existingEntries, ...newEntries]);
      expect(result[0].type).toBe("email");
      expect(result[1].type).toBe("general");
    });
  });
});
