export function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

const MARKDOWN_IGNORED_CHARS = new Set(["*", "_", "`", "~", "#", ">", "[", "]", "(", ")"]);

function isMarkdownIgnoredChar(char) {
  return MARKDOWN_IGNORED_CHARS.has(char);
}

function isWordChar(char) {
  return /[A-Za-z0-9]/.test(char || "");
}

export function expandSelectionToWordBoundaries(text, start, end) {
  const source = String(text || "");
  const clampedStart = Math.max(0, Math.min(Number(start) || 0, source.length));
  const clampedEnd = Math.max(clampedStart, Math.min(Number(end) || 0, source.length));

  let nextStart = clampedStart;
  let nextEnd = clampedEnd;
  const trailingEdgeIsInsideWord =
    nextEnd > 0
    && nextEnd < source.length
    && isWordChar(source[nextEnd - 1])
    && isWordChar(source[nextEnd]);

  while (nextStart > 0 && isWordChar(source[nextStart - 1])) {
    nextStart -= 1;
  }
  while (trailingEdgeIsInsideWord && nextEnd < source.length && isWordChar(source[nextEnd])) {
    nextEnd += 1;
  }

  return { start: nextStart, end: nextEnd, text: source.slice(nextStart, nextEnd) };
}

function shouldInsertBoundarySpace(leftChar, rightChar) {
  return isWordChar(leftChar) && isWordChar(rightChar);
}

export function stitchReplacementIntoText(beforeText, replacementText, afterText) {
  const before = String(beforeText || "");
  const replacement = String(replacementText || "").trim();
  const after = String(afterText || "");

  let nextReplacement = replacement;

  if (nextReplacement) {
    const leftChar = before.slice(-1);
    const rightChar = nextReplacement[0];
    if (shouldInsertBoundarySpace(leftChar, rightChar)) {
      nextReplacement = ` ${nextReplacement}`;
    }
  }

  if (nextReplacement) {
    const leftChar = nextReplacement.slice(-1);
    const rightChar = after[0];
    if (shouldInsertBoundarySpace(leftChar, rightChar)) {
      nextReplacement = `${nextReplacement} `;
    }
  }

  return `${before}${nextReplacement}${after}`;
}

export function mapVisibleOffsetToRawOffset(rawText, visibleOffset) {
  const source = String(rawText || "");
  const target = Math.max(0, Number(visibleOffset) || 0);
  if (target === 0) return 0;

  let visibleCount = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (!isMarkdownIgnoredChar(source[index])) {
      visibleCount += 1;
      if (visibleCount >= target) return index + 1;
    }
  }

  return source.length;
}

export function mapRawOffsetToVisibleOffset(rawText, rawOffset) {
  const source = String(rawText || "");
  const target = Math.max(0, Math.min(Number(rawOffset) || 0, source.length));

  let visibleCount = 0;
  for (let index = 0; index < target; index += 1) {
    if (!isMarkdownIgnoredChar(source[index])) visibleCount += 1;
  }

  return visibleCount;
}

