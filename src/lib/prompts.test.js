import { describe, expect, test } from "vitest";
import { TIER1_CLICHES } from "../constants/cliches.js";
import {
  buildMetaBlock,
  renderProfileAsProse,
  selectCliches,
  buildAiTermGuidance,
  ELABORATE_SYS,
  HUMANIZE_SYS,
  PARTIAL_REGEN_SYS,
  buildPartialRegenUserPrompt,
  getElaborateFormatGuidance,
  getElaboratePresetInstruction,
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
    const prose = renderProfileAsProse({ humor: "dry and direct", vocabulary: "plain Anglo-Saxon" });
    expect(prose).toContain("- Humor: dry and direct");
    expect(prose).toContain("- Vocabulary: plain Anglo-Saxon");
  });

  test("converts camelCase keys to readable labels", () => {
    const prose = renderProfileAsProse({ sentenceStructure: "short punchy sentences" });
    expect(prose).toContain("- Sentence structure: short punchy sentences");
  });

  test("skips keys with empty or non-string values", () => {
    const prose = renderProfileAsProse({ vocabulary: "warm", quirks: "", humor: null });
    expect(prose).toContain("- Vocabulary: warm");
    expect(prose).not.toContain("quirks");
    expect(prose).not.toContain("humor");
  });

  test("does not contain JSON braces or quoted keys", () => {
    const prose = renderProfileAsProse({ humor: "casual", vocabulary: "informal" });
    expect(prose).not.toContain("{");
    expect(prose).not.toContain('"tone"');
  });
});

// ─── selectCliches ────────────────────────────────────────────────────────────

describe("selectCliches", () => {
  test("returns different sampled non-tier-1 terms across runs when over budget", () => {
    const generatedTerms = ["delve", ...Array.from({ length: 60 }, (_, i) => `generated-${i}`)];
    const first = selectCliches({ generatedTerms, customTerms: [] }, 40);
    const second = selectCliches({ generatedTerms, customTerms: [] }, 40);

    expect(first).toHaveLength(40);
    expect(second).toHaveLength(40);
    expect(first).toContain("delve");
    expect(second).toContain("delve");
    expect(first.filter((term) => term.startsWith("generated-"))).not.toEqual(
      second.filter((term) => term.startsWith("generated-"))
    );
  });

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
    expect(result).toEqual([tier1Item, nonTier1]);
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
    const result = selectCliches(small, 40);
    expect(result).toHaveLength(2);
    expect(result).toContain("delve");
    expect(result).toContain("certainly");
  });

  test("custom terms appear before non-tier-1 generated terms", () => {
    const result = selectCliches({
      generatedTerms: ["in conclusion", "delve", "moving forward"],
      customTerms: ["agentic slop"],
    }, 10);

    expect(result).toContain("delve");
    expect(result).toContain("agentic slop");
    expect(result.indexOf("delve")).toBeLessThan(result.indexOf("in conclusion"));
    expect(result.indexOf("agentic slop")).toBeLessThan(result.indexOf("in conclusion"));
  });

  test("custom terms survive the budget cutoff", () => {
    const generatedTerms = ["delve", ...Array.from({ length: 45 }, (_, i) => `generated-${i}`)];
    const result = selectCliches({ generatedTerms, customTerms: ["must-keep"] }, 40);
    const firstGeneratedIndex = result.findIndex((term) => term.startsWith("generated-"));

    expect(result).toContain("must-keep");
    expect(firstGeneratedIndex).toBeGreaterThan(-1);
    expect(result.indexOf("must-keep")).toBeLessThan(firstGeneratedIndex);
  });
});

// ─── HUMANIZE_SYS ─────────────────────────────────────────────────────────────

