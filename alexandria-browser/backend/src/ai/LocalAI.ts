import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import type { LlamaChatSession, LlamaContext, LlamaModel } from "node-llama-cpp";
import aiConfig from "../../config/ai.json" assert { type: "json" };

type NodeLlamaCppModule = typeof import("node-llama-cpp");

import {
  buildNSFWPromptInstruction,
  normalizeUserSuppliedMode,
  shouldSuppressAIResponse,
  type NSFWUserMode,
} from "../utils/nsfwMode";

export type LocalAIOutcomeStatus =
  | "idle"
  | "success"
  | "missing-model"
  | "error"
  | "disabled"
  | "blocked";

export interface LocalAIOutcome {
  status: LocalAIOutcomeStatus;
  message?: string;
  modelPath?: string | null;
}

export interface LocalAIConfiguration {
  enabled?: boolean;
  modelDirectory?: string;
  modelPath?: string;
  modelName?: string;
}

export interface LocalAIModelInventory {
  modelDirectory: string;
  modelPaths: string[];
  directoryAccessible: boolean;
  directoryError?: string;
}

export type LocalAIConversationRole = "user" | "assistant";

export interface LocalAIConversationTurn {
  role: LocalAIConversationRole;
  content: string;
}

export type LocalAIRequestMode = "search" | "navigation" | "chat" | "document";

export interface LocalAIContextRequest {
  mode: LocalAIRequestMode;
  message: string;
  query?: string;
  context?: {
    activeQuery?: string;
    currentUrl?: string;
    documentTitle?: string;
    documentSummary?: string;
    navigationTrail?: string[];
    extraNotes?: string;
  };
  history?: LocalAIConversationTurn[];
  nsfwMode?: string;
}

export interface LocalAIResponseOptions {
  nsfwMode?: string;
}

interface LlamaResources {
  model: LlamaModel;
  context: LlamaContext;
  session: LlamaChatSession;
}

const MODEL_EXTENSIONS = new Set([".gguf"]);

// Static defaults loaded from config/ai.json to keep the Mistral model optional.
const STATIC_CONFIG_ENABLED =
  typeof aiConfig.aiEnabled === "boolean" ? aiConfig.aiEnabled : undefined;
const STATIC_CONFIG_MODEL_PATH =
  typeof aiConfig.modelPath === "string" ? aiConfig.modelPath : "";
const STATIC_CONFIG_MODEL_NAME =
  typeof aiConfig.defaultModel === "string" ? aiConfig.defaultModel : "";

const ENV_MODEL_DIR = process.env.ALEXANDRIA_AI_MODEL_DIR?.trim() || "";
const ENV_MODEL_PATH = process.env.ALEXANDRIA_AI_MODEL_PATH?.trim() || "";
const ENV_MODEL_NAME = process.env.ALEXANDRIA_AI_MODEL?.trim() || "";
const ENV_DISABLE_LOCAL_AI =
  process.env.ALEXANDRIA_DISABLE_LOCAL_AI?.trim().toLowerCase() === "true" ||
  process.env.ALEXANDRIA_LOCAL_AI_DISABLED?.trim().toLowerCase() === "true";

const DEFAULT_MODEL_DIR = path.resolve(process.cwd(), "models");

let llamaModule: NodeLlamaCppModule | null = null;
let llamaModuleError: Error | null = null;
let llamaModulePromise: Promise<NodeLlamaCppModule | null> | null = null;

function resolveModelPath(candidate: string | undefined | null): string {
  if (!candidate) {
    return "";
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return "";
  }

  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(process.cwd(), trimmed);
}

function resolveDirectoryWithFallback(dir: string | undefined | null, fallback: string): string {
  if (!dir) {
    return fallback;
  }

  const trimmed = dir.trim();
  if (!trimmed) {
    return fallback;
  }

  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(process.cwd(), trimmed);
}

const CONFIG_MODEL_PATH_ABSOLUTE = resolveModelPath(STATIC_CONFIG_MODEL_PATH);
const CONFIG_MODEL_DIRECTORY = CONFIG_MODEL_PATH_ABSOLUTE
  ? path.dirname(CONFIG_MODEL_PATH_ABSOLUTE)
  : DEFAULT_MODEL_DIR;

let configuredEnabled: boolean | null =
  typeof STATIC_CONFIG_ENABLED === "boolean" ? STATIC_CONFIG_ENABLED : null;
