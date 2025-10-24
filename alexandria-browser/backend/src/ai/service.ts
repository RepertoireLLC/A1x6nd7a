import { askAI, configureModels, embedText, initAI } from "../../ai/engine";
import { buildPrompt } from "../../ai/modeHandler";
import {
  buildNSFWPromptInstruction,
  normalizeUserSuppliedMode,
  shouldSuppressAIResponse,
  type NSFWUserMode,
} from "../utils/nsfwMode";

export type AIStatus = "idle" | "ready" | "error";

export interface AIOutcome {
  status: AIStatus;
  message?: string;
}

export interface AIConfiguration {
  enabled?: boolean;
  model?: string;
  embeddingModel?: string;
}

export type AIConversationRole = "user" | "assistant";

export interface AIConversationTurn {
  role: AIConversationRole;
  content: string;
  timestamp?: number;
}

export type AIRequestMode = "search" | "navigation" | "chat" | "document";

export interface AIContextDetails {
  activeQuery?: string;
  currentUrl?: string;
  documentTitle?: string;
  documentSummary?: string;
  navigationTrail?: string[];
  extraNotes?: string;
}

export interface AIContextRequest {
  mode: AIRequestMode;
  message: string;
  query?: string;
  context?: AIContextDetails;
  history?: AIConversationTurn[];
  nsfwMode?: NSFWUserMode;
}

export interface AIResponseOptions {
  nsfwMode?: NSFWUserMode;
}

let aiEnabled = true;
let initialized = false;
let configuredModel = "Xenova/distilgpt2";
let configuredEmbeddingModel = "Xenova/all-MiniLM-L6-v2";
let lastOutcome: AIOutcome = { status: "idle" };

function sanitize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripPrompt(prompt: string, output: string): string {
  if (!output) {
    return "";
  }
  if (output.startsWith(prompt)) {
    return output.slice(prompt.length).trim();
  }
  return output.trim();
}

function summarizeContext(request: AIContextRequest): string {
  const lines: string[] = [];
  if (request.context) {
    const { activeQuery, currentUrl, documentTitle, documentSummary, navigationTrail, extraNotes } = request.context;
    if (activeQuery) {
      lines.push(`Active query: ${activeQuery}`);
    }
    if (currentUrl) {
      lines.push(`Current URL: ${currentUrl}`);
    }
    if (documentTitle) {
      lines.push(`Document title: ${documentTitle}`);
    }
    if (documentSummary) {
      lines.push(`Summary: ${documentSummary}`);
    }
    if (navigationTrail && navigationTrail.length > 0) {
      lines.push(`Navigation trail: ${navigationTrail.join(" → ")}`);
    }
    if (extraNotes) {
      lines.push(`Notes: ${extraNotes}`);
    }
  }

  if (request.history && request.history.length > 0) {
    lines.push("Conversation history:");
    for (const turn of request.history.slice(-6)) {
      const role = turn.role === "assistant" ? "Assistant" : "User";
      lines.push(`${role}: ${turn.content}`);
    }
  }

  return lines.join("\n").trim();
}

function setOutcome(status: AIStatus, message?: string | null): AIOutcome {
  lastOutcome = message ? { status, message } : { status };
  return lastOutcome;
}

function applyConfiguration(): void {
  configureModels({ model: configuredModel, embeddingModel: configuredEmbeddingModel });
}

export function configureAI(config: AIConfiguration): AIOutcome {
  if (typeof config.enabled === "boolean") {
    aiEnabled = config.enabled;
  }
  if (config.model && config.model.trim()) {
    configuredModel = config.model.trim();
  }
  if (config.embeddingModel && config.embeddingModel.trim()) {
    configuredEmbeddingModel = config.embeddingModel.trim();
  }

  applyConfiguration();

  if (!aiEnabled) {
    initialized = false;
    return setOutcome("idle", "AI assistance is disabled by configuration.");
  }

  if (initialized && lastOutcome.status === "ready") {
    return lastOutcome;
  }

  return lastOutcome.status === "error" ? lastOutcome : setOutcome("idle");
}

export function getLastAIOutcome(): AIOutcome {
  return lastOutcome;
}

export function isAIEnabled(): boolean {
  return aiEnabled;
}

async function ensureReady(): Promise<boolean> {
  if (!aiEnabled) {
    setOutcome("idle", "AI assistance is disabled by configuration.");
    return false;
  }

  if (initialized && lastOutcome.status === "ready") {
    return true;
  }

  const outcome = await initializeAI();
  return outcome.status === "ready";
}

export async function initializeAI(): Promise<AIOutcome> {
  if (!aiEnabled) {
    initialized = false;
    return setOutcome("idle", "AI assistance is disabled by configuration.");
  }

  try {
    applyConfiguration();
    await initAI();
    initialized = true;
    return setOutcome("ready");
  } catch (error) {
    initialized = false;
    const message = error instanceof Error ? error.message : String(error);
    return setOutcome("error", message);
  }
}

