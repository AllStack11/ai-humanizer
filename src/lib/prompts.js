import { TONE_LEVELS, ELAB_DEPTHS } from '../constants/tones.js';
import { TIER1_CLICHES } from '../constants/cliches.js';
import { OUTPUT_PRESET_OPTIONS } from "../constants/presets.js";

// ─── Shared helpers ────────────────────────────────────────────────────────────

export function buildMetaBlock(meta) {
  if (!meta) return "";
  const lines = [
    meta.goals?.length   ? `Writing goals: ${meta.goals.join(", ")}.`     : "",
    meta.audience        ? `Target audience: ${meta.audience}.`           : "",
    meta.domains?.length ? `Content domains: ${meta.domains.join(", ")}.` : "",
  ].filter(Boolean);
  return lines.length ? `Writing intent:\n${lines.join("\n")}\n` : "";
}

function camelToLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .replace(/^./, (s) => s.toUpperCase());
}

export function renderProfileAsProse(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return "";
  return Object.entries(profile)
    .filter(([, v]) => v && typeof v === "string")
    .map(([k, v]) => `- ${camelToLabel(k)}: ${v}`)
    .join("\n");
}

// Prioritized cliché selector: tier-1 AI fingerprints always appear first
// so the model always sees the most diagnostic prohibitions regardless of refresh order
function normalizeTermList(terms) {
  if (!Array.isArray(terms)) return [];
  return [...new Set(
    terms
      .map((term) => (typeof term === "string" ? term.trim().toLowerCase() : ""))
      .filter(Boolean)
  )];
}

function normalizeClicheInput(cliches) {
  if (Array.isArray(cliches)) {
    return { generatedTerms: normalizeTermList(cliches), customTerms: [], punctuationTerms: [] };
  }
  if (!cliches || typeof cliches !== "object") {
    return { generatedTerms: [], customTerms: [], punctuationTerms: [] };
  }
  return {
    generatedTerms: normalizeTermList(cliches.generatedTerms),
    customTerms: normalizeTermList(cliches.customTerms),
    punctuationTerms: normalizeTermList(cliches.punctuationTerms),
  };
}

