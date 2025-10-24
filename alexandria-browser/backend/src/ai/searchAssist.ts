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

const DISALLOWED_PATTERNS = [
  /i['’]m not a fan of the internet/,
] as const;

const MAX_REFINEMENT_TERMS = 3;
const REFINEMENT_CACHE_TTL_MS = 5 * 60 * 1000;

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

interface CachedRefinementEntry {
  createdAt: number;
  result: QueryRefinementResult;
}

/**
 * Lightweight in-memory cache to avoid re-running transformer pipelines for
 * identical queries within a short window. This keeps repeated searches snappy
 * while still allowing fresh refinements if the user adjusts their wording or mode.
 */
const refinementCache = new Map<string, CachedRefinementEntry>();

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
  return text
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function hasExtremeTokenRepetition(tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }

  const counts = new Map<string, number>();
  let maxCount = 0;

  for (const token of tokens) {
    const next = (counts.get(token) ?? 0) + 1;
    counts.set(token, next);
    if (next > maxCount) {
      maxCount = next;
    }
  }

  return maxCount >= 3 && maxCount / tokens.length >= 0.6;
}

function containsDisallowedFragment(text: string): boolean {
  const lowered = text.toLowerCase();
  return DISALLOWED_PATTERNS.some((pattern) => pattern.test(lowered));
}

// Filter generations that repeat the same sentence fragments, which previously
// caused the AI to "chant" unhelpful phrases.
function containsRepeatedSentence(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .split(/[.!?]+/)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter((segment) => segment.length > 0);

  if (normalized.length <= 1) {
    return false;
  }

  const counts = new Map<string, number>();
  for (const segment of normalized) {
    if (segment.length < 6) {
      continue;
    }
    const next = (counts.get(segment) ?? 0) + 1;
    if (next >= 2) {
      return true;
    }
    counts.set(segment, next);
  }

  return false;
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

  if (containsDisallowedFragment(withoutPrefix)) {
    return null;
  }

  if (containsRepeatedSentence(withoutPrefix)) {
    return null;
  }

  const normalizedOriginal = original.toLowerCase();
  if (withoutPrefix.toLowerCase() === normalizedOriginal) {
    return null;
  }

  const candidateTokens = tokenize(withoutPrefix);
  if (candidateTokens.length === 0) {
    return null;
  }

  if (hasExtremeTokenRepetition(candidateTokens)) {
    return null;
  }

  const originalTokens = new Set(tokenize(original));
  const sharedToken = candidateTokens.some((token) => originalTokens.has(token));

  if (!sharedToken && new Set(candidateTokens).size <= 1) {
    return null;
  }

  return withoutPrefix;
}

function extractKeywordPhrases(candidate: string): string[] {
  const rawParts = candidate
    .split(/[\n,;]+/)
    .map((part) => sanitize(part))
    .filter((part) => part.length > 0);

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const part of rawParts) {
    const lowered = part.toLowerCase();
    if (seen.has(lowered)) {
      continue;
    }
    seen.add(lowered);
    unique.push(part);
  }

  return unique;
}

function shouldIncludeSuggestion(
  suggestion: string,
  originalTokens: Set<string>
): boolean {
  if (!suggestion) {
    return false;
  }

  const lowered = suggestion.toLowerCase();
  if (containsDisallowedFragment(lowered)) {
    return false;
  }

  if (containsRepeatedSentence(lowered)) {
    return false;
  }

  const tokens = tokenize(suggestion);
  if (tokens.length === 0) {
    return false;
  }

  if (hasExtremeTokenRepetition(tokens)) {
    return false;
  }

  const uniqueTokens = new Set(tokens);
  const sharesOriginalToken = tokens.some((token) => originalTokens.has(token));

  if (!sharesOriginalToken && uniqueTokens.size <= 1) {
    return false;
  }

  return true;
}

