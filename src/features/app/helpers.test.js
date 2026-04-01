import { describe, it, expect } from "vitest";
import {
  isPlainObject,
  normalizeProfileObject,
  parseJsonFromModelOutput,
  parsePartialRegenPayload,
  parseStructuredTextPayload,
} from "./helpers.js";
import { PROFILE_TRAIT_KEYS } from "../../constants/index.js";

describe("parseJsonFromModelOutput", () => {
  it("parses clean JSON objects", () => {
    const input = '{"key": "value"}';
    expect(parseJsonFromModelOutput(input)).toEqual({ key: "value" });
  });

  it("parses clean JSON arrays", () => {
    const input = '["a", "b"]';
    expect(parseJsonFromModelOutput(input)).toEqual(["a", "b"]);
  });

  it("parses JSON inside markdown blocks", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(parseJsonFromModelOutput(input)).toEqual({ key: "value" });
  });

  it("extracts JSON with preamble text", () => {
    const input = 'Certainly! Here is the profile:\n{"key": "value"}';
    expect(parseJsonFromModelOutput(input)).toEqual({ key: "value" });
  });

  it("extracts JSON with postscript text", () => {
    const input = '{"key": "value"}\nI hope this helps!';
    expect(parseJsonFromModelOutput(input)).toEqual({ key: "value" });
  });

  it("extracts JSON with both preamble and postscript", () => {
    const input = 'Analysis result:\n```json\n{"key": "value"}\n```\nEnd of analysis.';
    expect(parseJsonFromModelOutput(input)).toEqual({ key: "value" });
  });

  it("handles nested objects correctly", () => {
    const input = 'Before {"a": {"b": 1}} After';
    expect(parseJsonFromModelOutput(input)).toEqual({ a: { b: 1 } });
  });

  it("handles strings containing braces correctly", () => {
    const input = 'Data: {"text": "contains { and } braces"} and more';
    expect(parseJsonFromModelOutput(input)).toEqual({ text: "contains { and } braces" });
  });

  it("handles escaped quotes in strings", () => {
    const input = 'Result: {"msg": "quoted \\"text\\""}';
    expect(parseJsonFromModelOutput(input)).toEqual({ msg: 'quoted "text"' });
  });

  it("throws error for empty input", () => {
    expect(() => parseJsonFromModelOutput("")).toThrow("Empty model response.");
  });

  it("throws error when no JSON structure is found", () => {
    expect(() => parseJsonFromModelOutput("just plain text")).toThrow("no starting '{' or '[' found");
  });

  it("handles the specific case from the task error (Unexpected token '#')", () => {
    const input = '# Voice Profile Analysis\n\n```json\n{"tone": "formal"}\n```';
    expect(parseJsonFromModelOutput(input)).toEqual({ tone: "formal" });
  });
});

describe("profile object validation", () => {
  it("identifies plain objects", () => {
    expect(isPlainObject({ tone: "balanced" })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(["tone"])).toBe(false);
    expect(isPlainObject("tone")).toBe(false);
  });

  it("rejects non-object profile payloads", () => {
    expect(() => normalizeProfileObject(null)).toThrow("Model returned invalid profile structure.");
    expect(() => normalizeProfileObject(["tone"])).toThrow("Model returned invalid profile structure.");
    expect(() => normalizeProfileObject("tone")).toThrow("Model returned invalid profile structure.");
  });

  it("rejects empty profile objects", () => {
    expect(() => normalizeProfileObject({})).toThrow("Model returned invalid profile structure.");
    expect(() => normalizeProfileObject({ tone: "", summary: "   " })).toThrow("Model returned invalid profile structure.");
  });

  it("keeps only trimmed string fields", () => {
    const normalized = normalizeProfileObject({
      tone: " balanced ",
      sampleCount: 4,
      nested: { bad: true },
      humor: " dry ",
      summary: "",
    });

    expect(Object.keys(normalized).sort()).toEqual([...PROFILE_TRAIT_KEYS].sort());
    expect(normalized.tone).toBe("balanced");
    expect(normalized.humor).toBe("dry");
    expect(normalized.vocabulary).toBe("");
    expect(normalized.transitionStyle).toBe("");
  });

  it("fills in missing canonical traits with empty strings", () => {
    const normalized = normalizeProfileObject({
      tone: "direct",
      humor: "",
    });

    expect(normalized.tone).toBe("direct");
    expect(normalized.humor).toBe("");
    expect(normalized.rhythm).toBe("");
  });
});

describe("parsePartialRegenPayload", () => {
  it("extracts a replacement string from JSON output", () => {
    expect(parsePartialRegenPayload('{"replacement":"Refined replacement."}')).toEqual({
      replacement: "Refined replacement.",
    });
  });

  it("rejects non-object payloads", () => {
    expect(() => parsePartialRegenPayload('["bad"]')).toThrow("Model returned invalid partial regeneration payload.");
  });

  it("rejects missing replacement text", () => {
    expect(() => parsePartialRegenPayload('{"replacement":"   "}')).toThrow("The model returned no usable replacement text.");
  });
});

describe("parseStructuredTextPayload", () => {
  it("extracts an output string from JSON output", () => {
    expect(parseStructuredTextPayload('{"output":"Clean text."}')).toEqual({
      output: "Clean text.",
    });
  });

  it("rejects non-object payloads", () => {
    expect(() => parseStructuredTextPayload('["bad"]')).toThrow("Model returned invalid generation payload.");
  });

  it("rejects missing output text", () => {
    expect(() => parseStructuredTextPayload('{"output":"   "}')).toThrow("The model returned no usable replacement text.");
  });
});
