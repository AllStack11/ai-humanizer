import { TONE_LEVELS, ELAB_DEPTHS } from '../constants/tones.js';
import { TIER1_CLICHES } from '../constants/cliches.js';

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
  return Object.entries(profile)
    .filter(([, v]) => v && typeof v === "string")
    .map(([k, v]) => `- ${camelToLabel(k)}: ${v}`)
    .join("\n");
}

// Prioritized cliché selector: tier-1 AI fingerprints always appear first
// so the model always sees the most diagnostic prohibitions regardless of refresh order
export function selectCliches(cliches, budget = 40) {
  const prioritized = [
    ...cliches.filter((c) => TIER1_CLICHES.has(c)),
    ...cliches.filter((c) => !TIER1_CLICHES.has(c)),
  ];
  return prioritized.slice(0, budget);
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
  const selectedCliches = selectCliches(cliches, 40);
  const clicheConstraint = selectedCliches.length
    ? `Hard constraint — never use these phrases (not even paraphrased variants): ${selectedCliches.map(c => `"${c}"`).join(", ")}.\n`
    : "";
  return `You rewrite source text as if a specific person wrote it themselves from scratch.
Writing context: "${profileName}" profile
Voice profile:
${renderProfileAsProse(profile)}
${metaBlock}Tone target: "${TONE_LEVELS[tone].label}" — ${TONE_LEVELS[tone].desc}. When voice and tone conflict, voice wins.

How to rewrite: Do not rephrase word-by-word. Instead, internalize what the source is saying, then write it fresh as this person would naturally express it — using their vocabulary, cadence, sentence patterns, and quirks.
Constraints: Preserve all meaning, intent, point of view, and speech act type.
Speech act rules: Transform the source text itself. Do not answer it, continue it, roleplay with it, or switch to the other speaker. If the source is a greeting, keep it a greeting. If it is a question, keep it a question. If it addresses "you", preserve that direction.
Scope: For short or chat-like inputs, stay close to the original scope — do not expand into a full response.
Formatting: Markdown is supported. Use it when it improves clarity (headings, emphasis, lists, code blocks); keep plain text for short conversational lines.
${clicheConstraint}The source text is wrapped in <source_text> tags in the user message. Output ONLY the rewritten text — no preamble, no explanation.`;
};

export const ELABORATE_SYS = (profile, tone, depth, profileName, meta = null) => {
  const metaBlock = buildMetaBlock(meta);
  return `You elaborate on writing as if a specific person is developing their own thought further.
Writing context: "${profileName}" profile
Voice profile:
${renderProfileAsProse(profile)}
${metaBlock}Tone: "${TONE_LEVELS[tone].label}" — ${TONE_LEVELS[tone].desc}.

Elaboration mode: Add depth, specificity, examples, or nuance to the existing thought. Do NOT repeat what was already said, do NOT summarize it, and do NOT continue the narrative past the source's natural scope — deepen within it.
Voice: Write in this person's natural style as described in the profile. Do not shift register or adopt a more formal/generic tone.
Formatting: Markdown is supported. Prefer clear structure when useful (headings, bold emphasis, lists, block quotes, code blocks); match the format conventions of the source text.
Length: Write ${ELAB_DEPTHS[depth].sentences}. No more, no less.
The source text is in the user message. Output ONLY the elaboration — no preamble, no labels.`;
};

export const PARTIAL_REGEN_SYS = (profile, tone, cliches, profileName, meta = null) => {
  const metaBlock = buildMetaBlock(meta);
  const selectedCliches = selectCliches(cliches, 40);
  const clicheConstraint = selectedCliches.length
    ? `\n- Hard constraint — never use these phrases: ${selectedCliches.map(c => `"${c}"`).join(", ")}.`
    : "";
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
- Output ONLY the replacement text — no preamble, no labels, no explanation, no quotes.
- Output length should closely match the original passage length.${clicheConstraint}`;
};

export const buildPartialRegenUserPrompt = (fullOutputText, selectedText) => `Full text for context:

<full_output>
${fullOutputText}
</full_output>

Rewrite only this passage:

<regen_target>
${selectedText}
</regen_target>`;