let configuredModelDir = resolveDirectoryWithFallback(
  ENV_MODEL_DIR || undefined,
  CONFIG_MODEL_DIRECTORY
);
let configuredModelPath = ENV_MODEL_PATH
  ? resolveModelPath(ENV_MODEL_PATH)
  : CONFIG_MODEL_PATH_ABSOLUTE;
let configuredModelName = ENV_MODEL_NAME || STATIC_CONFIG_MODEL_NAME;

// Cached instance of the Mistral model so repeated prompts reuse the same session.
let cachedResources: LlamaResources | null = null;
let modelReady = false;
let loadPromise: Promise<LlamaResources | null> | null = null;
let lastOutcome: LocalAIOutcome = { status: isAIGloballyEnabled() ? "idle" : "disabled" };
let lastModelPath: string | null = null;
let activeInference: Promise<void> | null = null;

function isAIGloballyEnabled(): boolean {
  if (ENV_DISABLE_LOCAL_AI) {
    return false;
  }
  if (typeof configuredEnabled === "boolean") {
    return configuredEnabled;
  }
  return true;
}

function markDisabled(message?: string) {
  lastOutcome = {
    status: "disabled",
    message: message ?? "Local AI is currently disabled by configuration.",
    modelPath: null
  };
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK | constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadLlamaRuntime(): Promise<NodeLlamaCppModule | null> {
  if (llamaModule) {
    return llamaModule;
  }

  if (llamaModulePromise) {
    return llamaModulePromise;
  }

  llamaModulePromise = (async () => {
    try {
      const module = await import("node-llama-cpp");
      llamaModule = module;
      llamaModuleError = null;
      return module;
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      llamaModule = null;
      llamaModuleError = resolvedError;
      console.warn(
        "⚠ Mistral runtime unavailable. Failed to load node-llama-cpp native bindings.",
        resolvedError
      );
      const baseMessage =
        "Local AI runtime failed to load. Install node-llama-cpp native bindings to enable offline AI.";
      const details = resolvedError.message?.trim();
      lastOutcome = {
        status: "error",
        message: details ? `${baseMessage} (Reason: ${details})` : baseMessage,
        modelPath: null,
      };
      return null;
    } finally {
      llamaModulePromise = null;
    }
  })();

  return llamaModulePromise;
}

async function safeDispose(
  resource: { dispose: () => Promise<void> | void } | null | undefined,
  label: string
): Promise<void> {
  if (!resource) {
    return;
  }

  try {
    await Promise.resolve(resource.dispose());
  } catch (error) {
    console.warn(`Failed to dispose ${label}`, error);
  }
}

interface ModelCandidateCollection {
  candidates: string[];
  directoryError?: Error | null;
}

async function collectModelCandidates(): Promise<ModelCandidateCollection> {
  const unique = new Set<string>();
  const candidates: string[] = [];

  const pushCandidate = async (candidatePath: string | null | undefined) => {
    if (!candidatePath) {
      return;
    }

    const normalized = path.isAbsolute(candidatePath)
      ? path.normalize(candidatePath)
      : path.resolve(configuredModelDir, candidatePath);

    if (unique.has(normalized)) {
      return;
    }

    if (await fileExists(normalized)) {
      unique.add(normalized);
      candidates.push(normalized);
    }
  };

  await pushCandidate(configuredModelPath);
  await pushCandidate(configuredModelName);

  let directoryError: Error | null = null;

  try {
    const entries = await readdir(configuredModelDir, { withFileTypes: true });
    const sortedEntries = entries
      .filter((entry) => entry.isFile())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of sortedEntries) {
      const extension = path.extname(entry.name).toLowerCase();
      if (!MODEL_EXTENSIONS.has(extension)) {
        continue;
      }

      const candidatePath = path.join(configuredModelDir, entry.name);
      if (unique.has(candidatePath)) {
        continue;
      }
      if (await fileExists(candidatePath)) {
        unique.add(candidatePath);
        candidates.push(candidatePath);
      }
    }
  } catch (error) {
    directoryError = error instanceof Error ? error : new Error(String(error));
  }

  return { candidates, directoryError };
}

async function findModelFile(): Promise<string | null> {
  const { candidates, directoryError } = await collectModelCandidates();

  if (candidates.length > 0) {
    return candidates[0];
  }

  if (directoryError) {
    lastOutcome = {
      status: "missing-model",
      message:
        directoryError instanceof Error
          ? `Unable to inspect model directory: ${directoryError.message}`
          : "Unable to inspect model directory for local AI model.",
    };
  }

  return null;
}

