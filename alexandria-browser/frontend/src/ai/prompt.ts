import type { NSFWFilterMode } from "../types";

export interface StructuredArchivePlan {
  topic?: string;
  mediatypes?: string[];
  years?: string | null;
  include?: string[];
  exclude?: string[];
  summary?: string;
  nsfwStrategy?: string;
}

const PLAN_MEDIA_ENUM = ["texts", "audio", "movies", "software", "image", "web"] as const;

/**
 * Construct the instruction prompt sent to the Puter runtime to derive an Internet Archive search plan.
 * This version is optimised for streaming feedback so the user sees the plan evolve in real time.
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

export const ARCHIVE_PLAN_TOOL = [
  {
    type: "function",
    function: {
      name: "create_archive_plan",
      description:
        "Generate a structured Internet Archive search plan with filters, media hints, and NSFW handling instructions.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "Core subject or theme summarised in a short phrase.",
          },
          mediatypes: {
            type: "array",
            description: "List of media types relevant to the request.",
            items: {
              type: "string",
              enum: PLAN_MEDIA_ENUM,
            },
          },
          years: {
            type: ["string", "null"],
            description: "Exact year or range like 1970..1980 if the user implies a timeframe.",
          },
          include: {
            type: "array",
            description: "Search terms to prioritise or include in the query.",
            items: {
              type: "string",
            },
          },
          exclude: {
            type: "array",
            description: "Search terms or concepts to exclude.",
            items: {
              type: "string",
            },
          },
          summary: {
            type: "string",
            description: "One paragraph explanation of how the plan addresses the request.",
          },
          nsfwStrategy: {
            type: "string",
            description: "Instructions for applying the NSFW mode constraints.",
          },
        },
        required: ["topic", "mediatypes", "include", "exclude", "summary"],
      },
    },
  },
] as const;

/**
 * Build a directive that forces Puter to respond using the archive plan tool.
 */
export function toStructuredPlanPrompt(userText: string, nsfwMode: NSFWFilterMode): string {
  return `You are the Alexandria Archive Assistant. Analyse the user's request and respond by calling the create_archive_plan tool.

User request: """${userText}"""
NSFW mode: "${nsfwMode}".

Always provide mediatypes, include/exclude suggestions, a year hint if present, and describe how NSFW mode should be applied.`;
}

/**
 * Coerce arbitrary data coming back from the AI tool invocation into a structured plan.
 */
export function coerceStructuredPlan(payload: unknown): StructuredArchivePlan {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const plan: StructuredArchivePlan = {};

  if (typeof record.topic === "string") {
    plan.topic = record.topic.trim();
  }

  if (Array.isArray(record.mediatypes)) {
    plan.mediatypes = record.mediatypes
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => PLAN_MEDIA_ENUM.includes(value as (typeof PLAN_MEDIA_ENUM)[number]));
  }

  if (typeof record.years === "string") {
    plan.years = record.years.trim();
  } else if (record.years == null) {
    plan.years = null;
  }

  if (Array.isArray(record.include)) {
    plan.include = record.include
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (Array.isArray(record.exclude)) {
    plan.exclude = record.exclude
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (typeof record.summary === "string") {
    plan.summary = record.summary.trim();
  }

  if (typeof record.nsfwStrategy === "string") {
    plan.nsfwStrategy = record.nsfwStrategy.trim();
  }

  return plan;
}

/**
 * Generate a plaintext description from the structured plan, suitable for displaying in the chat log.
 */
export function structuredPlanToText(plan: StructuredArchivePlan): string {
  const lines: string[] = [];
  if (plan.summary) {
    lines.push(plan.summary);
  }

  if (plan.topic) {
    lines.push(`topic: ${plan.topic}`);
  }

  if (plan.mediatypes && plan.mediatypes.length > 0) {
    lines.push(`mediatypes: ${plan.mediatypes.join(", ")}`);
  }

  if (plan.years) {
    lines.push(`years: ${plan.years}`);
  }

  const include = plan.include?.join(", ");
  if (include) {
    lines.push(`include: ${include}`);
  }

  const exclude = plan.exclude?.join(", ");
  if (exclude) {
    lines.push(`exclude: ${exclude}`);
  }

  if (plan.nsfwStrategy) {
    lines.push(`nsfw: ${plan.nsfwStrategy}`);
  }

  return lines.join("\n").trim();
}
