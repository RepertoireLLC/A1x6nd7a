import { pipeline } from "@xenova/transformers";

export type TextGenerationPipeline = (
  prompt: string,
  options?: Record<string, unknown>
) => Promise<Array<{ generated_text: string }>>;

export type FeatureExtractionPipeline = (
  text: string,
  options?: Record<string, unknown>
) => Promise<unknown>;

let generator: TextGenerationPipeline | null = null;
let embedder: FeatureExtractionPipeline | null = null;
let generatorModel = "Xenova/distilgpt2";
let embeddingModel = "Xenova/all-MiniLM-L6-v2";
let generatorPromise: Promise<TextGenerationPipeline> | null = null;
let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;

function toNumberArray(output: unknown): number[] {
  if (!output) {
    return [];
  }

  if (Array.isArray(output)) {
    if (output.length > 0 && Array.isArray(output[0])) {
      return toNumberArray(output[0]);
    }
    return (output as unknown[])
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .filter((value) => Number.isFinite(value));
  }

  if (typeof output === "object") {
    if (output instanceof Float32Array || output instanceof Float64Array) {
      return Array.from(output.values());
    }

    if (output && typeof (output as { data?: unknown }).data !== "undefined") {
      return toNumberArray((output as { data?: unknown }).data);
    }

    const maybeToList = (output as { tolist?: () => unknown }).tolist;
    if (typeof maybeToList === "function") {
      return toNumberArray(maybeToList.call(output));
    }
  }

  if (typeof output === "number" && Number.isFinite(output)) {
    return [output];
  }

  return [];
}

export function configureModels(options: { model?: string; embeddingModel?: string }): void {
  if (options.model && options.model !== generatorModel) {
    generatorModel = options.model;
    generator = null;
    generatorPromise = null;
  }

  if (options.embeddingModel && options.embeddingModel !== embeddingModel) {
    embeddingModel = options.embeddingModel;
    embedder = null;
    embedderPromise = null;
  }
}

async function loadGenerator(): Promise<TextGenerationPipeline> {
  if (generator) {
    return generator;
  }
  if (generatorPromise) {
    return generatorPromise;
  }

  generatorPromise = pipeline("text-generation", generatorModel).then((instance) => {
    generator = instance as TextGenerationPipeline;
    return generator;
  });

  return generatorPromise;
}

async function loadEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) {
    return embedder;
  }
  if (embedderPromise) {
    return embedderPromise;
  }

  embedderPromise = pipeline("feature-extraction", embeddingModel).then((instance) => {
    embedder = instance as FeatureExtractionPipeline;
    return embedder;
  });

  return embedderPromise;
}

export async function initAI(): Promise<void> {
  await Promise.all([loadGenerator(), loadEmbedder()]);
}

export async function askAI(prompt: string, options?: Record<string, unknown>): Promise<string> {
  const generatorInstance = await loadGenerator();
  const response = await generatorInstance(prompt, {
    max_new_tokens: 200,
    ...(options ?? {}),
  });
  const first = Array.isArray(response) ? response[0] : null;
  const text = first && typeof first.generated_text === "string" ? first.generated_text : "";
  return text.trim();
}

export async function embedText(text: string): Promise<number[]> {
  if (!text.trim()) {
    return [];
  }
  const embedderInstance = await loadEmbedder();
  const output = await embedderInstance(text, { pooling: "mean", normalize: true });
  return toNumberArray(output);
}
