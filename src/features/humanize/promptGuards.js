import { countWords } from "../../utils/index.js";

const CONVERSATIONAL_OPENERS = [
  "hi",
  "hey",
  "hello",
  "yo",
  "good morning",
  "good afternoon",
  "good evening",
  "how are you",
  "how's it going",
  "hows it going",
  "what's up",
  "whats up",
  "can you",
  "could you",
  "would you",
  "will you",
  "do you",
  "did you",
  "are you",
  "have you",
  "where are",
  "when are",
  "why are",
  "what are",
];

const PARTIAL_REGEN_OPTION_LIST_PATTERN = /(^|\n)\s*(?:[-*]\s*)?(?:option|version)\s*\d+\b/i;
const PARTIAL_REGEN_META_LEADIN_PATTERN = /^(?:here(?:'s| is| are)\b.*(?:rewrite|rewritten|option|version)|below (?:is|are)\b.*(?:rewrite|rewritten|option|version)|i(?:'ve| have)? rewritten\b|rewrite options?\b|rewritten (?:text|passage)\b|replacement text\b|updated (?:text|passage|version)\b|edited (?:text|passage|version)\b)/i;
const PARTIAL_REGEN_INLINE_LABEL_PATTERN = /^\s*(?:rewritten (?:text|passage)|replacement(?: text)?|updated (?:text|passage|version)|edited (?:text|passage|version)|rewrite)\s*:\s*/i;
const PARTIAL_REGEN_TASK_REFERENCE_PATTERN = /\b(?:regen_target|selected passage|target passage|surrounding text|replacement text|rewrite options?)\b/i;
const PARTIAL_REGEN_FOLLOW_UP_PATTERN = /(?:^|\n)\s*(?:which (?:tone|option|version)\b|let me know which\b|which one\b|which feels\b)/i;
const PARTIAL_REGEN_EXPLANATION_PATTERN = /(?:^|\n)\s*(?:i chose|i kept|i preserved|this version|this rewrite|i made this|note:|explanation:)\b/i;

function normalizeHumanizeText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function unwrapWholeCodeFence(text) {
  const match = String(text || "").trim().match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : String(text || "").trim();
}

function unwrapSurroundingQuotes(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const quotePairs = new Set(['""', "''", "“”", "‘’"]);
  if (!quotePairs.has(`${first}${last}`)) return trimmed;
  return trimmed.slice(1, -1).trim();
}

function stripLeadingMeta(text) {
  let working = String(text || "").trimStart();
  if (!working) return "";

  while (true) {
    const before = working;
    working = working.replace(PARTIAL_REGEN_INLINE_LABEL_PATTERN, "");

    const paragraphMatch = working.match(/^([^\n]+)\n\s*\n([\s\S]+)$/);
    if (paragraphMatch && PARTIAL_REGEN_META_LEADIN_PATTERN.test(paragraphMatch[1].trim())) {
      working = paragraphMatch[2].trimStart();
    }

    const lineMatch = working.match(/^([^\n]+)\n([\s\S]+)$/);
    if (lineMatch && PARTIAL_REGEN_META_LEADIN_PATTERN.test(lineMatch[1].trim())) {
      working = lineMatch[2].trimStart();
    }

    const inlineMatch = working.match(/^([^\n]{0,120}):\s+([\s\S]+)$/);
    if (
      inlineMatch
      && PARTIAL_REGEN_META_LEADIN_PATTERN.test(inlineMatch[1].trim())
      && !PARTIAL_REGEN_OPTION_LIST_PATTERN.test(inlineMatch[2])
    ) {
      working = inlineMatch[2].trimStart();
    }

    if (working === before) break;
  }

  return working.trim();
}

function stripTrailingFollowUp(text) {
  let working = String(text || "").trim();
  if (!working) return "";

  const followUpSplit = working.match(/^([\s\S]*?)\n\s*\n((?:which (?:tone|option|version)\b|let me know which\b|which one\b|which feels\b)[\s\S]*)$/i);
  if (followUpSplit) {
    working = followUpSplit[1].trim();
  }

  return working.trim();
}

