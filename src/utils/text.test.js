import {
  computeConcretenessScore,
  computeFillerDensity,
  computeGradeLevelMetrics,
  computeLexicalDiversity,
  computePassiveVoiceRatio,
  computeReadabilityScore,
  computeRepetitionScore,
  computeSentenceComplexity,
  computeTextMetricSnapshot,
  expandSelectionToWordBoundaries,
  mapRawOffsetToVisibleOffset,
  mapVisibleOffsetToRawOffset,
  stitchReplacementIntoText,
} from "./text.js";

describe("text metrics", () => {
  test("computes grade-level metrics", () => {
    const metrics = computeGradeLevelMetrics("This is a simple sentence. This is another simple sentence.");

    expect(metrics.fkgl).toBeTypeOf("number");
    expect(metrics.gunningFog).toBeTypeOf("number");
    expect(metrics.smog).toBe(0);
    expect(metrics.colemanLiau).toBeTypeOf("number");
    expect(metrics.ari).toBeTypeOf("number");
  });

  test("computes lexical diversity ratio", () => {
    expect(computeLexicalDiversity("apple apple banana")).toBeCloseTo(0.667, 3);
  });

  test("computes sentence complexity stats", () => {
    const complexity = computeSentenceComplexity("one two three. one two three four five.");
    expect(complexity.averageSentenceLength).toBe(4);
    expect(complexity.sentenceLengthVariance).toBe(1);
  });

  test("computes passive voice ratio", () => {
    const ratio = computePassiveVoiceRatio("The ball was thrown by Alex. I throw the ball every day.");
    expect(ratio).toBe(0.5);
  });

  test("computes filler density per 100 words", () => {
    const density = computeFillerDensity("I just really maybe need a short draft.");
    expect(density).toBeGreaterThan(30);
  });

  test("computes repetition score from repeated trigrams", () => {
    const score = computeRepetitionScore("we need more tests we need more tests today");
    expect(score).toBeGreaterThan(10);
  });

  test("computes concreteness score using proxy lexicon", () => {
    const concrete = computeConcretenessScore("I set the book on the table beside the laptop.");
    const abstract = computeConcretenessScore("Our strategy and vision improve alignment and innovation.");
    expect(concrete).toBeGreaterThan(abstract);
  });

  test("builds full metric snapshot", () => {
    const text = "This is a practical sentence about a book on a table.";
    const snapshot = computeTextMetricSnapshot(text);

    expect(snapshot.readability).toBe(computeReadabilityScore(text));
    expect(snapshot).toHaveProperty("fkgl");
    expect(snapshot).toHaveProperty("lexicalDiversity");
    expect(snapshot).toHaveProperty("passiveVoiceRatio");
    expect(snapshot).toHaveProperty("repetitionScore");
    expect(snapshot).toHaveProperty("concretenessScore");
  });

  test("expands a partial selection to include the full word on both ends", () => {
    const expanded = expandSelectionToWordBoundaries("alpha bravo charlie", 2, 9);
    expect(expanded).toEqual({ start: 0, end: 11, text: "alpha bravo" });
  });

  test("leaves selections already on word boundaries unchanged", () => {
    const expanded = expandSelectionToWordBoundaries("alpha bravo", 0, 5);
    expect(expanded).toEqual({ start: 0, end: 5, text: "alpha" });
  });

  test("does not absorb punctuation or whitespace when expanding", () => {
    const expanded = expandSelectionToWordBoundaries("alpha, bravo", 8, 10);
    expect(expanded).toEqual({ start: 7, end: 12, text: "bravo" });
  });

  test("expands the trailing edge to the end of a partially selected word", () => {
    const expanded = expandSelectionToWordBoundaries("alpha bravo", 6, 8);
    expect(expanded).toEqual({ start: 6, end: 11, text: "bravo" });
  });

  test("maps visible offsets to raw markdown offsets", () => {
    const raw = "**alpha** bravo";
    expect(mapVisibleOffsetToRawOffset(raw, 5)).toBe(7);
    expect(mapVisibleOffsetToRawOffset(raw, 11)).toBe(raw.length);
  });

  test("maps raw markdown offsets back to visible offsets", () => {
    const raw = "**alpha** bravo";
    expect(mapRawOffsetToVisibleOffset(raw, 9)).toBe(5);
    expect(mapRawOffsetToVisibleOffset(raw, raw.length)).toBe(11);
  });

  test("stitches replacements without gluing adjacent words together", () => {
    expect(stitchReplacementIntoText("alpha", "bravo", "charlie")).toBe("alpha bravo charlie");
  });

  test("does not add extra spaces before punctuation", () => {
    expect(stitchReplacementIntoText("alpha ", "bravo", ", charlie")).toBe("alpha bravo, charlie");
  });

  test("preserves existing surrounding spacing when it is already correct", () => {
    expect(stitchReplacementIntoText("alpha ", "bravo", " charlie")).toBe("alpha bravo charlie");
  });
});
