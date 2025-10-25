import type { NSFWFilterMode } from "../types";

/**
 * Construct the instruction prompt sent to the Puter runtime to derive an Internet Archive search plan.
 */
export function toAIInstruction(userText: string, nsfwMode: NSFWFilterMode): string {
  return `You are the Alexandria Archive Assistant. Convert the user's request into a precise Internet Archive search plan.

Return a short plaintext plan using the keys:
- topic: (core subject in 3-10 words)
- mediatypes: (comma list chosen from texts,audio,movies,software,image,web OR "any")
- years: (exact year, range like 1970..1980, or "any")
- filters: (keywords to include/exclude or relevant collection hints)
- nsfw: (respond with the mode "${nsfwMode}" and how to adapt the search)

If information is missing, prefer "any" rather than guessing.

User request: """${userText}"""
Plan:`;
}
