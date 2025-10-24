import type { NSFWUserMode } from "../src/utils/nsfwMode";

const promptPrefix: Record<NSFWUserMode | "unrestricted", string> = {
  safe: "Avoid all explicit, adult, or graphic content. Keep language clean.",
  moderate: "You may reference mature topics briefly but do NOT provide explicit detail.",
  unrestricted: "You may discuss topics freely but avoid illegal content or graphic violence.",
  "nsfw-only": "User allows explicit adult content. You may generate erotic or explicit text only if directly requested.",
};

export function buildPrompt(mode: NSFWUserMode, userPrompt: string): string {
  const prefix = promptPrefix[mode] ?? promptPrefix.unrestricted;
  return `${prefix}\nUser: ${userPrompt}\nAI:`;
}