function hasPartialRegenMetaSignals(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;

  return (
    PARTIAL_REGEN_OPTION_LIST_PATTERN.test(normalized) ||
    PARTIAL_REGEN_META_LEADIN_PATTERN.test(normalized) ||
    PARTIAL_REGEN_TASK_REFERENCE_PATTERN.test(normalized) ||
    PARTIAL_REGEN_FOLLOW_UP_PATTERN.test(normalized) ||
    PARTIAL_REGEN_EXPLANATION_PATTERN.test(normalized) ||
    /^\s*#{1,6}\s+/.test(normalized) ||
    /```/.test(normalized)
  );
}

export function analyzeHumanizeInput(text) {
  const normalized = normalizeHumanizeText(text);
  const lower = normalized.toLowerCase();
  const wordCount = countWords(normalized);
  const greetingLike = /^(hi|hey|hello|yo|good morning|good afternoon|good evening)\b/i.test(normalized);
  const questionLike = /\?\s*$/.test(normalized)
    || CONVERSATIONAL_OPENERS.some((prefix) => lower.startsWith(prefix))
    || /\bhow are you\b/i.test(normalized);
  const shortChatLike = wordCount > 0 && wordCount <= 14;
  const conversational = shortChatLike && (greetingLike || questionLike || /\byou\b/i.test(normalized));

  return {
    normalized,
    wordCount,
    greetingLike,
    questionLike,
    shortChatLike,
    conversational,
  };
}

export function buildHumanizeUserPrompt(text, { strict = false } = {}) {
  const analysis = analyzeHumanizeInput(text);
  const guardrails = [
    "Rewrite the source text below in the target voice.",
    "Transform the source text itself. Do not answer it, continue it, or switch to the other speaker.",
  ];

  if (analysis.questionLike) {
    guardrails.push("Keep the result as a question or check-in rather than turning it into an answer.");
  }
  if (analysis.greetingLike) {
    guardrails.push("Keep the greeting intent. Do not reply to the greeting.");
  }
  if (analysis.shortChatLike) {
    guardrails.push("Stay close to the original scope and length unless a tiny expansion is needed for natural phrasing.");
  }
  if (strict) {
    guardrails.push("Your previous attempt drifted into a response. Rewrite the source itself this time.");
  }

  return `${guardrails.join("\n")}\n\n<source_text>\n${String(text || "").trim()}\n</source_text>`;
}

export function outputLooksLikeAnsweredPrompt(sourceText, outputText) {
  const source = analyzeHumanizeInput(sourceText);
  if (!source.conversational) return false;

  const output = normalizeHumanizeText(outputText);
  if (!output) return false;

  const outputWordCount = countWords(output);
  let suspicion = 0;

  if (source.questionLike && !/\?\s*$/.test(output)) suspicion += 1;
  if (outputWordCount >= Math.max(source.wordCount * 3, source.wordCount + 12)) suspicion += 1;
  if (/\b(i am|i'm|im|i’ve|i've|i feel|i was|i've been|i have been)\b/i.test(output)) suspicion += 1;
  if (/\bdoing (pretty )?(good|well|great|okay|ok|fine)\b/i.test(output)) suspicion += 1;
  if (/\bthanks for asking\b/i.test(output)) suspicion += 1;
  if (/\bhope (you are|you're|ur) (doing )?(well|good)\b/i.test(output)) suspicion += 1;

  return suspicion >= 2;
}

export function sanitizePartialRegenOutput(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return "";
  if (PARTIAL_REGEN_OPTION_LIST_PATTERN.test(raw)) return "";

  let working = unwrapWholeCodeFence(raw);
  working = stripLeadingMeta(working);
  working = stripTrailingFollowUp(working);
  working = unwrapSurroundingQuotes(working);
  working = working.trim();

  if (!working) return "";
  if (PARTIAL_REGEN_OPTION_LIST_PATTERN.test(working)) return "";
  if (PARTIAL_REGEN_TASK_REFERENCE_PATTERN.test(working)) return "";
  if (PARTIAL_REGEN_EXPLANATION_PATTERN.test(working)) return "";
  if (PARTIAL_REGEN_FOLLOW_UP_PATTERN.test(working)) return "";

  return working;
}

export function outputLooksLikeMetaPartialRegen(outputText) {
  const raw = String(outputText || "").trim();
  if (!raw) return false;
  if (PARTIAL_REGEN_OPTION_LIST_PATTERN.test(raw)) return true;
  if (hasPartialRegenMetaSignals(raw)) {
    const sanitized = sanitizePartialRegenOutput(raw);
    return !sanitized || sanitized !== raw;
  }
  return false;
}
