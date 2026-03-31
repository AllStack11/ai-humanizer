import { describe, expect, test } from "vitest";
import { TIER1_CLICHES } from "../constants/cliches.js";
import {
  buildMetaBlock,
  renderProfileAsProse,
  selectCliches,
  ELABORATE_SYS,
  HUMANIZE_SYS,
  PARTIAL_REGEN_SYS,
  buildPartialRegenUserPrompt,
} from "./prompts.js";

// ─── buildMetaBlock ───────────────────────────────────────────────────────────

describe("buildMetaBlock", () => {
  test("returns empty string for null meta", () => {
    expect(buildMetaBlock(null)).toBe("");
  });

  test("returns empty string for empty meta", () => {
    expect(buildMetaBlock({ goals: [], audience: "", domains: [] })).toBe("");
  });

  test("includes goals when present", () => {
    const block = buildMetaBlock({ goals: ["inform", "persuade"], audience: "", domains: [] });
    expect(block).toContain("Writing goals: inform, persuade.");
  });

  test("includes audience when present", () => {
    const block = buildMetaBlock({ goals: [], audience: "tech professionals", domains: [] });
    expect(block).toContain("Target audience: tech professionals.");
  });

  test("includes domains when present", () => {
    const block = buildMetaBlock({ goals: [], audience: "", domains: ["technology", "business"] });
    expect(block).toContain("Content domains: technology, business.");
  });

  test("combines all three fields", () => {
    const block = buildMetaBlock({
      goals: ["connect"],
      audience: "students",
      domains: ["academic"],
    });
    expect(block).toContain("Writing intent:");
    expect(block).toContain("Writing goals: connect.");
    expect(block).toContain("Target audience: students.");
    expect(block).toContain("Content domains: academic.");
  });

  test("omits empty fields and includes non-empty ones", () => {
    const block = buildMetaBlock({ goals: ["inspire"], audience: "", domains: [] });
    expect(block).toContain("Writing goals: inspire.");
    expect(block).not.toContain("Target audience");
    expect(block).not.toContain("Content domains");
  });
});

// ─── renderProfileAsProse ─────────────────────────────────────────────────────

describe("renderProfileAsProse", () => {
  test("renders each trait as a bullet line", () => {
    const prose = renderProfileAsProse({ tone: "dry and direct", vocabulary: "plain Anglo-Saxon" });
    expect(prose).toContain("- Tone: dry and direct");
    expect(prose).toContain("- Vocabulary: plain Anglo-Saxon");
  });

  test("converts camelCase keys to readable labels", () => {
    const prose = renderProfileAsProse({ sentenceStructure: "short punchy sentences" });
    expect(prose).toContain("- Sentence structure: short punchy sentences");
  });

  test("skips keys with empty or non-string values", () => {
    const prose = renderProfileAsProse({ tone: "warm", quirks: "", humor: null });
    expect(prose).toContain("- Tone: warm");
    expect(prose).not.toContain("quirks");
    expect(prose).not.toContain("humor");
  });

  test("does not contain JSON braces or quoted keys", () => {
    const prose = renderProfileAsProse({ tone: "casual", formality: "informal" });
    expect(prose).not.toContain("{");
    expect(prose).not.toContain('"tone"');
  });
});

// ─── selectCliches ────────────────────────────────────────────────────────────

describe("selectCliches", () => {
  test("returns at most budget items", () => {
    const list = Array.from({ length: 60 }, (_, i) => `phrase${i}`);
    expect(selectCliches(list, 40)).toHaveLength(40);
    expect(selectCliches(list, 10)).toHaveLength(10);
  });

  test("tier-1 clichés appear before non-tier-1 ones", () => {
    const tier1Item = "delve"; // in TIER1_CLICHES
    const nonTier1 = "in conclusion"; // not in TIER1_CLICHES
    // Put non-tier-1 first to verify reordering
    const input = [nonTier1, tier1Item];
    const result = selectCliches(input, 5);
    expect(result.indexOf(tier1Item)).toBeLessThan(result.indexOf(nonTier1));
  });

  test("all returned items are from TIER1_CLICHES when input is only tier-1 terms", () => {
    const allTier1 = [...TIER1_CLICHES];
    const result = selectCliches(allTier1, 5);
    result.forEach((c) => expect(TIER1_CLICHES.has(c)).toBe(true));
  });

  test("handles empty cliché list", () => {
    expect(selectCliches([], 40)).toEqual([]);
  });

  test("returns all items when list is smaller than budget", () => {
    const small = ["delve", "certainly"];
    expect(selectCliches(small, 40)).toEqual(["delve", "certainly"]);
  });
});

// ─── HUMANIZE_SYS ─────────────────────────────────────────────────────────────