describe("HUMANIZE_SYS", () => {
  const profile = { humor: "dry and direct", vocabulary: "plain Anglo-Saxon" };

  test("renders profile as directive-style voice guidance, not JSON", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).toContain("Core voice anchors:");
    expect(prompt).toContain("- Vocabulary: favor phrasing that reflects plain Anglo-Saxon.");
    expect(prompt).toContain("Supporting voice cues:");
    expect(prompt).toContain("- Humor: let this show up when it fits naturally: dry and direct.");
    expect(prompt).not.toContain('{"tone"');
  });

  test("includes the profileName in context line", () => {
    const prompt = HUMANIZE_SYS(profile, 2, [], "Work");
    expect(prompt).toContain('"Work" profile');
  });

  test("keeps tone selection out of the system prompt", () => {
    const prompt = HUMANIZE_SYS(profile, 0, []); // Very Casual
    expect(prompt).not.toMatch(/Tone target:/i);
  });

  test("renders generated terms as soft guidance", () => {
    const prompt = HUMANIZE_SYS(profile, 2, ["delve", "certainly"]);
    expect(prompt).toContain('"delve"');
    expect(prompt).toContain('"certainly"');
    expect(prompt).toContain("Soft bans:");
    expect(prompt).not.toContain("Hard bans:");
  });

  test("omits cliché constraint when list is empty", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).not.toContain("AI-term avoidance policy:");
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

  test("includes voice hierarchy and anti-flattening rules", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).toMatch(/Voice hierarchy:/i);
    expect(prompt).toMatch(/Do not default to neutral assistant wording/i);
    expect(prompt).toMatch(/Anti-flattening rule:/i);
  });

  test("speech act rules are present", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).toMatch(/speech act/i);
  });

  test("keeps direct-text output instructions", () => {
    const prompt = HUMANIZE_SYS(profile, 2, []);
    expect(prompt).toMatch(/Output ONLY the rewritten text/i);
    expect(prompt).not.toContain('{"output":"..."}');
  });

  test("renders custom terms as hard bans and adds a silent final pass", () => {
    const prompt = HUMANIZE_SYS(profile, 2, {
      generatedTerms: ["delve"],
      customTerms: ["agentic slop"],
    });

    expect(prompt).toContain('Hard bans: Do not use these exact terms');
    expect(prompt).toContain('"agentic slop"');
    expect(prompt).toContain('Soft bans: Avoid these AI-sounding terms');
    expect(prompt).toContain('Silent final pass: Before you answer');
  });

  test("calls out em dash as punctuation guidance", () => {
    const prompt = HUMANIZE_SYS(profile, 2, {
      generatedTerms: ["—", "delve"],
      customTerms: [],
    });

    expect(prompt).toContain('Punctuation bans: Avoid these punctuation fingerprints');
    expect(prompt).toContain('"—"');
  });
});

// ─── ELABORATE_SYS ────────────────────────────────────────────────────────────

