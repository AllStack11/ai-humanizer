export const BASE_CLICHES = [
  "delve","certainly","I'd be happy to","it's worth noting","in conclusion",
  "in today's fast-paced world","in the ever-evolving","it goes without saying",
  "game-changer","leverage","unleash","dive deep","let's explore",
  "comprehensive","robust","streamline","cutting-edge","state-of-the-art",
  "revolutionary","transformative","in summary","as mentioned above",
  "it is important to note","overall,","in essence,","fundamentally,",
  "undoubtedly,","rest assured","without further ado","that being said",
  "having said that","as we can see","it's clear that","it's evident that",
  "navigating","landscape","paradigm","synergy","unlock potential",
  "harness","empower","foster","pivotal","crucial","vital","paramount",
  "at its core","when it comes to","needless to say","in the realm of",
  "it's no secret that","the bottom line","moving forward"
];

// Tier-1 clichés: highest-signal AI fingerprints — always appear first in the constraint
// regardless of LLM refresh order, so the model always sees the most diagnostic prohibitions
export const TIER1_CLICHES = new Set([
  "delve", "certainly", "I'd be happy to", "it's worth noting",
  "in today's fast-paced world", "game-changer", "leverage", "dive deep",
  "comprehensive", "robust", "streamline", "cutting-edge", "revolutionary",
  "transformative", "navigating", "landscape", "paradigm", "synergy",
  "unlock potential", "harness", "empower", "foster", "pivotal",
]);

export const CLICHE_PROMPT = `List the most current overused AI writing clichés and buzzwords that make text sound AI-generated in ${new Date().getFullYear()}. Return ONLY a JSON array of strings, no markdown, no explanation. At least 60 terms.`;
