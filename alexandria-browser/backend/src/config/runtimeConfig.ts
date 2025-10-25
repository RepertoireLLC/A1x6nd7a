import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export interface RuntimeAIConfig {
  enabled: boolean;
  autoInitialize: boolean;
  model: string;
  embeddingModel: string;
}

export interface RuntimeConfig {
  ai: RuntimeAIConfig;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  ai: {
    enabled: true,
    autoInitialize: false,
    model: "Xenova/distilgpt2",
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
  },
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function loadConfigFile(): Partial<RuntimeConfig> {
  const configDir = path.resolve(process.cwd(), "config");
  const defaultPath = path.join(configDir, "default.json");
  if (!existsSync(defaultPath)) {
    return {};
  }

  try {
    const contents = readFileSync(defaultPath, "utf8");
    return JSON.parse(contents) as Partial<RuntimeConfig>;
  } catch (error) {
    console.warn("Failed to parse Alexandria backend config", error);
    return {};
  }
}

export function loadRuntimeConfig(): RuntimeConfig {
  const fileConfig = loadConfigFile();
  const merged: RuntimeConfig = {
    ai: {
      ...DEFAULT_CONFIG.ai,
      ...fileConfig.ai,
    },
  };

  const envEnabled = process.env.ALEXANDRIA_AI_ENABLED;
  const envAutoInit = process.env.ALEXANDRIA_AI_AUTOINIT;
  const envModelName = process.env.ALEXANDRIA_AI_MODEL_NAME ?? process.env.ALEXANDRIA_AI_MODEL;
  const envEmbeddingModel = process.env.ALEXANDRIA_AI_EMBEDDING_MODEL;

  merged.ai.enabled = parseBoolean(envEnabled, merged.ai.enabled);
  merged.ai.autoInitialize = parseBoolean(envAutoInit, merged.ai.autoInitialize);

  if (envModelName && envModelName.trim()) {
    merged.ai.model = envModelName.trim();
  }
  if (envEmbeddingModel && envEmbeddingModel.trim()) {
    merged.ai.embeddingModel = envEmbeddingModel.trim();
  }

  return merged;
}
