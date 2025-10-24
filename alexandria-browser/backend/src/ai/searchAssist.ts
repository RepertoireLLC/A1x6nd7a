import path from "node:path";

import { pipeline } from "@xenova/transformers";

import { normalizeUserSuppliedMode, type NSFWUserMode } from "../utils/nsfwMode";
import { refineSearchQuery as legacyRefineSearchQuery } from "./LocalAI";

const MODEL_CACHE_DIR = path.resolve(process.cwd(), "alexandria-browser", "backend", "models");

const CATEGORY_LABELS = [
  "archival books and manuscripts",
  "historical newspapers and magazines",
  "scientific research papers",
  "technical manuals and documentation",
  "audiobooks and spoken word recordings",
  "music and concert audio",
  "documentary films and newsreels",
  "silent films and early cinema",
  "photography and image collections",
  "maps and atlases",
  "government documents and records",
  "religious texts",
  "comics and graphic novels",
  "video game software",
  "educational course material",
  "personal diaries and correspondence",
  "oral histories",
  "adult content",
] as const;

type ZeroShotClassificationOutput = {
  labels: string[];
  scores: number[];
};

type ZeroShotClassificationPipeline = (
  text: string,
  labels: string[] | string,
  options?: { multi_label?: boolean }
) => Promise<ZeroShotClassificationOutput | ZeroShotClassificationOutput[]>;

type Text2TextGenerationPipeline = (
  prompt: string,
  options?: Record<string, unknown>
) => Promise<Array<{ generated_text?: string }>>;

interface TransformerAssistModels {
  classifier: ZeroShotClassificationPipeline;
  refiner: Text2TextGenerationPipeline;
}

let initializationPromise: Promise<TransformerAssistModels | null> | null = null;

export function initializeSearchAssist(): Promise<TransformerAssistModels | null> {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      try {
        const classifier = (await pipeline("zero-shot-classification", "Xenova/distilbert-base-uncased", {
          quantized: true,
          cache_dir: MODEL_CACHE_DIR,
          local_files_only: true,
        })) as unknown as ZeroShotClassificationPipeline;

        const refiner = (await pipeline("text2text-generation", "Xenova/flan-t5-small", {
          quantized: true,
          cache_dir: MODEL_CACHE_DIR,
          local_files_only: true,
        })) as unknown as Text2TextGenerationPipeline;

        return { classifier, refiner };
      } catch (error) {
        console.warn(
          "AI-assisted search models could not be initialized from the local cache.",
          error
        );
        return null;
      }
    })().catch((error) => {
      console.error("Failed to prepare transformer pipelines for AI-assisted search.", error);
      initializationPromise = null;
      return null;
    });
  }

  return initializationPromise;
}

function sanitize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeGeneratedQuery(candidate: string, original: string): string | null {
  const sanitized = sanitize(candidate);
  if (!sanitized) {
    return null;
  }

  const withoutPrefix = sanitized.replace(/^(refined query:|suggested query:|query:)/i, "").trim();
  if (!withoutPrefix) {
    return null;
  }

  if (withoutPrefix.length < 3) {
    return null;
  }

  if (withoutPrefix.toLowerCase() === original.toLowerCase()) {
    return null;
  }

  return withoutPrefix;
}

function normalizeClassificationOutput(
  result: ZeroShotClassificationOutput | ZeroShotClassificationOutput[] | null | undefined
): ZeroShotClassificationOutput | null {
  if (!result) {
    return null;
  }

  if (Array.isArray(result)) {
    return result[0] ?? null;
  }

  return result;
}

function selectTopCategories(result: ZeroShotClassificationOutput | ZeroShotClassificationOutput[] | null): string[] {
  const scores = normalizeClassificationOutput(result);
  if (!scores) {
    return [];
  }

  const labels = Array.isArray(scores.labels) ? scores.labels : [];
  const values = Array.isArray(scores.scores) ? scores.scores : [];
  const combined = labels.map((label: string, index: number) => ({
    label,
    score: values[index] ?? 0,
  }));

  return combined
    .filter((entry) => entry.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => entry.label);
}

function filterCategoriesForMode(mode: NSFWUserMode, labels: string[]): string[] {
  if (mode === "nsfw-only") {
    return labels.includes("adult content") ? ["adult content"] : labels;
  }

  return labels.filter((label) => label !== "adult content");
}

export interface QueryRefinementResult {
  finalQuery: string;
  refined: boolean;
  categories: string[];
  source: "transformer" | "legacy" | "original";
}

export async function refineQueryWithTransformers(
  query: string,
  mode: NSFWUserMode
): Promise<QueryRefinementResult> {
  const sanitizedQuery = sanitize(query);
  if (!sanitizedQuery) {
    return { finalQuery: query, refined: false, categories: [], source: "original" };
  }

  const userMode = normalizeUserSuppliedMode(mode);
  const pipelines = await initializeSearchAssist();

  if (!pipelines) {
    const legacy = await legacyRefineSearchQuery(query, mode);
    if (legacy && legacy.trim().toLowerCase() !== sanitizedQuery.toLowerCase()) {
      return {
        finalQuery: legacy.trim(),
        refined: true,
        categories: [],
        source: "legacy",
      };
    }

    return { finalQuery: query, refined: false, categories: [], source: "original" };
  }

  try {
    const classification = await pipelines.classifier(sanitizedQuery, Array.from(CATEGORY_LABELS), {
      multi_label: true,
    });
    const topCategories = filterCategoriesForMode(userMode, selectTopCategories(classification));
    const categoryInstruction =
      topCategories.length > 0
        ? `Focus on materials related to: ${topCategories.join(", ")}.`
        : "Identify the most relevant archive-specific keywords.";

    const modeGuidance =
      userMode === "safe"
        ? "Exclude explicit or adult references."
        : userMode === "moderate"
        ? "Allow mature themes in general terms, but avoid explicit wording."
        : userMode === "nsfw-only"
        ? "Prioritize adult-tagged material and well-known NSFW creators."
        : "Do not filter results; prefer historically precise terminology.";

    const prompt = [
      "You assist with Internet Archive searches.",
      "Rewrite the user's query into a concise set of search keywords suitable for the Internet Archive.",
      "Return only keywords and phrases separated by commas; do not add sentences or commentary.",
      categoryInstruction,
      modeGuidance,
      `User query: ${sanitizedQuery}`,
    ].join(" \n");

    const outputs = await pipelines.refiner(prompt, {
      max_new_tokens: 48,
      temperature: 0.1,
      top_p: 0.9,
      do_sample: false,
    });

    const generated = Array.isArray(outputs) && outputs.length > 0 ? outputs[0]?.generated_text ?? "" : "";
    const normalized = normalizeGeneratedQuery(generated, sanitizedQuery);

    if (normalized) {
      return {
        finalQuery: normalized,
        refined: true,
        categories: topCategories,
        source: "transformer",
      };
    }
  } catch (error) {
    console.warn("Transformer-assisted query refinement failed. Falling back to legacy refinement.", error);
  }

  try {
    const legacy = await legacyRefineSearchQuery(query, mode);
    if (legacy && legacy.trim().toLowerCase() !== sanitizedQuery.toLowerCase()) {
      return {
        finalQuery: legacy.trim(),
        refined: true,
        categories: [],
        source: "legacy",
      };
    }
  } catch (error) {
    console.warn("Legacy query refinement failed.", error);
  }

  return { finalQuery: query, refined: false, categories: [], source: "original" };
}