function wrapSuggestionForQuery(suggestion: string): string {
  const trimmed = suggestion.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[^\s:]+$/.test(trimmed)) {
    return trimmed;
  }

  const escaped = trimmed.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildFinalQuery(
  original: string,
  suggestions: string[],
  categories: string[]
): { query: string; refined: boolean; applied: string[] } {
  const base = sanitize(original);
  const originalTokens = new Set(tokenize(base));
  const applied: string[] = [];
  const seen = new Set<string>();

  const tryAdd = (value: string) => {
    const normalized = sanitize(value);
    if (!normalized) {
      return;
    }
    const lowered = normalized.toLowerCase();
    if (seen.has(lowered)) {
      return;
    }
    if (lowered === base.toLowerCase()) {
      return;
    }
    if (!shouldIncludeSuggestion(normalized, originalTokens)) {
      return;
    }
    seen.add(lowered);
    applied.push(normalized);
  };

  for (const suggestion of suggestions) {
    tryAdd(suggestion);
    if (applied.length >= MAX_REFINEMENT_TERMS) {
      break;
    }
  }

  if (applied.length < MAX_REFINEMENT_TERMS) {
    for (const label of categories) {
      if (applied.length >= MAX_REFINEMENT_TERMS) {
        break;
      }
      tryAdd(label);
    }
  }

  if (applied.length === 0) {
    return { query: base, refined: false, applied: [] };
  }

  const segments = [base, ...applied.map((entry) => wrapSuggestionForQuery(entry))];
  const combined = segments.filter((segment) => segment && segment.trim().length > 0).join(" OR ");
  const refined = combined.trim().toLowerCase() !== base.trim().toLowerCase();

  return {
    query: refined ? combined : base,
    refined,
    applied,
  };
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
  suggestions?: string[];
}

function cloneRefinementResult(value: QueryRefinementResult): QueryRefinementResult {
  const base: QueryRefinementResult = {
    finalQuery: value.finalQuery,
    refined: value.refined,
    categories: [...value.categories],
    source: value.source,
  };

  if (Array.isArray(value.suggestions)) {
    base.suggestions = [...value.suggestions];
  }

  return base;
}

function getCachedRefinement(key: string): QueryRefinementResult | null {
  const entry = refinementCache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.createdAt > REFINEMENT_CACHE_TTL_MS) {
    refinementCache.delete(key);
    return null;
  }

  return cloneRefinementResult(entry.result);
}

function cacheRefinement(key: string, result: QueryRefinementResult): void {
  refinementCache.set(key, {
    createdAt: Date.now(),
    result: cloneRefinementResult(result),
  });
}

function finalizeRefinement(
  cacheKey: string | null,
  result: QueryRefinementResult
): QueryRefinementResult {
  if (cacheKey) {
    cacheRefinement(cacheKey, result);
  }
  return cloneRefinementResult(result);
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
  const cacheKey = `${userMode}::${sanitizedQuery.toLowerCase()}`;

  const cached = getCachedRefinement(cacheKey);
  if (cached) {
    return cached;
  }
  const pipelines = await initializeSearchAssist();

  if (!pipelines) {
    const legacy = await legacyRefineSearchQuery(query, mode);
    if (legacy && legacy.trim().toLowerCase() !== sanitizedQuery.toLowerCase()) {
      return finalizeRefinement(cacheKey, {
        finalQuery: legacy.trim(),
        refined: true,
        categories: [],
        source: "legacy",
      });
    }

    return finalizeRefinement(cacheKey, {
      finalQuery: query,
      refined: false,
      categories: [],
      source: "original",
    });
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
      const suggestions = extractKeywordPhrases(normalized);
      const final = buildFinalQuery(sanitizedQuery, suggestions, topCategories);
      if (final.refined) {
        return finalizeRefinement(cacheKey, {
          finalQuery: final.query,
          refined: true,
          categories: topCategories,
          source: "transformer",
          suggestions: final.applied,
        });
      }
    }
  } catch (error) {
    console.warn("Transformer-assisted query refinement failed. Falling back to legacy refinement.", error);
  }

  try {
    const legacy = await legacyRefineSearchQuery(query, mode);
    if (legacy && legacy.trim().toLowerCase() !== sanitizedQuery.toLowerCase()) {
      return finalizeRefinement(cacheKey, {
        finalQuery: legacy.trim(),
        refined: true,
        categories: [],
        source: "legacy",
      });
    }
  } catch (error) {
    console.warn("Legacy query refinement failed.", error);
  }

  return finalizeRefinement(cacheKey, {
    finalQuery: query,
    refined: false,
    categories: [],
    source: "original",
  });
}
