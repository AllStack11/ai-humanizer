import { splitSentences } from "./text.js";

function toTokens(text) {
  return text ? text.split(/(\s+)/).filter(Boolean) : [];
}

function toComparableWords(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
}

function buildWordOverlapScore(leftText, rightText) {
  const leftWords = toComparableWords(leftText);
  const rightWords = toComparableWords(rightText);
  if (!leftWords.length || !rightWords.length) return 0;

  const leftCounts = new Map();
  for (const word of leftWords) {
    leftCounts.set(word, (leftCounts.get(word) || 0) + 1);
  }

  let overlap = 0;
  for (const word of rightWords) {
    const remaining = leftCounts.get(word) || 0;
    if (remaining <= 0) continue;
    overlap += 1;
    leftCounts.set(word, remaining - 1);
  }

  return overlap / Math.max(Math.min(leftWords.length, rightWords.length), 1);
}

function pushChunk(chunks, source, start, end) {
  const raw = source.slice(start, end);
  const leadingWhitespace = raw.match(/^\s*/)?.[0].length || 0;
  const trailingWhitespace = raw.match(/\s*$/)?.[0].length || 0;
  const trimmedStart = start + leadingWhitespace;
  const trimmedEnd = Math.max(trimmedStart, end - trailingWhitespace);
  if (trimmedEnd <= trimmedStart) return;
  chunks.push({
    start: trimmedStart,
    end: trimmedEnd,
    text: source.slice(trimmedStart, trimmedEnd),
  });
}

function splitIntoChunkRanges(text, { includePhraseBreaks = false } = {}) {
  const source = String(text || "");
  if (!source.trim()) return [];

  const chunks = [];
  let chunkStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const sentenceBreak = char === "." || char === "!" || char === "?" || char === "\n";
    const phraseBreak = includePhraseBreaks && (char === "," || char === ";" || char === ":" || char === "\u2014" || char === "\u2013");
    if (!sentenceBreak && !phraseBreak) continue;

    pushChunk(chunks, source, chunkStart, index + 1);
    chunkStart = index + 1;
  }

  if (chunkStart < source.length) {
    pushChunk(chunks, source, chunkStart, source.length);
  }

  return chunks.length ? chunks : [{ start: 0, end: source.length, text: source }];
}

function buildAlignedAfterRanges(beforeText, afterText) {
  const sentenceCount = splitSentences(afterText).length;
  const afterChunks = splitIntoChunkRanges(afterText, { includePhraseBreaks: sentenceCount <= 1 });
  const beforeChunks = splitIntoChunkRanges(beforeText, { includePhraseBreaks: splitSentences(beforeText).length <= 1 });
  const ranges = [];

  for (const afterChunk of afterChunks) {
    let bestBeforeChunk = null;
    let bestScore = 0;

    for (const beforeChunk of beforeChunks) {
      const score = buildWordOverlapScore(beforeChunk.text, afterChunk.text);
      if (score <= bestScore) continue;
      bestScore = score;
      bestBeforeChunk = beforeChunk;
    }

    if (!bestBeforeChunk || bestScore < 0.24) {
      if (afterChunk.text.trim()) {
        ranges.push({ start: afterChunk.start, end: afterChunk.end, class: "mark-diff-added" });
      }
      continue;
    }

    const segments = buildDiffSegments(bestBeforeChunk.text, afterChunk.text);
    let afterOffset = afterChunk.start;
    for (const segment of segments) {
      const text = segment.text || "";
      const length = text.length;
      if (segment.type === "same" || segment.type === "removed") {
        if (segment.type === "same") afterOffset += length;
        continue;
      }
      if (text.trim() && length > 0) {
        ranges.push({ start: afterOffset, end: afterOffset + length, class: "mark-diff-added" });
      }
      afterOffset += length;
    }
  }

  return mergeAdjacentRanges(ranges);
}

function mergeAdjacentRanges(ranges) {
  if (!ranges.length) return [];
  const merged = [ranges[0]];

  for (let i = 1; i < ranges.length; i++) {
    const current = ranges[i];
    const previous = merged[merged.length - 1];
    if (previous.end >= current.start) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

export function buildDiffSegments(beforeText, afterText) {
  const a = toTokens(beforeText);
  const b = toTokens(afterText);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segments = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      segments.push({ type: "same", text: a[i] });
      i++;
      j++;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      segments.push({ type: "removed", text: a[i] });
      i++;
    } else {
      segments.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < a.length) segments.push({ type: "removed", text: a[i++] });
  while (j < b.length) segments.push({ type: "added", text: b[j++] });
  return segments;
}

export function buildDiffHighlightRanges(beforeText, afterText) {
  const segments = buildDiffSegments(beforeText, afterText);
  const before = [];
  let beforeOffset = 0;

  for (const segment of segments) {
    const text = segment.text || "";
    const length = text.length;
    const isWhitespaceOnly = !text.trim();

    if (segment.type === "same") {
      beforeOffset += length;
      continue;
    }

    if (segment.type === "removed") {
      if (!isWhitespaceOnly && length > 0) {
        before.push({ start: beforeOffset, end: beforeOffset + length, class: "mark-diff-removed" });
      }
      beforeOffset += length;
      continue;
    }
  }

  return {
    before: mergeAdjacentRanges(before),
    after: buildAlignedAfterRanges(beforeText, afterText),
  };
}

export function buildClicheRanges(text, cliches) {
  if (!text || !Array.isArray(cliches) || !cliches.length) return [];
  const ranges = [];
  const lowerText = text.toLowerCase();
  for (const raw of cliches) {
    const phrase = String(raw || "").trim().toLowerCase();
    if (!phrase) continue;
    let from = 0;
    while (from < lowerText.length) {
      const idx = lowerText.indexOf(phrase, from);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + phrase.length, type: "cliche" });
      from = idx + phrase.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const deduped = [];
  for (const range of ranges) {
    if (!deduped.length || deduped[deduped.length - 1].end <= range.start) {
      deduped.push(range);
    }
  }
  return deduped;
}

export function buildMirrorSegments(text, clicheRanges = []) {
  if (!text) return [{ text, kind: "plain" }];
  const ranges = [];

  for (const range of clicheRanges) {
    ranges.push({ start: range.start, end: range.end, kind: "cliche" });
  }

  ranges.sort((a, b) => a.start - b.start);
  const segments = [];
  let pos = 0;
  for (const range of ranges) {
    if (range.start < pos) continue;
    if (range.start > pos) segments.push({ text: text.slice(pos, range.start), kind: "plain" });
    segments.push({ text: text.slice(range.start, range.end), kind: range.kind });
    pos = range.end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), kind: "plain" });
  return segments.length ? segments : [{ text, kind: "plain" }];
}
