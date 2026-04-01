import { describe, expect, test } from "vitest";
import {
  buildElaborateUserPrompt,
  buildHumanizeUserPrompt,
  sanitizeGeneratedOutput,
  sanitizePartialRegenOutput,
} from "./promptGuards.js";

describe("prompt builders", () => {
  test("humanize prompt does not mention a missing target voice block", () => {
    const prompt = buildHumanizeUserPrompt("Hey how are you doing today", { tone: 4 });
    expect(prompt).toMatch(/style instructions already provided/i);
    expect(prompt).not.toMatch(/target voice/i);
    expect(prompt).toMatch(/Tone target: "Formal"/i);
    expect(prompt).not.toMatch(/Extra instruction:/i);
  });

  test("elaborate prompt does not mention a missing target voice block", () => {
    const prompt = buildElaborateUserPrompt("Draft thought.", { sourceHasMarkdown: false, tone: 0 });
    expect(prompt).toMatch(/style instructions already provided/i);
    expect(prompt).not.toMatch(/target voice/i);
    expect(prompt).toMatch(/Tone target: "Very Casual"/i);
    expect(prompt).not.toMatch(/Extra instruction:/i);
  });

  test("elaborate prompt includes the selected depth target", () => {
    const prompt = buildElaborateUserPrompt("Draft thought.", { sourceHasMarkdown: false, depth: 4 });
    expect(prompt).toMatch(/Depth target: 7[-–]10 sentences\./i);
  });

  test("adds a one-off instruction only when present", () => {
    const humanizePrompt = buildHumanizeUserPrompt("Draft", {
      tone: 2,
      oneOffInstruction: "make this sound more confident",
    });
    const elaboratePrompt = buildElaborateUserPrompt("Draft", {
      sourceHasMarkdown: false,
      depth: 2,
      tone: 2,
      oneOffInstruction: "add a concrete example at the end",
    });

    expect(humanizePrompt).toMatch(/Extra instruction: make this sound more confident/i);
    expect(elaboratePrompt).toMatch(/Extra instruction: add a concrete example at the end/i);
  });
});

describe("sanitizePartialRegenOutput", () => {
  test("keeps a clean replacement unchanged", () => {
    expect(sanitizePartialRegenOutput("A.I. feature uses his identity without permission.")).toBe(
      "A.I. feature uses his identity without permission."
    );
  });

  test("keeps multi-option scaffolding unchanged", () => {
    expect(
      sanitizePartialRegenOutput(`Here are a few rewrite options:

Option 1: First draft.
Option 2: Second draft.`)
    ).toBe(`Here are a few rewrite options:

Option 1: First draft.
Option 2: Second draft.`);
  });

  test("strips a simple explanatory preamble", () => {
    expect(
      sanitizePartialRegenOutput(`Rewritten passage:
A.I. feature uses his identity without permission.`)
    ).toBe("A.I. feature uses his identity without permission.");
  });

  test("keeps a follow-up question unchanged", () => {
    expect(
      sanitizePartialRegenOutput(`A.I. feature uses his identity without permission.

Which tone do you want to go for?`)
    ).toBe(`A.I. feature uses his identity without permission.

Which tone do you want to go for?`);
  });

  test("unwraps fenced and quoted single replacements", () => {
    expect(
      sanitizePartialRegenOutput("```text\n\"A.I. feature uses his identity without permission.\"\n```")
    ).toBe("A.I. feature uses his identity without permission.");
  });
});

describe("sanitizeGeneratedOutput", () => {
  test("strips common wrapper text and reports metadata", () => {
    expect(
      sanitizeGeneratedOutput("Here is the rewritten text:\nA.I. feature uses his identity without permission.")
    ).toEqual({
      text: "A.I. feature uses his identity without permission.",
      hadWrapper: true,
      removedPrefix: "Here is the rewritten text:",
      hadReasoning: false,
    });
  });

  test("unwraps known prompt wrapper tags", () => {
    expect(
      sanitizeGeneratedOutput(`<target_voice>
March 18. Late.
</target_voice>`)
    ).toEqual({
      text: "March 18. Late.",
      hadWrapper: true,
      removedPrefix: "<target_voice>",
      hadReasoning: false,
    });
  });

  test("strips a leading known prompt wrapper tag without removing body text", () => {
    expect(
      sanitizeGeneratedOutput(`<source_text>
Here is the problem with shipping fast.`)
    ).toEqual({
      text: "Here is the problem with shipping fast.",
      hadWrapper: true,
      removedPrefix: "<source_text>",
      hadReasoning: false,
    });
  });

  test("preserves legitimate non-wrapper prose", () => {
    expect(sanitizeGeneratedOutput("Here is the problem with shipping fast.").text).toBe(
      "Here is the problem with shipping fast."
    );
  });

  test("strips a full thinking block and reports reasoning cleanup", () => {
    expect(
      sanitizeGeneratedOutput(`<thinking>
Need to inspect the prompt first.
</thinking>`)
    ).toEqual({
      text: "",
      hadWrapper: false,
      removedPrefix: "",
      hadReasoning: true,
    });
  });

  test("strips a leading thinking block before valid output", () => {
    expect(
      sanitizeGeneratedOutput(`<thinking>
Need to inspect the prompt first.
</thinking>

March 18. Late.`)
    ).toEqual({
      text: "March 18. Late.",
      hadWrapper: false,
      removedPrefix: "",
      hadReasoning: true,
    });
  });

  test("preserves normal prose that mentions thinking", () => {
    expect(
      sanitizeGeneratedOutput("I keep thinking about how quickly shipping habits become culture.").text
    ).toBe("I keep thinking about how quickly shipping habits become culture.");
  });
});