function sanitizeDirectory(dir: string | undefined): string {
  return resolveDirectoryWithFallback(dir, configuredModelDir);
}

export function configureLocalAI(options: LocalAIConfiguration): LocalAIOutcome {
  if (typeof options.enabled === "boolean") {
    configuredEnabled = options.enabled;
    if (!isAIGloballyEnabled()) {
      markDisabled(options.enabled ? undefined : "Local AI disabled by configuration.");
    }
  }

  if (typeof options.modelDirectory === "string") {
    configuredModelDir = sanitizeDirectory(options.modelDirectory);
  }

  if (typeof options.modelPath === "string") {
    const resolved = resolveModelPath(options.modelPath);
    configuredModelPath = resolved || options.modelPath.trim();
  }

  if (typeof options.modelName === "string") {
    configuredModelName = options.modelName.trim();
  }

  resetLocalAIState();
  return getLastAIOutcome();
}

async function loadModel(): Promise<LlamaResources | null> {
  if (!isAIGloballyEnabled()) {
    markDisabled();
    return null;
  }

  if (cachedResources && modelReady) {
    return cachedResources;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const modelFile = await findModelFile();
    if (!modelFile) {
      lastOutcome = {
        status: "missing-model",
        message: "No compatible local AI model was found in the configured models directory.",
      };
      console.warn(
        "⚠ Mistral model not loaded. AI disabled. No compatible local AI model was found in the configured models directory."
      );
      return null;
    }

    const resolvedPath = path.isAbsolute(modelFile)
      ? modelFile
      : path.resolve(configuredModelDir, modelFile);

    try {
      const runtime = await loadLlamaRuntime();
      if (!runtime) {
        cachedResources = null;
        modelReady = false;
        lastModelPath = null;
        if (llamaModuleError) {
          const baseMessage =
            "Local AI runtime failed to load. Install node-llama-cpp native bindings to enable offline AI.";
          const details = llamaModuleError.message?.trim();
          lastOutcome = {
            status: "error",
            message: details ? `${baseMessage} (Reason: ${details})` : baseMessage,
            modelPath: null,
          };
        }
        return null;
      }

      const {
        LlamaModel: RuntimeModel,
        LlamaContext: RuntimeContext,
        LlamaChatSession: RuntimeChatSession,
      } = runtime;

      let modelInstance: LlamaModel | null = null;
      let contextInstance: LlamaContext | null = null;
      let sessionInstance: LlamaChatSession | null = null;

      try {
        modelInstance = new RuntimeModel({ modelPath: resolvedPath });
        contextInstance = new RuntimeContext({ model: modelInstance });
        sessionInstance = new RuntimeChatSession({ context: contextInstance });
      } catch (initializationError) {
        await safeDispose(sessionInstance, "local AI chat session");
        await safeDispose(contextInstance, "local AI context");
        await safeDispose(modelInstance, "local AI model");
        throw initializationError;
      }

      if (!modelInstance || !contextInstance || !sessionInstance) {
        lastOutcome = {
          status: "error",
          message: "Failed to initialize the local AI model.",
          modelPath: resolvedPath,
        };
        cachedResources = null;
        modelReady = false;
        lastModelPath = null;
        return null;
      }

      cachedResources = {
        model: modelInstance,
        context: contextInstance,
        session: sessionInstance,
      };
      modelReady = true;
      lastModelPath = resolvedPath;
      lastOutcome = { status: "idle", modelPath: resolvedPath };
      return cachedResources;
    } catch (error) {
      console.warn("⚠ Mistral model not loaded. AI disabled.", error);
      const message =
        error instanceof Error ? error.message : "Failed to initialize the local AI model.";
      lastOutcome = { status: "error", message, modelPath: resolvedPath };
      cachedResources = null;
      modelReady = false;
      lastModelPath = null;
      return null;
    }
  })();

  const resources = await loadPromise;
  loadPromise = null;
  return resources;
}

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  while (activeInference) {
    await activeInference.catch(() => undefined);
  }

  let release: () => void = () => {};
  activeInference = new Promise<void>((resolve) => {
    release = () => resolve();
  });

  try {
    const result = await operation();
    return result;
  } finally {
    release();
    activeInference = null;
  }
}