describe("ELABORATE_SYS", () => {
  const profile = { vocabulary: "analytical", rhythm: "even measured cadence" };

  test("renders profile as prose bullets", () => {
    const prompt = ELABORATE_SYS(profile, 2);
    expect(prompt).toContain("Core voice anchors:");
    expect(prompt).toContain("- Vocabulary: favor phrasing that reflects analytical.");
    expect(prompt).toContain("- Rhythm: favor phrasing that reflects even measured cadence.");
    expect(prompt).not.toContain('{"tone"');
  });

  test("includes depth instruction in the prompt", () => {
    const promptBrief = ELABORATE_SYS(profile, 1);
    expect(promptBrief).toMatch(/Primary constraint: keep the elaboration brief/i);
    expect(promptBrief).not.toMatch(/Depth target:/i);
    expect(promptBrief).toMatch(/Stop rule: once the thought has been extended enough/i);
    const promptFull = ELABORATE_SYS(profile, 4);
    expect(promptFull).toMatch(/Primary constraint: keep the elaboration deep but bounded/i);
    expect(promptFull).not.toMatch(/Depth target:/i);
    expect(promptFull).toMatch(/deep elaboration|layered specificity|examples/i);
  });

  test("keeps the shortest depth very short without forcing exactly one sentence", () => {
    const prompt = ELABORATE_SYS(profile, 0);
    expect(prompt).toMatch(/Primary constraint: keep the elaboration very short/i);
    expect(prompt).not.toMatch(/Depth target:/i);
    expect(prompt).toMatch(/brief follow-on detail or clarification/i);
    expect(prompt).toMatch(/Do not add setup, recap, transition sentences, conclusions, or extra examples/i);
  });

  test("keeps slider tone selection out of the elaborate system prompt", () => {
    const prompt = ELABORATE_SYS(profile, 2);
    expect(prompt).not.toContain('Tone target: "Formal"');
    expect(prompt).not.toContain('Tone target: "Balanced"');
  });

  test("includes voice hierarchy and anti-flattening rules", () => {
    const prompt = ELABORATE_SYS(profile, 2);
    expect(prompt).toMatch(/Voice hierarchy:/i);
    expect(prompt).toMatch(/Do not default to neutral assistant prose/i);
    expect(prompt).toMatch(/Anti-flattening rule:/i);
    expect(prompt).toMatch(/Silent profile pass:/i);
  });

  test("includes plain-text formatting guidance by default", () => {
    const prompt = ELABORATE_SYS(profile, 2);
    expect(prompt).toMatch(/source is plain text/i);
    expect(prompt).toMatch(/Do not introduce markdown headings, bullets, numbered lists/i);
  });

  test("does not include cliché constraint", () => {
    const prompt = ELABORATE_SYS(profile, 2);
    expect(prompt).not.toContain("AI-term avoidance policy:");
  });

  test("keeps direct-text output instructions", () => {
    const prompt = ELABORATE_SYS(profile, 2);
    expect(prompt).toMatch(/Output ONLY the elaboration/i);
    expect(prompt).not.toContain('{"output":"..."}');
  });

  test("includes dedicated preset guidance when a preset is active", () => {
    const prompt = ELABORATE_SYS(profile, 2, "Personal", null, { formatPreset: "report" });
    expect(prompt).toContain("Preset requirement:");
    expect(prompt).toMatch(/Format as a report/i);
  });

  test("allows markdown preservation when the source already uses markdown", () => {
    const prompt = ELABORATE_SYS(profile, 2, "Personal", null, {
      formatPreset: "none",
      sourceHasMarkdown: true,
    });
    expect(prompt).toMatch(/source already uses markdown/i);
    expect(prompt).toMatch(/Preserve that markdown style/i);
  });

  test("keeps plain-text presets out of markdown-friendly guidance", () => {
    const prompt = ELABORATE_SYS(profile, 2, "Personal", null, { formatPreset: "email" });
    expect(prompt).toMatch(/Keep the output plain text as well/i);
    expect(prompt).not.toMatch(/you may use light preset-appropriate structure/i);
  });
});

describe("elaborate prompt helpers", () => {
  test("returns preset instructions for known presets", () => {
    expect(getElaboratePresetInstruction("blog-post")).toMatch(/blog post/i);
    expect(getElaboratePresetInstruction("none")).toBe("");
  });

  test("allows limited structure for blog-post and report plain-text inputs", () => {
    expect(getElaborateFormatGuidance({ formatPreset: "blog-post", sourceHasMarkdown: false })).toMatch(/light preset-appropriate structure/i);
    expect(getElaborateFormatGuidance({ formatPreset: "report", sourceHasMarkdown: false })).toMatch(/light preset-appropriate structure/i);
  });

  test("suppresses markdown for email and twitter plain-text inputs", () => {
    expect(getElaborateFormatGuidance({ formatPreset: "email", sourceHasMarkdown: false })).toMatch(/plain text as well/i);
    expect(getElaborateFormatGuidance({ formatPreset: "twitter-post", sourceHasMarkdown: false })).toMatch(/plain text as well/i);
  });

  test("preserves markdown guidance when the source contains markdown", () => {
    expect(getElaborateFormatGuidance({ formatPreset: "report", sourceHasMarkdown: true })).toMatch(/source already uses markdown/i);
  });
});

// ─── PARTIAL_REGEN_SYS ────────────────────────────────────────────────────────