function shuffleTerms(terms) {
  const next = [...terms];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function selectCliches(cliches, budget = 40) {
  const { generatedTerms, customTerms, punctuationTerms } = normalizeClicheInput(cliches);
  const customSet = new Set(customTerms);
  const punctuationSet = new Set(punctuationTerms);
  const prioritized = [
    ...shuffleTerms(punctuationTerms),
    ...shuffleTerms(generatedTerms.filter((c) => TIER1_CLICHES.has(c) && !customSet.has(c))),
    ...shuffleTerms(customTerms),
    ...shuffleTerms(generatedTerms.filter((c) => !TIER1_CLICHES.has(c) && !customSet.has(c) && !punctuationSet.has(c))),
  ];
  return prioritized.slice(0, budget);
}

function formatQuotedTermList(terms) {
  return terms.map((term) => `"${term}"`).join(", ");
}

function splitPunctuationTerms(terms) {
  const punctuationTerms = [];
  const phraseTerms = [];

  terms.forEach((term) => {
    if (/^[^\p{L}\p{N}]+$/u.test(term)) {
      punctuationTerms.push(term);
      return;
    }
    phraseTerms.push(term);
  });

  return { punctuationTerms, phraseTerms };
}

export function buildAiTermGuidance(cliches, budget = 40) {
  const selectedCliches = selectCliches(cliches, budget);
  if (!selectedCliches.length) return "";

  const { customTerms, punctuationTerms } = normalizeClicheInput(cliches);
  const customSet = new Set(customTerms);
  const punctuationSet = new Set(punctuationTerms);
  const hardBanTerms = selectedCliches.filter((term) => customSet.has(term) || punctuationSet.has(term));
  const softGuidanceTerms = selectedCliches.filter((term) => !customSet.has(term) && !punctuationSet.has(term));
  const { punctuationTerms: hardPunctuationTerms, phraseTerms: hardPhraseTerms } = splitPunctuationTerms(hardBanTerms);
  const { punctuationTerms: softPunctuationTerms, phraseTerms: softPhraseTerms } = splitPunctuationTerms(softGuidanceTerms);
  const guidance = ["AI-term avoidance policy:"];

  if (hardPhraseTerms.length) {
    guidance.push(`- Hard bans: Do not use these exact terms or obvious surface variants under any circumstance: ${formatQuotedTermList(hardPhraseTerms)}.`);
  }

  if (hardPunctuationTerms.length) {
    guidance.push(`- Punctuation bans: Do not use these punctuation patterns under any circumstance: ${formatQuotedTermList(hardPunctuationTerms)}.`);
  }

  if (softPhraseTerms.length) {
    guidance.push(`- Soft bans: Avoid these AI-sounding terms when rewriting. Prefer plainer, more natural alternatives: ${formatQuotedTermList(softPhraseTerms)}.`);
  }

  if (softPunctuationTerms.length) {
    guidance.push(`- Punctuation bans: Avoid these punctuation fingerprints unless the source literally requires them: ${formatQuotedTermList(softPunctuationTerms)}.`);
  }

  guidance.push("- Silent final pass: Before you answer, scan the draft for any hard-ban term, banned punctuation such as an em dash, or obvious surface variant. If you find one, rewrite silently and then return only the clean final text.");
  return `${guidance.join("\n")}\n`;
}

// ─── Profile training prompts ─────────────────────────────────────────────────

export const STYLE_ANALYZE_SYS = `Analyze the writing samples below (each labeled with its form) and return ONLY raw JSON (no markdown, no explanation).

Field guidance — keep each value concise (1–2 phrases max):
- tone: overall attitude and affect (e.g. "dry and self-deprecating", "warm and direct")
- sentenceStructure: dominant sentence pattern (e.g. "short punchy sentences with occasional run-ons", "long subordinate clauses, rarely fragments")
- vocabulary: word-choice character (e.g. "plain Anglo-Saxon, avoids jargon", "technical but accessible, loves precise nouns")
- punctuationHabits: notable punctuation tendencies (e.g. "heavy em-dash use, comma-light", "Oxford comma always, ellipsis for trailing thought")
- quirks: idiosyncratic patterns that recur (e.g. "opens with a rhetorical question", "uses 'honestly' and 'look' as softeners")
- perspective: typical point-of-view stance (e.g. "strong first-person, shares personal anecdotes", "observer stance, rarely uses 'I'")
- rhythm: pacing and flow feel (e.g. "staccato bursts then long exhales", "even measured cadence throughout")
- emotionalRegister: emotional texture (e.g. "restrained but warm", "openly enthusiastic, occasionally vulnerable")
- formality: natural formality spectrum (e.g. "casually formal — professional without stiffness", "very informal, treats reader as a friend")
- humor: comedic voice if present (e.g. "deadpan asides, self-aware irony", "none — earnest throughout")
- transitionStyle: how ideas link across sentences and paragraphs (e.g. "abrupt pivots, trusts reader to follow", "explicit signposting with 'but', 'so', 'here's the thing'")
- summary: 2-sentence plain-English description of the overall voice

If samples are sparse (1–2), describe only what is clearly evidenced; use shorter phrases rather than guessing. If samples are contradictory across forms, describe the dominant pattern and note the variation.

Return schema:
{"tone":"...","sentenceStructure":"...","vocabulary":"...","punctuationHabits":"...","quirks":"...","perspective":"...","rhythm":"...","emotionalRegister":"...","formality":"...","humor":"...","transitionStyle":"...","summary":"..."}`;

export const STYLE_MERGE_SYS = `You are evolving an existing writer voice profile by incorporating new writing samples (each labeled with its form).

Trait stability guide — how to handle each field when new samples conflict with the existing profile:
- STABLE traits (reflect the writer's core identity — update only if new evidence is strong and consistent): tone, vocabulary, perspective, emotionalRegister, formality, humor
- CONTEXTUAL traits (legitimately vary by writing form — blend across forms, note dominant pattern): sentenceStructure, rhythm, punctuationHabits, transitionStyle, quirks

Merge rules:
1. For STABLE traits: if new samples reinforce the existing value, keep it; if they clearly contradict it, update to reflect the fuller picture.
2. For CONTEXTUAL traits: synthesize a description that captures the dominant pattern across all samples; mention notable form-specific variation only if it is significant.
3. Preserve specific details (named quirks, particular phrases) that appear in existing profile unless new samples show they were anomalies.
4. Keep all values concise (1–2 phrases). Update the summary to reflect the evolved understanding.

Return ONLY raw JSON (no markdown):
{"tone":"...","sentenceStructure":"...","vocabulary":"...","punctuationHabits":"...","quirks":"...","perspective":"...","rhythm":"...","emotionalRegister":"...","formality":"...","humor":"...","transitionStyle":"...","summary":"2-sentence summary"}`;

// ─── Generation prompts ───────────────────────────────────────────────────────

export const HUMANIZE_SYS = (profile, tone, cliches, profileName, meta = null) => {
  const metaBlock = buildMetaBlock(meta);
  const aiTermGuidance = buildAiTermGuidance(cliches, 40);
  return `You rewrite source text as if a specific person wrote it themselves from scratch.
Writing context: "${profileName}" profile
Voice profile:
${renderProfileAsProse(profile)}
${metaBlock}When voice and tone conflict, voice wins.

How to rewrite: Do not rephrase word-by-word. Instead, internalize what the source is saying, then write it fresh as this person would naturally express it — using their vocabulary, cadence, sentence patterns, and quirks.
Constraints: Preserve all meaning, intent, point of view, and speech act type.
Speech act rules: Transform the source text itself. Do not answer it, continue it, roleplay with it, or switch to the other speaker. If the source is a greeting, keep it a greeting. If it is a question, keep it a question. If it addresses "you", preserve that direction.
Scope: For short or chat-like inputs, stay close to the original scope — do not expand into a full response.
Formatting: Markdown is supported. Use it when it improves clarity (headings, emphasis, lists, code blocks); keep plain text for short conversational lines.
${aiTermGuidance}The source text is wrapped in <source_text> tags in the user message. Output ONLY the rewritten text — no preamble, no explanation.`;
};

function getElaborateDepthGuidance(depth) {
  const primaryRuleByDepth = [
    "Primary constraint: keep the elaboration very short.",
    "Primary constraint: keep the elaboration brief.",
    "Primary constraint: keep the elaboration compact.",
    "Primary constraint: keep the elaboration focused.",
    "Primary constraint: keep the elaboration deep but bounded.",
  ];
  const guidanceByDepth = [
    "Depth rule: add only a brief follow-on detail or clarification. Keep it tight, additive, and clearly tied to the source.",
    "Depth rule: add a compact extension of the thought with one or two concrete layers of specificity.",
    "Depth rule: build one short paragraph with meaningful detail, not filler.",
    "Depth rule: develop the thought with concrete nuance, framing, or examples while staying inside one focused expansion.",
    "Depth rule: deliver a full, deep elaboration with layered specificity and examples, but do not drift into a new topic.",
  ];
  const prohibitionByDepth = [
    "Do not add setup, recap, transition sentences, conclusions, or extra examples. Do not bloom into a paragraph.",
    "Do not add a full introduction, wrap-up, or broad side branch beyond the core idea already present.",
    "Do not pad with generic framing, repetition, or broad summary sentences.",
    "Do not drift into adjacent themes or add a second separate line of argument.",
    "Do not spill into a new section, unrelated tangent, or broader topic shift.",
  ];

  return `${primaryRuleByDepth[depth] || primaryRuleByDepth[2]}
${guidanceByDepth[depth] || guidanceByDepth[2]}
${prohibitionByDepth[depth] || prohibitionByDepth[2]}
Stop rule: once the thought has been extended enough to satisfy the selected depth, stop immediately.`;
}

export function getElaboratePresetInstruction(formatPreset) {
  return OUTPUT_PRESET_OPTIONS.find((option) => option.value === formatPreset)?.prompt || "";
}

export function getElaborateFormatGuidance({ formatPreset = "none", sourceHasMarkdown = false } = {}) {
  if (sourceHasMarkdown) {
    return `Formatting: The source already uses markdown. Preserve that markdown style and extend it only where the elaboration genuinely benefits from it. Do not add decorative structure the source did not earn.`;
  }

  if (formatPreset === "blog-post" || formatPreset === "report") {
    return `Formatting: The source is plain text. Keep the output mostly plain, but you may use light preset-appropriate structure if it improves clarity. Avoid ornamental markdown styling, and do not use block quotes or code fences.`;
  }

  return `Formatting: The source is plain text. Keep the output plain text as well. Do not introduce markdown headings, bullets, numbered lists, block quotes, bold/italic markers, tables, or code fences.`;
}

export const ELABORATE_SYS = (profile, depth, profileName, meta = null, options = {}) => {
  const metaBlock = buildMetaBlock(meta);
  const presetInstruction = getElaboratePresetInstruction(options.formatPreset);
  const formatGuidance = getElaborateFormatGuidance(options);
  const depthGuidance = getElaborateDepthGuidance(depth);
  const presetLine = presetInstruction
    ? `Preset requirement: ${presetInstruction}`
    : `Preset requirement: No special output preset.`;
  return `You elaborate on writing as if a specific person is developing their own thought further.
Writing context: "${profileName}" profile
Voice profile:
${renderProfileAsProse(profile)}
${metaBlock}

${depthGuidance}
Elaboration mode: Add depth, specificity, examples, or nuance to the existing thought. Do NOT repeat what was already said, do NOT summarize it, and do NOT continue the narrative past the source's natural scope — deepen within it.
Voice: Write in this person's natural style as described in the profile. Do not shift register or adopt a more formal/generic tone.
${presetLine}
${formatGuidance}
The source text is wrapped in <source_text> tags in the user message.
Output ONLY the elaboration — no preamble, no labels.`;
};

export const PARTIAL_REGEN_SYS = (profile, tone, cliches, profileName, meta = null) => {
  const metaBlock = buildMetaBlock(meta);
  const aiTermGuidance = buildAiTermGuidance(cliches, 40);
  return `You are a surgical text editor rewriting a single passage within a larger piece of text.
Writing context: "${profileName}" profile
Voice profile:
${renderProfileAsProse(profile)}
${metaBlock}Tone target: "${TONE_LEVELS[tone].label}" — ${TONE_LEVELS[tone].desc}.

Task: Rewrite ONLY the passage marked with <regen_target> tags in the user message.
Rules:
- Match the voice, tone, and rhythm of the surrounding text.
- Preserve the original meaning and intent of the passage exactly.
- Do NOT alter, repeat, or reference any text outside the <regen_target> markers.
- Return valid JSON that matches this exact shape: {"replacement":"..."}.
- The "replacement" value must contain exactly one rewritten passage and nothing else.
- Do NOT provide multiple options, numbered variants, headings, labels, commentary, or follow-up questions inside the replacement.
- Do NOT include wrappers such as "Here is the rewritten text:", "Rewritten passage:", or "Conversational rewrite:" inside the replacement.
- Do NOT wrap the replacement in markdown fences unless those characters are literally part of the passage itself.
- Apply the same AI-term avoidance policy used for full rewrites while staying inside the selected passage.
- ${aiTermGuidance.trim()}
- Output ONLY the JSON object — no preamble, no labels, no explanation.
- Output length should closely match the original passage length.`;
};

export const buildPartialRegenUserPrompt = (fullOutputText, selectedText) => `Full text for context:

<full_output>
${fullOutputText}
</full_output>

Rewrite only this passage:

<regen_target>
${selectedText}
</regen_target>

Respond with JSON only in this exact shape:
{"replacement":"rewritten passage here"}`.trim();