function buildPrompt(query: string, mode: NSFWUserMode): string {
  const trimmed = query.trim();
  const nsfwSummary =
    `NSFW mode is ${mode}. ` +
    "If safe: avoid explicit content. " +
    "If moderate: no graphic details. " +
    "If unrestricted: all allowed within legal boundaries. " +
    "If only-nsfw: focus only on adult-tagged archive materials.";
  const guidance = buildNSFWPromptInstruction(mode);
  return (
    "You are Alexandria, an offline research assistant for the Internet Archive. " +
    nsfwSummary +
    " " +
    guidance +
    "\n" +
    "The user searched for the following terms: \"" +
    trimmed.replace(/\s+/g, " ") +
    "\". " +
    "Provide a concise analysis to help them refine the search. " +
    "Respond with three short sections separated by blank lines: " +
    "1) A one-sentence interpretation of the query and what kinds of materials they might want. " +
    "2) Three bullet points suggesting improved or related keywords. " +
    "3) One sentence pointing to notable Internet Archive collections or media types that could help. " +
    "Keep the entire response under 120 words, avoid markdown headings, and do not fabricate availability."
  );
}

export async function generateAIResponse(
  query: string,
  options?: LocalAIResponseOptions
): Promise<string | null> {
  const sanitized = query.trim();
  if (!sanitized) {
    lastOutcome = { status: "error", message: "Cannot generate an AI response for an empty query." };
    return null;
  }

  const nsfwMode = normalizeUserSuppliedMode(options?.nsfwMode);
  const suppression = shouldSuppressAIResponse(sanitized, nsfwMode);
  if (suppression.suppressed) {
    lastOutcome = {
      status: "blocked",
      message: suppression.message ?? "AI suggestions are hidden due to the current NSFW mode.",
      modelPath: lastModelPath,
    };
    return null;
  }

  if (!isAIGloballyEnabled()) {
    markDisabled();
    return null;
  }

  try {
    const resources = await loadModel();
    if (!resources) {
      if (lastOutcome.status === "idle") {
        lastOutcome = {
          status: "missing-model",
          message: "No local AI model is available for use.",
        };
      }
      return null;
    }

    const response = await runExclusive(async () => {
      const prompt = buildPrompt(sanitized, nsfwMode);
      const raw = await resources.session.prompt(prompt);
      return typeof raw === "string" ? raw.trim() : "";
    });

    if (!response) {
      lastOutcome = {
        status: "error",
        message: "The local AI model returned an empty response.",
        modelPath: lastModelPath,
      };
      return null;
    }

    lastOutcome = { status: "success", modelPath: lastModelPath };
    return response;
  } catch (error) {
    console.warn("Local AI response generation failed", error);
    lastOutcome = {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to generate a response from the local AI model.",
      modelPath: lastModelPath,
    };
    return null;
  }
}

function coerceHistory(history: LocalAIConversationTurn[] | undefined): LocalAIConversationTurn[] {
  if (!history || history.length === 0) {
    return [];
  }

  return history
    .filter((turn) => Boolean(turn) && typeof turn.content === "string" && turn.content.trim())
    .map<LocalAIConversationTurn>((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content.trim(),
    }))
    .slice(-6);
}