describe("PARTIAL_REGEN_SYS", () => {
  const profile = { humor: "casual", sentenceStructure: "short punchy" };

  test("renders profile as prose bullets", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, []);
    expect(prompt).toContain("- Humor: casual");
    expect(prompt).not.toContain('{"tone"');
  });

  test("instructs model to rewrite only the tagged passage", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, []);
    expect(prompt).toContain("<regen_target>");
    expect(prompt).toMatch(/Rewrite ONLY the passage/i);
  });

  test("includes cliché constraint when list is non-empty", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, {
      generatedTerms: ["delve", "leverage"],
      customTerms: ["agentic slop"],
    });
    expect(prompt).toContain('"delve"');
    expect(prompt).toContain('"leverage"');
    expect(prompt).toContain('"agentic slop"');
    expect(prompt).toContain("AI-term avoidance policy:");
    expect(prompt).toContain("Hard bans:");
    expect(prompt).toContain("Soft bans:");
  });

  test("output length rule is present", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, []);
    expect(prompt).toMatch(/output length should closely match/i);
  });

  test("forbids options and scaffolding in the output", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, []);
    expect(prompt).toMatch(/\{"replacement":"\.\.\."\}/i);
    expect(prompt).toMatch(/multiple options/i);
    expect(prompt).toMatch(/follow-up questions/i);
    expect(prompt).toMatch(/Here is the rewritten text:/i);
    expect(prompt).toMatch(/JSON object/i);
  });

  test("includes the same silent final pass guidance as humanize", () => {
    const prompt = PARTIAL_REGEN_SYS(profile, 1, {
      generatedTerms: ["—", "delve"],
      customTerms: ["agentic slop"],
    });

    expect(prompt).toContain('Silent final pass: Before you answer');
    expect(prompt).toContain('Punctuation bans:');
    expect(prompt).toContain('"—"');
  });
});

describe("buildAiTermGuidance", () => {
  test("splits custom hard bans from generated soft bans", () => {
    const guidance = buildAiTermGuidance({
      generatedTerms: ["delve", "robust"],
      customTerms: ["agentic slop"],
    });

    expect(guidance).toContain("AI-term avoidance policy:");
    expect(guidance).toContain('Hard bans: Do not use these exact terms');
    expect(guidance).toContain('"agentic slop"');
    expect(guidance).toContain('Soft bans: Avoid these AI-sounding terms');
    expect(guidance).toContain('"delve"');
    expect(guidance).toContain('"robust"');
  });

  test("treats punctuation-only terms separately", () => {
    const guidance = buildAiTermGuidance({
      generatedTerms: ["—"],
      customTerms: ["..."],
    });

    expect(guidance).toContain('Punctuation bans: Do not use these punctuation patterns');
    expect(guidance).toContain('Punctuation bans: Avoid these punctuation fingerprints');
    expect(guidance).toContain('"—"');
    expect(guidance).toContain('"..."');
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

  test("does not add retry-only instructions", () => {
    const prompt = buildPartialRegenUserPrompt("full document", "selected part");
    expect(prompt).not.toContain("previous attempt included scaffolding");
  });

  test("includes the exact JSON response shape", () => {
    const prompt = buildPartialRegenUserPrompt("full document", "selected part");
    expect(prompt).toContain('{"replacement":"rewritten passage here"}');
  });
});

// ─── cliché prioritization in prompts ────────────────────────────────────────

describe("cliché prioritization in generated prompts", () => {
  test("tier-1 clichés appear before non-tier-1 in humanize prompt", () => {
    // "delve" is tier-1, "in conclusion" is not
    const cliches = ["in conclusion", "delve"];
    const prompt = HUMANIZE_SYS({ humor: "casual" }, 2, cliches);
    const delvePos = prompt.indexOf('"delve"');
    const conclusionPos = prompt.indexOf('"in conclusion"');
    expect(delvePos).toBeGreaterThan(-1);
    expect(conclusionPos).toBeGreaterThan(-1);
    expect(delvePos).toBeLessThan(conclusionPos);
  });

  test("custom clichés are included ahead of non-tier-1 generated terms in prompts", () => {
    const cliches = {
      generatedTerms: ["in conclusion", "moving forward", "delve"],
      customTerms: ["agentic slop"],
    };
    const prompt = HUMANIZE_SYS({ humor: "casual" }, 2, cliches);
    const delvePos = prompt.indexOf('"delve"');
    const customPos = prompt.indexOf('"agentic slop"');
    const conclusionPos = prompt.indexOf('"in conclusion"');

    expect(delvePos).toBeGreaterThan(-1);
    expect(customPos).toBeGreaterThan(-1);
    expect(conclusionPos).toBeGreaterThan(-1);
    expect(customPos).toBeLessThan(conclusionPos);
  });
});
