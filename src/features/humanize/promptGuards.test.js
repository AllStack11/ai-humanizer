import { describe, expect, test } from "vitest";
import {
  outputLooksLikeMetaPartialRegen,
  sanitizePartialRegenOutput,
} from "./promptGuards.js";

describe("sanitizePartialRegenOutput", () => {
  test("keeps a clean replacement unchanged", () => {
    expect(sanitizePartialRegenOutput("A.I. feature uses his identity without permission.")).toBe(
      "A.I. feature uses his identity without permission."
    );
  });

  test("rejects multiple rewrite options", () => {
    expect(
      sanitizePartialRegenOutput(`Here are a few rewrite options:

Option 1: First draft.
Option 2: Second draft.`)
    ).toBe("");
  });

  test("strips a simple explanatory preamble before a single replacement", () => {
    expect(
      sanitizePartialRegenOutput(`Rewritten passage:
A.I. feature uses his identity without permission.`)
    ).toBe("A.I. feature uses his identity without permission.");
  });

  test("trims an unambiguous follow-up question after the replacement", () => {
    expect(
      sanitizePartialRegenOutput(`A.I. feature uses his identity without permission.

Which tone do you want to go for?`)
    ).toBe("A.I. feature uses his identity without permission.");
  });

  test("unwraps fenced and quoted single replacements", () => {
    expect(
      sanitizePartialRegenOutput("```text\n\"A.I. feature uses his identity without permission.\"\n```")
    ).toBe("A.I. feature uses his identity without permission.");
  });
});

describe("outputLooksLikeMetaPartialRegen", () => {
  test("flags rewrite scaffolding", () => {
    expect(
      outputLooksLikeMetaPartialRegen(`Here are a few rewrite options:

Option 1: First draft.`)
    ).toBe(true);
  });

  test("does not flag a clean replacement", () => {
    expect(outputLooksLikeMetaPartialRegen("A.I. feature uses his identity without permission.")).toBe(false);
  });
});
