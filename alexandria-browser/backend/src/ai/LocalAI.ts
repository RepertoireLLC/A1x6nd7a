import { askAI, configureModels, embedText, initAI } from "../../ai/engine";
import { buildPrompt } from "../../ai/modeHandler";
import {
  buildNSFWPromptInstruction,
  normalizeUserSuppliedMode,
  shouldSuppressAIResponse,
  type NSFWUserMode,
} from "../utils/nsfwMode";

export type LocalAIOutcomeStatus = "idle" | "ready" | "success" | "error" | "disabled";

export interface LocalAIOutcome {
  status: LocalAIOutcomeStatus;
  message?: string | null;
  model?: string;
}

export interface LocalAIConfiguration {
  enabled?: boolean;
  model?: string;
  embeddingModel?: string;
}

export interface LocalAIModelInventory {
  modelDirectory: string;
  modelPaths: string[];
  directoryAccessible: boolean;
  directoryError?: string | null;
}

export type LocalAIConversationRole = "user" | "assistant";

export interface LocalAIConversationTurn {
  role: LocalAIConversationRole;
  content: string;
  timestamp?: number;
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
  nsfwMode?: NSFWUserMode;
}

export interface LocalAIResponseOptions {
  nsfwMode?: NSFWUserMode;
}

let aiEnabled = true;
let initialized = false;
let configuredModel = "Xenova/distilgpt2";
let configuredEmbeddingModel = "Xenova/all-MiniLM-L6-v2";
let lastOutcome: LocalAIOutcome = { status: "idle", model: configuredModel };

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

// Normalize text for safe regex construction when filtering generated output.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removePromptArtifacts(
  text: string,
  prompt: string,
  userMessage: string,
  extraDirectives: string[] = []
): string {
  let output = text;
  const patterns: RegExp[] = [];

  const promptPattern = new RegExp(`^${escapeRegExp(prompt)}\s*`, "i");
  patterns.push(promptPattern);

  if (userMessage) {
    patterns.push(new RegExp(`^${escapeRegExp(userMessage)}\s*`, "i"));
    patterns.push(new RegExp(`^User:\s*${escapeRegExp(userMessage)}\s*`, "i"));
  }

  for (const directive of extraDirectives) {
    if (directive.trim()) {
      patterns.push(new RegExp(`^${escapeRegExp(directive.trim())}\s*`, "i"));
    }
  }

  for (const pattern of patterns) {
    output = output.replace(pattern, "");
  }

  output = output
    .replace(/^User:\s*.+$/gim, "")
    .replace(/^AI:\s*/gim, "")
    .replace(/\s+AI:\s*$/i, "")
    .trim();

  return output;
}

// Collapse obvious repetition that lightweight local models sometimes emit
// (e.g. repeating the same instruction or sentence across adjacent lines).
function collapseRepeatedLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const cleaned: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (cleaned.length === 0 || cleaned[cleaned.length - 1] !== line) {
      cleaned.push(line);
    }
  }

  return cleaned.join("\n");
}

// Ensure the final AI response omits prompt echoes and redundant fragments so
// the UI does not display repetitive instructions in place of a real answer.
function finalizeAIOutput(
  rawOutput: string,
  prompt: string,
  userMessage: string,
  directives: string[]
): string {
  const withoutArtifacts = removePromptArtifacts(rawOutput, prompt, userMessage, directives);
  const collapsed = collapseRepeatedLines(withoutArtifacts);
  return collapsed.trim();
}

// Graceful message returned when the local model only echoes the prompt so the
// assistant still provides a helpful response instead of blank output.
const AI_FALLBACK_MESSAGE =
  "I'm still getting warmed up. Please rephrase your request or try again in a moment.";