export function estimateTokenCount(text) {
  const normalized = String(text || "");
  if (!normalized.trim()) return 0;

  const segments = normalized.match(/[A-Za-z]+(?:'[A-Za-z]+)?|\d+|[^\s]/g) || [];
  return segments.reduce((total, segment) => {
    if (/^[A-Za-z]/.test(segment)) return total + Math.max(1, Math.ceil(segment.length / 4));
    if (/^\d+$/.test(segment)) return total + Math.max(1, Math.ceil(segment.length / 3));
    return total + 1;
  }, 0);
}

function countChars(text) {
  return text.length;
}

function roundMetric(value, precision = 1) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function extractWordTokens(text) {
  return String(text || "").toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

function estimateWordSyllables(word) {
  const cleaned = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 1;
  if (cleaned.length <= 3) return 1;

  const withoutSilentE = cleaned.replace(/e$/, "");
  const groups = withoutSilentE.match(/[aeiouy]{1,2}/g);
  return Math.max(groups ? groups.length : 1, 1);
}

export function computeWordCharDelta(beforeText, afterText) {
  const beforeWords = countWords(beforeText);
  const afterWords = countWords(afterText);
  const beforeChars = countChars(beforeText);
  const afterChars = countChars(afterText);
  return {
    beforeWords,
    afterWords,
    wordDelta: afterWords - beforeWords,
    beforeChars,
    afterChars,
    charDelta: afterChars - beforeChars,
  };
}

export function splitSentences(text) {
  return text
    .match(/[^.!?]+[.!?]*/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

export function computeReadabilityScore(text) {
  const tokens = extractWordTokens(text);
  const words = tokens.length;
  const sentences = Math.max(splitSentences(text).length, 1);
  const syllableCount = tokens.reduce((total, token) => total + estimateWordSyllables(token), 0) || 1;
  const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllableCount / Math.max(words, 1)));
  return roundMetric(score, 1);
}

export function computeGradeLevelMetrics(text) {
  const tokens = extractWordTokens(text);
  const words = Math.max(tokens.length, 1);
  const sentences = Math.max(splitSentences(text).length, 1);
  const letters = tokens.reduce((sum, token) => sum + token.replace(/[^a-z]/g, "").length, 0);
  const syllables = tokens.reduce((sum, token) => sum + estimateWordSyllables(token), 0);
  const polysyllables = tokens.filter((token) => estimateWordSyllables(token) >= 3).length;
  const complexWords = polysyllables;
  const wordsPerSentence = words / sentences;

  const fkgl = 0.39 * wordsPerSentence + 11.8 * (syllables / words) - 15.59;
  const gunningFog = 0.4 * (wordsPerSentence + 100 * (complexWords / words));
  const smog = sentences >= 3 ? (1.043 * Math.sqrt(polysyllables * (30 / sentences))) + 3.1291 : 0;
  const L = (letters / words) * 100;
  const S = (sentences / words) * 100;
  const colemanLiau = 0.0588 * L - 0.296 * S - 15.8;
  const ari = 4.71 * (letters / words) + 0.5 * wordsPerSentence - 21.43;

  return {
    fkgl: roundMetric(fkgl),
    gunningFog: roundMetric(gunningFog),
    smog: roundMetric(smog),
    colemanLiau: roundMetric(colemanLiau),
    ari: roundMetric(ari),
  };
}

export function computeLexicalDiversity(text) {
  const tokens = extractWordTokens(text);
  if (!tokens.length) return 0;
  return roundMetric((new Set(tokens)).size / tokens.length, 3);
}

export function computeSentenceComplexity(text) {
  const sentenceList = splitSentences(text);
  if (!sentenceList.length) {
    return { averageSentenceLength: 0, sentenceLengthVariance: 0 };
  }

  const lengths = sentenceList.map((sentence) => extractWordTokens(sentence).length).filter((length) => length > 0);
  if (!lengths.length) {
    return { averageSentenceLength: 0, sentenceLengthVariance: 0 };
  }

  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + ((value - average) ** 2), 0) / lengths.length;

  return {
    averageSentenceLength: roundMetric(average),
    sentenceLengthVariance: roundMetric(variance),
  };
}

const PASSIVE_PARTICIPLES = [
  "known",
  "given",
  "made",
  "taken",
  "done",
  "seen",
  "built",
  "written",
  "thrown",
  "driven",
  "grown",
  "shown",
  "found",
  "kept",
  "told",
  "left",
  "felt",
];

function sentenceLooksPassive(sentence) {
  const normalized = String(sentence || "").toLowerCase();
  if (!normalized) return false;

  if (/\b(am|is|are|was|were|be|been|being)\s+\w+(ed|en)\b/.test(normalized)) return true;
  return PASSIVE_PARTICIPLES.some((participle) => new RegExp(`\\b(am|is|are|was|were|be|been|being)\\s+${participle}\\b`).test(normalized));
}

export function computePassiveVoiceRatio(text) {
  const sentenceList = splitSentences(text);
  if (!sentenceList.length) return 0;
  const passiveCount = sentenceList.filter((sentence) => sentenceLooksPassive(sentence)).length;
  return roundMetric(passiveCount / sentenceList.length, 3);
}

const FILLER_PATTERNS = [
  /\bjust\b/g,
  /\breally\b/g,
  /\bvery\b/g,
  /\bmaybe\b/g,
  /\bperhaps\b/g,
  /\bkind of\b/g,
  /\bsort of\b/g,
  /\bbasically\b/g,
  /\bactually\b/g,
  /\bliterally\b/g,
  /\bprobably\b/g,
  /\bquite\b/g,
  /\bsomewhat\b/g,
];

export function computeFillerDensity(text) {
  const normalized = String(text || "").toLowerCase();
  const words = Math.max(extractWordTokens(normalized).length, 1);
  const fillerCount = FILLER_PATTERNS.reduce((sum, pattern) => sum + (normalized.match(pattern)?.length || 0), 0);
  return roundMetric((fillerCount / words) * 100, 2);
}

export function computeRepetitionScore(text) {
  const tokens = extractWordTokens(text);
  if (tokens.length < 3) return 0;

  const counts = new Map();
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    const trigram = `${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`;
    counts.set(trigram, (counts.get(trigram) || 0) + 1);
  }

  const totalTrigrams = Math.max(tokens.length - 2, 1);
  const repeatedOccurrences = [...counts.values()].reduce(
    (sum, count) => (count > 1 ? sum + (count - 1) : sum),
    0
  );

  return roundMetric((repeatedOccurrences / totalTrigrams) * 100, 2);
}

const CONCRETE_WORDS = new Set([
  "book", "table", "chair", "street", "phone", "laptop", "coffee", "dog", "cat", "tree", "house", "door",
  "window", "kitchen", "car", "train", "rain", "desk", "meeting", "email", "camera", "paper", "pen", "water",
]);

const ABSTRACT_WORDS = new Set([
  "freedom", "justice", "quality", "strategy", "value", "vision", "concept", "idea", "insight", "impact",
  "growth", "culture", "mindset", "leadership", "innovation", "efficiency", "clarity", "purpose", "trust",
  "resilience", "alignment", "synergy", "progress", "improvement",
]);

export function computeConcretenessScore(text) {
  const tokens = extractWordTokens(text);
  if (!tokens.length) return 50;

  let concreteHits = 0;
  let abstractHits = 0;
  for (const token of tokens) {
    if (CONCRETE_WORDS.has(token)) concreteHits += 1;
    if (ABSTRACT_WORDS.has(token)) abstractHits += 1;
  }

  const totalMatched = concreteHits + abstractHits;
  if (!totalMatched) return 50;
  return roundMetric((concreteHits / totalMatched) * 100, 1);
}

export function computeTextMetricSnapshot(text) {
  const readability = computeReadabilityScore(text);
  const grades = computeGradeLevelMetrics(text);
  const lexicalDiversity = computeLexicalDiversity(text);
  const complexity = computeSentenceComplexity(text);
  const passiveVoiceRatio = computePassiveVoiceRatio(text);
  const fillerDensity = computeFillerDensity(text);
  const repetitionScore = computeRepetitionScore(text);
  const concretenessScore = computeConcretenessScore(text);

  return {
    readability,
    fkgl: grades.fkgl,
    gunningFog: grades.gunningFog,
    smog: grades.smog,
    colemanLiau: grades.colemanLiau,
    ari: grades.ari,
    lexicalDiversity,
    averageSentenceLength: complexity.averageSentenceLength,
    sentenceLengthVariance: complexity.sentenceLengthVariance,
    passiveVoiceRatio,
    fillerDensity,
    repetitionScore,
    concretenessScore,
  };
}
