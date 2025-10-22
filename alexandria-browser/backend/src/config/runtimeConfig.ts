import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export interface RuntimeAIConfig {
  enabled: boolean;
  autoInitialize: boolean;
  modelDirectory?: string;
  modelName?: string;
  modelPath?: string;
}

export interface RuntimeConfig {
  ai: RuntimeAIConfig;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  ai: {
    enabled: false,
    autoInitialize: false,
    modelDirectory: path.resolve(process.cwd(), "models"),
    modelName: "mistral-7b-instruct",
    modelPath: path.resolve(process.cwd(), "models/mistral-7b-instruct.gguf"),
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
  const envModelDir = process.env.ALEXANDRIA_AI_MODEL_DIR;
  const envModelName = process.env.ALEXANDRIA_AI_MODEL_NAME;
  const envModelPath = process.env.ALEXANDRIA_AI_MODEL_PATH;

  merged.ai.enabled = parseBoolean(envEnabled, merged.ai.enabled);
  merged.ai.autoInitialize = parseBoolean(envAutoInit, merged.ai.autoInitialize);

  if (envModelDir && envModelDir.trim()) {
    merged.ai.modelDirectory = envModelDir.trim();
  }
  if (envModelName && envModelName.trim()) {
    merged.ai.modelName = envModelName.trim();
  }
  if (envModelPath && envModelPath.trim()) {
    merged.ai.modelPath = envModelPath.trim();
  }

  return merged;
}
