import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export interface RuntimeRemoteAIConfig {
  enabled: boolean;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  remoteOnly?: boolean;
}

export interface RuntimeAIConfig {
  enabled: boolean;
  autoInitialize: boolean;
  modelDirectory?: string;
  modelName?: string;
  modelPath?: string;
  remote: RuntimeRemoteAIConfig;
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
    remote: {
      enabled: false,
      baseUrl: "http://127.0.0.1:8000/v1/chat/completions",
      model: "mistralai/Mistral-7B-Instruct-v0.2",
      apiKey: "",
      timeoutMs: 20_000,
      remoteOnly: false,
    },
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
      remote: {
        ...DEFAULT_CONFIG.ai.remote,
        ...(fileConfig.ai?.remote ?? {}),
      } as RuntimeRemoteAIConfig,
    },
  };

  const envEnabled = process.env.ALEXANDRIA_AI_ENABLED;
  const envAutoInit = process.env.ALEXANDRIA_AI_AUTOINIT;
  const envModelDir = process.env.ALEXANDRIA_AI_MODEL_DIR;
  const envModelName = process.env.ALEXANDRIA_AI_MODEL_NAME;
  const envModelPath = process.env.ALEXANDRIA_AI_MODEL_PATH;
  const envRemoteEnabled = process.env.ALEXANDRIA_VLLM_ENABLED;
  const envRemoteBaseUrl = process.env.ALEXANDRIA_VLLM_BASE_URL;
  const envRemoteModel =
    process.env.ALEXANDRIA_VLLM_MODEL ?? process.env.ALEXANDRIA_VLLM_MODEL_NAME;
  const envRemoteApiKey = process.env.ALEXANDRIA_VLLM_API_KEY;
  const envRemoteTimeout = process.env.ALEXANDRIA_VLLM_TIMEOUT_MS;
  const envRemoteOnly = process.env.ALEXANDRIA_VLLM_REMOTE_ONLY;

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

  const remoteConfig = merged.ai.remote;
  remoteConfig.enabled = parseBoolean(envRemoteEnabled, remoteConfig.enabled);
  remoteConfig.remoteOnly = parseBoolean(envRemoteOnly, remoteConfig.remoteOnly ?? false);

  if (envRemoteBaseUrl && envRemoteBaseUrl.trim()) {
    remoteConfig.baseUrl = envRemoteBaseUrl.trim();
  }
  if (envRemoteModel && envRemoteModel.trim()) {
    remoteConfig.model = envRemoteModel.trim();
  }
  if (typeof envRemoteApiKey === "string") {
    remoteConfig.apiKey = envRemoteApiKey.trim();
  }
  if (envRemoteTimeout && envRemoteTimeout.trim()) {
    const parsedTimeout = Number.parseInt(envRemoteTimeout.trim(), 10);
    if (Number.isFinite(parsedTimeout) && parsedTimeout > 0) {
      remoteConfig.timeoutMs = parsedTimeout;
    }
  }

  return merged;
}