describe("HUMANIZE_SYS", () => {
  const profile = { tone: "dry and direct", vocabulary: "plain Anglo-Saxon" };

  test("renders profile as prose bullets, not JSON", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).toContain("- Tone: dry and direct");
    expect(prompt).toContain("- Vocabulary: plain Anglo-Saxon");
    expect(prompt).not.toContain('{"tone"');
  });

  test("includes the profileName in context line", () => {
    const prompt = HUMANIZE_SYS(profile, 2, [], "Work");
    expect(prompt).toContain('"Work" profile');
  });

  test("includes the tone label", () => {
    const prompt = HUMANIZE_SYS(profile, 0, []); // Very Casual
    expect(prompt).toMatch(/Very Casual/i);
  });

  test("includes clichés as a hard constraint", () => {
    const prompt = HUMANIZE_SYS(profile, 2, ["delve", "certainly"]);
    expect(prompt).toContain('"delve"');
    expect(prompt).toContain('"certainly"');
  });

  test("omits cliché constraint when list is empty", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).not.toContain("Hard constraint");
  });

  test("includes meta block when meta provided", () => {
    const meta = { goals: ["inform"], audience: "developers", domains: [] };
    const prompt = HUMANIZE_SYS(profile, 2, [], "Personal", meta);
    expect(prompt).toContain("Writing intent:");
    expect(prompt).toContain("Target audience: developers.");
  });

  test("markdown instruction is present", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).toMatch(/Markdown is supported/i);
  });

  test("speech act rules are present", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).toMatch(/speech act/i);
  });
});

// ─── ELABORATE_SYS ────────────────────────────────────────────────────────────

describe("ELABORATE_SYS", () => {
  const profile = { tone: "analytical", rhythm: "even measured cadence" };

  test("renders profile as prose bullets", () => {
    const prompt = ELABORATE_SYS(profile, 2, 2);
    expect(prompt).toContain("- Tone: analytical");
    expect(prompt).not.toContain('{"tone"');
  });

  test("includes depth instruction in the prompt", () => {
    const promptBrief = ELABORATE_SYS(profile, 2, 1);
    expect(promptBrief).toMatch(/2.+3 sentences/i);
    const promptFull = ELABORATE_SYS(profile, 2, 4);
    expect(promptFull).toMatch(/7.+10 sentences/i);
  });

  test("includes tone label", () => {
    const prompt = ELABORATE_SYS(profile, 4, 2); // Formal
    expect(prompt).toMatch(/Formal/i);
  });

  test("includes markdown formatting guidance", () => {
    const prompt = ELABORATE_SYS(profile, 2, 2);
    expect(prompt).toMatch(/Markdown is supported/i);
    expect(prompt).toMatch(/Prefer clear structure/i);
  });

  test("does not include cliché constraint", () => {
    const prompt = ELABORATE_SYS(profile, 2, 2);
    expect(prompt).not.toContain("Hard constraint");
  });
});

// ─── PARTIAL_REGEN_SYS ────────────────────────────────────────────────────────

describe("PARTIAL_REGEN_SYS", () => {
  const profile = { tone: "casual", sentenceStructure: "short punchy" };

  test("renders profile as prose bullets", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, []);
    expect(prompt).toContain("- Tone: casual");
    expect(prompt).not.toContain('{"tone"');
  });

  test("instructs model to rewrite only the tagged passage", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, []);
    expect(prompt).toContain("<regen_target>");
    expect(prompt).toMatch(/Rewrite ONLY the passage/i);
  });

  test("includes cliché constraint when list is non-empty", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, ["delve", "leverage"]);
    expect(prompt).toContain('"delve"');
    expect(prompt).toContain('"leverage"');
    expect(prompt).toContain("Hard constraint");
  });

  test("output length rule is present", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, []);
    expect(prompt).toMatch(/output length should closely match/i);
  });

  test("forbids options and scaffolding in the output", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, []);
    expect(prompt).toMatch(/multiple options/i);
    expect(prompt).toMatch(/follow-up questions/i);
    expect(prompt).toMatch(/markdown fences/i);
  });
});

// ─── buildPartialRegenUserPrompt ─────────────────────────────────────────────

describe("buildPartialRegenUserPrompt", () => {
  test("wraps full text in full_output tags", () => {
    const prompt = buildPartialRegenUserPrompt("full document", "selected part");
    expect(prompt).toContain("<full_output>\nfull document\n</full_output>");
  });

  test("wraps selected text in regen_target tags", () => {
    const prompt = buildPartialRegenUserPrompt("full document", "selected part");
    expect(prompt).toContain("<regen_target>\nselected part\n</regen_target>");
  });

  test("adds stricter retry instructions when requested", () => {
    const prompt = buildPartialRegenUserPrompt("full document", "selected part", { strict: true });
    expect(prompt).toContain("previous attempt included scaffolding");
  });
});

// ─── cliché prioritization in prompts ────────────────────────────────────────

describe("cliché prioritization in generated prompts", () => {
  test("tier-1 clichés appear before non-tier-1 in humanize prompt", () => {
    // "delve" is tier-1, "in conclusion" is not
    const cliches = ["in conclusion", "delve"];
    const prompt = HUMANIZE_SYS({ tone: "casual" }, 2, cliches);
    const delvePos = prompt.indexOf('"delve"');
    const conclusionPos = prompt.indexOf('"in conclusion"');
    expect(delvePos).toBeGreaterThan(-1);
    expect(conclusionPos).toBeGreaterThan(-1);
    expect(delvePos).toBeLessThan(conclusionPos);
  });
});