function summarizeContext(request: LocalAIContextRequest): string {
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

function recordOutcome(outcome: LocalAIOutcome): LocalAIOutcome {
  lastOutcome = outcome;
  return outcome;
}

export function configureLocalAI(config: LocalAIConfiguration): LocalAIOutcome {
  if (typeof config.enabled === "boolean") {
    aiEnabled = config.enabled;
  }

  if (config.model && config.model.trim()) {
    configuredModel = config.model.trim();
  }
  if (config.embeddingModel && config.embeddingModel.trim()) {
    configuredEmbeddingModel = config.embeddingModel.trim();
  }

  configureModels({ model: configuredModel, embeddingModel: configuredEmbeddingModel });

  if (!aiEnabled) {
    return recordOutcome({ status: "disabled", message: "AI assistance disabled", model: configuredModel });
  }

  return recordOutcome({ status: initialized ? "ready" : "idle", model: configuredModel });
}

export function getLastAIOutcome(): LocalAIOutcome {
  return lastOutcome;
}

export function isLocalAIEnabled(): boolean {
  return aiEnabled;
}

export async function initializeLocalAI(): Promise<LocalAIOutcome> {
  if (!aiEnabled) {
    return recordOutcome({ status: "disabled", message: "AI assistance disabled", model: configuredModel });
  }

  try {
    configureModels({ model: configuredModel, embeddingModel: configuredEmbeddingModel });
    await initAI();
    initialized = true;
    return recordOutcome({ status: "ready", model: configuredModel });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return recordOutcome({ status: "error", message, model: configuredModel });
  }
}

export async function initLocalAI(): Promise<LocalAIOutcome> {
  return initializeLocalAI();
}

export async function listAvailableLocalAIModels(): Promise<LocalAIModelInventory> {
  return {
    modelDirectory: "virtual-cache",
    modelPaths: [configuredModel, configuredEmbeddingModel],
    directoryAccessible: true,
    directoryError: null,
  };
}

export async function generateAIResponse(
  message: string,
  options?: LocalAIResponseOptions
): Promise<string | null> {
  const sanitizedMessage = sanitize(message);
  if (!sanitizedMessage) {
    return null;
  }

  const nsfwMode = normalizeUserSuppliedMode(options?.nsfwMode);
  if (!aiEnabled) {
    return null;
  }

  const suppression = shouldSuppressAIResponse(sanitizedMessage, nsfwMode);
  if (suppression.suppressed) {
    recordOutcome({ status: "success", model: configuredModel, message: suppression.message ?? null });
    return suppression.message ?? null;
  }

  try {
    if (!initialized) {
      await initializeLocalAI();
    }
    const instruction = buildNSFWPromptInstruction(nsfwMode);
    const prompt = `${instruction}\n${buildPrompt(nsfwMode, sanitizedMessage)}`;
    const output = await askAI(prompt);
    const reply = stripPrompt(prompt, output);
    const cleaned = finalizeAIOutput(reply || output, prompt, sanitizedMessage, [instruction]);
    const finalMessage = cleaned || AI_FALLBACK_MESSAGE;
    recordOutcome({ status: "success", model: configuredModel, message: cleaned ? undefined : finalMessage });
    return finalMessage;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    recordOutcome({ status: "error", message: messageText, model: configuredModel });
    return null;
  }
}

export async function generateContextualResponse(request: LocalAIContextRequest): Promise<string | null> {
  if (!aiEnabled) {
    return null;
  }

  const nsfwMode = normalizeUserSuppliedMode(request.nsfwMode);
  const baseMessage = sanitize(request.message);
  if (!baseMessage) {
    return null;
  }

  const suppression = shouldSuppressAIResponse(baseMessage, nsfwMode);
  if (suppression.suppressed) {
    recordOutcome({ status: "success", model: configuredModel, message: suppression.message ?? null });
    return suppression.message ?? null;
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
    if (!initialized) {
      await initializeLocalAI();
    }
    const output = await askAI(composedPrompt);
    const reply = stripPrompt(composedPrompt, output);
    const cleaned = finalizeAIOutput(reply || output, composedPrompt, baseMessage, [modeInstruction, modeLabel]);
    const finalMessage = cleaned || AI_FALLBACK_MESSAGE;
    recordOutcome({ status: "success", model: configuredModel, message: cleaned ? undefined : finalMessage });
    return finalMessage;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    recordOutcome({ status: "error", message: messageText, model: configuredModel });
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

  const instructions = [
    "You assist with Internet Archive searches.",
    "Rewrite the user's query into a concise set of keywords optimized for the archive search API.",
    "Prefer proper nouns, titles, creators, and relevant years.",
    "Respond with keywords only; do not add commentary or explanations.",
  ];
  const prompt = `${buildNSFWPromptInstruction(nsfwMode)}\n${instructions.join(" ")}`;
  const refinedPrompt = `${prompt}\n${buildPrompt(nsfwMode, sanitizedQuery)}`;

  try {
    if (!initialized) {
      await initializeLocalAI();
    }
    const output = await askAI(refinedPrompt, { max_new_tokens: 96 });
    const reply = stripPrompt(refinedPrompt, output);
    return normalizeRefinedQuery(reply || output, sanitizedQuery);
  } catch {
    return query;
  }
}

export async function embedSearchText(text: string): Promise<number[]> {
  return embedText(text);
}