export function getAIModelList(): string[] {
  return [configuredModel, configuredEmbeddingModel];
}

export function isAIReady(): boolean {
  return initialized && lastOutcome.status === "ready";
}

export async function generateAIResponse(
  message: string,
  options?: AIResponseOptions
): Promise<string | null> {
  const sanitizedMessage = sanitize(message);
  if (!sanitizedMessage) {
    return null;
  }

  const nsfwMode = normalizeUserSuppliedMode(options?.nsfwMode);

  if (!aiEnabled) {
    setOutcome("idle", "AI assistance is disabled by configuration.");
    return null;
  }

  const suppression = shouldSuppressAIResponse(sanitizedMessage, nsfwMode);
  if (suppression.suppressed) {
    setOutcome("ready", suppression.message ?? undefined);
    return suppression.message ?? null;
  }

  if (!(await ensureReady())) {
    return null;
  }

  try {
    const instruction = buildNSFWPromptInstruction(nsfwMode);
    const prompt = `${instruction}\n${buildPrompt(nsfwMode, sanitizedMessage)}`;
    const output = await askAI(prompt);
    const reply = stripPrompt(prompt, output);
    setOutcome("ready");
    return reply || output;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    setOutcome("error", messageText);
    return null;
  }
}

export async function generateContextualResponse(request: AIContextRequest): Promise<string | null> {
  if (!aiEnabled) {
    setOutcome("idle", "AI assistance is disabled by configuration.");
    return null;
  }

  const nsfwMode = normalizeUserSuppliedMode(request.nsfwMode);
  const baseMessage = sanitize(request.message);
  if (!baseMessage) {
    return null;
  }

  const suppression = shouldSuppressAIResponse(baseMessage, nsfwMode);
  if (suppression.suppressed) {
    setOutcome("ready", suppression.message ?? undefined);
    return suppression.message ?? null;
  }

  if (!(await ensureReady())) {
    return null;
  }

  const contextSummary = summarizeContext(request);
  const modeInstruction = buildNSFWPromptInstruction(nsfwMode);
  const modeLabel = `Mode: ${request.mode}`;
  const details = [modeInstruction, modeLabel];
  if (request.query) {
    details.push(`Related archive query: ${request.query}`);
  }
  if (contextSummary) {
    details.push(contextSummary);
  }

  const composedPrompt = `${details.join("\n")}\n${buildPrompt(nsfwMode, baseMessage)}`;

  try {
    const output = await askAI(composedPrompt);
    const reply = stripPrompt(composedPrompt, output);
    setOutcome("ready");
    return reply || output;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    setOutcome("error", messageText);
    return null;
  }
}

function normalizeRefinedQuery(candidate: string, original: string): string {
  const sanitized = sanitize(candidate);
  if (!sanitized) {
    return original;
  }

  const lines = sanitized.split(/\n+/);
  const firstLine = lines[0]?.trim() ?? "";
  if (!firstLine) {
    return original;
  }

  if (firstLine.length < 2) {
    return original;
  }

  return firstLine;
}

export async function refineSearchQuery(query: string, mode: NSFWUserMode): Promise<string> {
  const sanitizedQuery = sanitize(query);
  if (!sanitizedQuery || !aiEnabled) {
    return query;
  }

  const nsfwMode = normalizeUserSuppliedMode(mode);
  const suppression = shouldSuppressAIResponse(sanitizedQuery, nsfwMode);
  if (suppression.suppressed) {
    return query;
  }

  if (!(await ensureReady())) {
    return query;
  }

  const instructions = [
    "You assist with Internet Archive searches.",
    "Rewrite the user's query into a concise set of keywords optimized for the archive search API.",
    "Prefer proper nouns, titles, creators, and relevant years.",
    "Respond with keywords only; do not add commentary or explanations.",
  ];
  const prompt = `${buildNSFWPromptInstruction(nsfwMode)}\n${instructions.join(" ")}`;
  const refinedPrompt = `${prompt}\n${buildPrompt(nsfwMode, sanitizedQuery)}`;

  try {
    const output = await askAI(refinedPrompt, { max_new_tokens: 96 });
    const reply = stripPrompt(refinedPrompt, output);
    setOutcome("ready");
    return normalizeRefinedQuery(reply || output, sanitizedQuery);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    setOutcome("error", messageText);
    return query;
  }
}

export async function embedSearchText(text: string): Promise<number[]> {
  const sanitized = sanitize(text);
  if (!sanitized) {
    return [];
  }

  try {
    return await embedText(sanitized);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    setOutcome("error", messageText);
    return [];
  }
}
