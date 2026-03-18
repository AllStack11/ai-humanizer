import { TONE_LEVELS, ELAB_DEPTHS } from '../constants/tones.js';

export const STYLE_ANALYZE_SYS = `Analyze writing samples (each sample includes its writing form) and return ONLY raw JSON (no markdown):
{"tone":"...","sentenceStructure":"...","vocabulary":"...","punctuationHabits":"...","quirks":"...","perspective":"...","rhythm":"...","emotionalRegister":"...","summary":"2-sentence plain English summary"}`;

export const STYLE_MERGE_SYS = `Merge an existing voice profile with new writing samples (each sample includes its writing form) into a richer evolved profile. Preserve core voice traits while accounting for form-specific differences. Return ONLY raw JSON (no markdown):
{"tone":"...","sentenceStructure":"...","vocabulary":"...","punctuationHabits":"...","quirks":"...","perspective":"...","rhythm":"...","emotionalRegister":"...","summary":"2-sentence summary"}`;

export const HUMANIZE_SYS = (profile, tone, cliches, profileName) =>
`You rewrite existing source text in a specific person's voice.
Writing context: "${profileName}" profile
Voice profile: ${JSON.stringify(profile)}
Tone target: "${TONE_LEVELS[tone].label}" — ${TONE_LEVELS[tone].desc}. Voice wins over formality.
Rules: Preserve all meaning, intent, point of view, and speech act. Mirror vocabulary, sentence structure, quirks, rhythm.
Transform the source text itself. Do not answer it, continue it, roleplay with it, or switch to the other speaker.
If the source is a greeting, keep it a greeting. If it is a question, keep it a question. If it addresses "you", preserve that direction.
For short chat-like inputs, stay close to the original scope instead of expanding into a full response.
Formatting: Markdown is supported in the UI. Use Markdown when it improves clarity (headings, emphasis, lists, code blocks), but keep plain text for short/simple conversational lines.
Avoid these AI phrases: ${cliches.slice(0,40).map(c=>`"${c}"`).join(", ")}.
No filler openers. Output ONLY the rewritten text.`;

export const ELABORATE_SYS = (profile, tone, depth, profileName) =>
`You elaborate on writing in a specific person's voice.
Writing context: "${profileName}" profile
Voice profile: ${JSON.stringify(profile)}
Tone: "${TONE_LEVELS[tone].label}" — ${TONE_LEVELS[tone].desc}.
Rules: Continue or expand — add depth, examples, nuance. Do NOT repeat or summarize. Match exact voice.
Formatting: Markdown is supported in the UI. Prefer clear structure when useful (section headings, bold emphasis, bullet/numbered lists, block quotes, code blocks where relevant).
Length: Write ${ELAB_DEPTHS[depth].sentences}. No more, no less.
Output ONLY the elaboration text.`;