function buildContextualPrompt(request: LocalAIContextRequest, mode: NSFWUserMode): string {
  const lines: string[] = [];
  const { mode: requestMode, message, context, query } = request;
  const trimmedMessage = message.trim();
  const normalizedHistory = coerceHistory(request.history);

  lines.push(
    "You are Alexandria, an offline research guide who helps people navigate the Internet Archive and related open collections."
  );

  lines.push(
    `NSFW mode is ${mode}. If safe: avoid explicit content. If moderate: no graphic details. If unrestricted: all allowed within legal boundaries. If only-nsfw: focus only on adult-tagged archive materials.`
  );
  lines.push(buildNSFWPromptInstruction(mode));

  switch (requestMode) {
    case "navigation":
      lines.push(
        "Offer two or three concise next steps to explore, based on the current topic. Mention relevant Archive collections or search refinements without fabricating unavailable items."
      );
      break;
    case "document":
      lines.push(
        "Summarize the document briefly and suggest how it could support the research topic. Provide at most one follow-up recommendation."
      );
      break;
    case "chat":
      lines.push(
        "Answer the user's research question directly and cite types of Archive materials that could help. Keep responses under 150 words."
      );
      break;
    default:
      lines.push("Help refine the search topic with practical tips that can be executed offline.");
      break;
  }

  if (query && query.trim()) {
    lines.push(`Original search query: "${query.trim()}".`);
  }

  if (context) {
    const contextLines: string[] = [];
    if (context.activeQuery && context.activeQuery.trim()) {
      contextLines.push(`Active query: ${context.activeQuery.trim()}`);
    }
    if (context.currentUrl && context.currentUrl.trim()) {
      contextLines.push(`Current page: ${context.currentUrl.trim()}`);
    }
    if (context.navigationTrail && context.navigationTrail.length > 0) {
      contextLines.push(`Recent navigation: ${context.navigationTrail.slice(-5).join(" → ")}`);
    }
    if (context.documentTitle && context.documentTitle.trim()) {
      contextLines.push(`Document title: ${context.documentTitle.trim()}`);
    }
    if (context.documentSummary && context.documentSummary.trim()) {
      contextLines.push(`Document summary: ${context.documentSummary.trim()}`);
    }
    if (context.extraNotes && context.extraNotes.trim()) {
      contextLines.push(context.extraNotes.trim());
    }
    if (contextLines.length > 0) {
      lines.push("Context:" + "\n" + contextLines.join("\n"));
    }
  }

  if (normalizedHistory.length > 0) {
    const historyLines = normalizedHistory.map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.content}`);
    lines.push("Conversation so far:\n" + historyLines.join("\n"));
  }

  lines.push(`User request: ${trimmedMessage}`);
  lines.push("Respond clearly, using plain text without markdown headings.");

  return lines.join("\n\n");
}

export async function generateContextualResponse(request: LocalAIContextRequest): Promise<string | null> {
  const sanitizedMessage = request.message.trim();
  if (!sanitizedMessage) {
    lastOutcome = { status: "error", message: "Cannot generate an AI response for an empty prompt." };
    return null;
  }

  const nsfwMode = normalizeUserSuppliedMode(request.nsfwMode);
  const combined = [sanitizedMessage, request.query ?? ""].join(" ").trim();
  const suppression = shouldSuppressAIResponse(combined, nsfwMode);
  if (suppression.suppressed) {
    lastOutcome = {
      status: "blocked",
      message: suppression.message ?? "AI suggestions are hidden due to the current NSFW mode.",
      modelPath: lastModelPath,
    };
    return null;
  }

  if (!isAIGloballyEnabled()) {
    markDisabled();
    return null;
  }

  try {
    const resources = await loadModel();
    if (!resources) {
      if (lastOutcome.status === "idle") {
        lastOutcome = {
          status: "missing-model",
          message: "No local AI model is available for contextual prompts.",
        };
      }
      return null;
    }

    const response = await runExclusive(async () => {
      const prompt = buildContextualPrompt({ ...request, message: sanitizedMessage }, nsfwMode);
      const raw = await resources.session.prompt(prompt);
      return typeof raw === "string" ? raw.trim() : "";
    });

    if (!response) {
      lastOutcome = {
        status: "error",
        message: "The local AI model returned an empty response.",
        modelPath: lastModelPath,
      };
      return null;
    }

    lastOutcome = { status: "success", modelPath: lastModelPath };
    return response;
  } catch (error) {
    console.warn("Local AI contextual response failed", error);
    lastOutcome = {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to generate contextual AI response.",
      modelPath: lastModelPath,
    };
    return null;
  }
}

export async function initializeLocalAI(): Promise<LocalAIOutcome> {
  if (!isAIGloballyEnabled()) {
    markDisabled();
    return getLastAIOutcome();
  }

  try {
    await loadModel();
  } catch (error) {
    console.warn("Local AI initialization failed", error);
  }

  return getLastAIOutcome();
}

export async function initLocalAI(): Promise<LocalAIOutcome> {
  // Alias kept for compatibility with lightweight integration guides.
  return initializeLocalAI();
}

export function getLastAIOutcome(): LocalAIOutcome {
  return lastOutcome;
}

export function resetLocalAIState(): void {
  if (cachedResources) {
    void safeDispose(cachedResources.session, "local AI chat session");
    void safeDispose(cachedResources.context, "local AI context");
    void safeDispose(cachedResources.model, "local AI model");
  }
  cachedResources = null;
  modelReady = false;
  loadPromise = null;
  lastModelPath = null;
  lastOutcome = { status: isAIGloballyEnabled() ? "idle" : "disabled" };
}

export async function listAvailableLocalAIModels(): Promise<LocalAIModelInventory> {
  const { candidates, directoryError } = await collectModelCandidates();
  return {
    modelDirectory: configuredModelDir,
    modelPaths: candidates,
    directoryAccessible: !directoryError,
    directoryError: directoryError?.message,
  };
}

export function isLocalAIEnabled(): boolean {
  return isAIGloballyEnabled();
}
