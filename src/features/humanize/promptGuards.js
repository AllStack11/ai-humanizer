import { ELAB_DEPTHS, TONE_LEVELS } from "../../constants/tones.js";
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

const ELABORATE_MARKDOWN_PATTERNS = [
  /^\s{0,3}#{1,6}\s+\S/m,
  /^\s{0,3}(?:[-*+]\s+\S|\d+\.\s+\S)/m,
  /^\s{0,3}>\s+\S/m,
  /```[\s\S]*?```/,
  /^\s*\|.+\|\s*$/m,
  /\[[^\]]+\]\((?:https?:\/\/|mailto:|tel:)[^)]+\)/,
];

function detectStructuredMarkdown(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return false;
  return ELABORATE_MARKDOWN_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function analyzeElaborateInput(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  return {
    normalized,
    wordCount: countWords(normalized),
    sourceHasMarkdown: detectStructuredMarkdown(normalized),
  };
}

function getToneInstructionLine(tone) {
  const toneConfig = TONE_LEVELS[tone] || TONE_LEVELS[2];
  return `Tone target: "${toneConfig.label}" — ${toneConfig.desc}.`;
}

export function buildHumanizeUserPrompt(text, { strict = false, tone = 2, oneOffInstruction = "" } = {}) {
  const trimmedOneOffInstruction = String(oneOffInstruction || "").trim();
  const analysis = analyzeHumanizeInput(text);
  const guardrails = [
    "Rewrite the source text below using the style instructions already provided.",
    getToneInstructionLine(tone),
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
  if (trimmedOneOffInstruction) {
    guardrails.push(`Extra instruction: ${trimmedOneOffInstruction}`);
  }

  return `${guardrails.join("\n")}\n\n<source_text>\n${String(text || "").trim()}\n</source_text>`;
}

function getElaborateDepthTargetLine(depth) {
  const depthConfig = ELAB_DEPTHS[depth] || ELAB_DEPTHS[2];
  return `Depth target: ${depthConfig.sentences}.`;
}

export function buildElaborateUserPrompt(
  text,
  { sourceHasMarkdown = false, depth = 2, tone = 2, oneOffInstruction = "" } = {}
) {
  const trimmedOneOffInstruction = String(oneOffInstruction || "").trim();
  const normalized = String(text || "").trim();
  const sourceFormat = sourceHasMarkdown ? "markdown" : "plain_text";
  const guardrails = [
    "Elaborate on the source text below using the style instructions already provided.",
    getToneInstructionLine(tone),
    "Deepen the existing thought rather than answering it, summarizing it, or continuing beyond its natural scope.",
    getElaborateDepthTargetLine(depth),
    `Source format: ${sourceFormat}.`,
  ];
  if (trimmedOneOffInstruction) {
    guardrails.push(`Extra instruction: ${trimmedOneOffInstruction}`);
  }

  return `${guardrails.join("\n")}\n\n<source_text>\n${normalized}\n</source_text>`;
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

const PRETEXT_PREFIX_PATTERNS = [
  /^\s*\*{0,2}(?:sure|certainly|absolutely|of course)[,!]?\s+(?:here(?:'|’)s|is)\b[^:\n]{0,160}:\*{0,2}\s*/i,
  /^\s*\*{0,2}here(?:'|’)s\b[^:\n]{0,200}:\*{0,2}\s*/i,
  /^\s*\*{0,2}here\s+is\b[^:\n]{0,200}:\*{0,2}\s*/i,
  /^\s*\*{0,2}(?:rewritten|revised|casual|conversational)\s+(?:text|version|rewrite|passage|draft)\s*:\*{0,2}\s*/i,
  /^\s*\*{0,2}(?:rewrite|rewritten|revised|refined|updated|humanized|elaborated)\s+(?:passage|text|version|draft|output)\s*:\*{0,2}\s*/i,
];

const PROMPT_WRAPPER_TAGS = [
  "source_text",
  "target_voice",
  "regen_target",
  "full_output",
];

const REASONING_TAGS = [
  "thinking",
  "reasoning",
  "analysis",
];

function unwrapKnownPromptWrapper(text) {
  const trimmed = String(text || "").trim();
  for (const tagName of PROMPT_WRAPPER_TAGS) {
    const wholeWrapper = new RegExp(`^<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>$`, "i");
    const wrappedMatch = trimmed.match(wholeWrapper);
    if (wrappedMatch) {
      return {
        text: wrappedMatch[1].trim(),
        removedPrefix: `<${tagName}>`,
      };
    }
  }

  let working = trimmed;
  let removedPrefix = "";
  let changed = false;
  for (const tagName of PROMPT_WRAPPER_TAGS) {
    const openingTag = new RegExp(`^<${tagName}>\\s*`, "i");
    const closingTag = new RegExp(`\\s*<\\/${tagName}>$`, "i");
    if (openingTag.test(working)) {
      working = working.replace(openingTag, "").trim();
      removedPrefix = `<${tagName}>`;
      changed = true;
      break;
    }
    if (closingTag.test(working)) {
      working = working.replace(closingTag, "").trim();
      removedPrefix = `</${tagName}>`;
      changed = true;
      break;
    }
  }

  return {
    text: changed ? working : trimmed,
    removedPrefix,
  };
}

function stripLeadingPretextPrefix(text) {
  const working = String(text || "");
  for (const pattern of PRETEXT_PREFIX_PATTERNS) {
    const match = working.match(pattern);
    if (!match) continue;
    return {
      text: working.slice(match[0].length).trim(),
      removedPrefix: match[0].trim(),
      changed: true,
    };
  }

  return {
    text: working,
    removedPrefix: "",
    changed: false,
  };
}

function stripLeadingReasoningArtifacts(text) {
  let working = String(text || "").trim();
  let changed = false;

  while (working) {
    let matched = false;
    for (const tagName of REASONING_TAGS) {
      const wholeBlockPattern = new RegExp(`^<${tagName}>\\s*[\\s\\S]*?\\s*<\\/${tagName}>\\s*`, "i");
      const leadingWholeBlock = working.match(wholeBlockPattern);
      if (leadingWholeBlock) {
        working = working.slice(leadingWholeBlock[0].length).trim();
        changed = true;
        matched = true;
        break;
      }

      const openingTagPattern = new RegExp(`^<${tagName}>\\s*`, "i");
      const openingTagMatch = working.match(openingTagPattern);
      if (openingTagMatch) {
        working = "";
        changed = true;
        matched = true;
        break;
      }

      const closingTagPattern = new RegExp(`^<\\/${tagName}>\\s*`, "i");
      const closingTagMatch = working.match(closingTagPattern);
      if (closingTagMatch) {
        working = working.slice(closingTagMatch[0].length).trim();
        changed = true;
        matched = true;
        break;
      }
    }

    if (!matched) break;
  }

  return {
    text: working,
    hadReasoning: changed,
  };
}

export function sanitizeGeneratedOutput(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) {
    return { text: "", hadWrapper: false, removedPrefix: "", hadReasoning: false };
  }

  let working = unwrapWholeCodeFence(raw);
  working = unwrapSurroundingQuotes(working);
  working = working.trim();

  let removedPrefix = "";
  let hadWrapper = false;
  let hadReasoning = false;

  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;

    const unwrapped = unwrapKnownPromptWrapper(working);
    if (unwrapped.removedPrefix) {
      removedPrefix ||= unwrapped.removedPrefix;
      hadWrapper = true;
      working = unwrapped.text;
      changed = true;
    }

    const strippedPrefix = stripLeadingPretextPrefix(working);
    if (strippedPrefix.changed) {
      removedPrefix ||= strippedPrefix.removedPrefix;
      hadWrapper = true;
      working = strippedPrefix.text;
      changed = true;
    }

    const strippedReasoning = stripLeadingReasoningArtifacts(working);
    if (strippedReasoning.hadReasoning) {
      hadReasoning = true;
      working = strippedReasoning.text;
      changed = true;
    }

    if (!changed) break;
  }

  return {
    text: working,
    hadWrapper,
    removedPrefix,
    hadReasoning,
  };
}

export function sanitizePartialRegenOutput(text) {
  return sanitizeGeneratedOutput(text).text;
}
