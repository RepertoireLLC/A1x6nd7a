import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import {
  buildNSFWPromptInstruction,
  normalizeUserSuppliedMode,
  shouldSuppressAIResponse,
  type NSFWUserMode,
} from "../utils/nsfwMode";
import { applyDefaultOnnxLogSettings } from "./onnxLogging";

applyDefaultOnnxLogSettings();

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

export interface LocalAISearchInsights {
  summary: string;
  interpretation: string | null;
  keywords: string[];
  refinedQuery: string | null;
  collectionHint: string | null;
}

interface GPT4AllInstance {
  init: () => Promise<void>;
  open: () => Promise<void>;
  prompt: (prompt: string, options?: Record<string, unknown>) => Promise<string>;
  close?: () => Promise<void>;
}

type GPT4AllConstructor = new (modelName: string, options?: Record<string, unknown>) => GPT4AllInstance;

const MODEL_EXTENSIONS = new Set([".bin", ".gguf", ".ggml"]);
const DEFAULT_PROMPT_OPTIONS = {
  temp: 0.25,
  topK: 40,
  topP: 0.9,
  minP: 0.05,
  maxTokens: 320,
  repeatPenalty: 1.05,
  repeatLastN: 256
};

const SECTION_SPLIT_PATTERN = /\r?\n\s*\r?\n/;
const BULLET_PREFIX_PATTERN = /^\s*(?:[-*•\u2022]|\d{1,2}[.)])\s*/;
const KEYWORD_SPLIT_PATTERN = /[,;•·]+/;
const DIRECTIVE_PREFIX_PATTERN = /^(?:try|consider|explore|search(?:\s+for)?|look(?:\s+(?:for|into))?|focus(?:\s+on)?|use|add|include|combine|apply|refine|investigate|review|check)\s+/i;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isLikelyRefinedQuery(candidate: string): boolean {
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8) {
    return false;
  }
  return candidate.length <= 120;
}

const ENV_MODEL_DIR = process.env.ALEXANDRIA_AI_MODEL_DIR?.trim() || "";
const ENV_MODEL_PATH = process.env.ALEXANDRIA_AI_MODEL_PATH?.trim() || "";
const ENV_MODEL_NAME = process.env.ALEXANDRIA_AI_MODEL?.trim() || "";
const ENV_DISABLE_LOCAL_AI =
  process.env.ALEXANDRIA_DISABLE_LOCAL_AI?.trim().toLowerCase() === "true" ||
  process.env.ALEXANDRIA_LOCAL_AI_DISABLED?.trim().toLowerCase() === "true";

let configuredEnabled: boolean | null = null;
let configuredModelDir = ENV_MODEL_DIR || path.resolve(process.cwd(), "models");
let configuredModelPath = ENV_MODEL_PATH;
let configuredModelName = ENV_MODEL_NAME;

let cachedModel: GPT4AllInstance | null = null;
let modelReady = false;
let loadPromise: Promise<GPT4AllInstance | null> | null = null;
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

async function findModelFile(): Promise<string | null> {
  if (configuredModelPath) {
    const resolvedPath = path.isAbsolute(configuredModelPath)
      ? configuredModelPath
      : path.resolve(configuredModelDir, configuredModelPath);
    if (await fileExists(resolvedPath)) {
      return resolvedPath;
    }
  }

  if (configuredModelName) {
    const candidate = path.resolve(configuredModelDir, configuredModelName);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  try {
    const entries = await readdir(configuredModelDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (MODEL_EXTENSIONS.has(extension)) {
        return path.join(configuredModelDir, entry.name);
      }
    }
  } catch (error) {
    lastOutcome = {
      status: "missing-model",
      message:
        error instanceof Error
          ? `Unable to inspect model directory: ${error.message}`
          : "Unable to inspect model directory for local AI model.",
    };
    return null;
  }

  return null;
}

function resolveGpt4AllConstructor(module: unknown): GPT4AllConstructor | null {
  if (!module || typeof module !== "object") {
    return null;
  }

  const record = module as Record<string, unknown>;
  const directCandidate = record.GPT4All;
  if (typeof directCandidate === "function") {
    return directCandidate as GPT4AllConstructor;
  }

  const defaultCandidate = record.default;
  if (typeof defaultCandidate === "function") {
    return defaultCandidate as GPT4AllConstructor;
  }

  return null;
}

function sanitizeDirectory(dir: string | undefined): string {
  if (!dir) {
    return configuredModelDir;
  }
  const trimmed = dir.trim();
  if (!trimmed) {
    return configuredModelDir;
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

export function configureLocalAI(options: LocalAIConfiguration): LocalAIOutcome {
  if (typeof options.enabled === "boolean") {
    configuredEnabled = options.enabled;
    if (!isAIGloballyEnabled()) {
      markDisabled(options.enabled ? undefined : "Local AI disabled by configuration.");
    }
  }

  if (options.modelDirectory) {
    configuredModelDir = sanitizeDirectory(options.modelDirectory);
  }

  if (typeof options.modelPath === "string") {
    configuredModelPath = options.modelPath.trim();
  }

  if (typeof options.modelName === "string") {
    configuredModelName = options.modelName.trim();
  }

  resetLocalAIState();
  return getLastAIOutcome();
}

async function loadModel(): Promise<GPT4AllInstance | null> {
  if (!isAIGloballyEnabled()) {
    markDisabled();
    return null;
  }

  if (cachedModel && modelReady) {
    return cachedModel;
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
      return null;
    }

    try {
      const imported = await import("gpt4all");
      const GPT4AllCtor = resolveGpt4AllConstructor(imported);
      if (!GPT4AllCtor) {
        throw new Error("Failed to load GPT4All constructor from module export.");
      }
      const modelName = path.basename(modelFile);
      const modelDir = path.dirname(modelFile);
      const instance = new GPT4AllCtor(modelName, {
        modelPath: modelDir,
        verbose: false,
        allowDownload: false,
      });
      await instance.init();
      await instance.open();
      cachedModel = instance;
      modelReady = true;
      lastModelPath = modelFile;
      lastOutcome = { status: "idle", modelPath: modelFile };
      return instance;
    } catch (error) {
      console.warn("Failed to initialize local GPT4All model", error);
      lastOutcome = {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to initialize the local AI model.",
      };
      cachedModel = null;
      modelReady = false;
      lastModelPath = null;
      return null;
    }
  })();

  const model = await loadPromise;
  loadPromise = null;
  return model;
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

function stripBulletPrefix(line: string): string {
  return line.replace(BULLET_PREFIX_PATTERN, "").trim();
}

function normalizeKeywordSegment(segment: string): string {
  let working = segment.replace(/^[–\-]\s*/, "").trim();
  working = working.replace(/^(?:and|or)\s+/i, "").trim();
  working = working.replace(/[.!?]+$/g, "").trim();
  working = working.replace(/\bfor\s+(?:context|reference|background)\s*$/i, "").trim();
  return collapseWhitespace(working);
}

function extractQuotedPhrases(text: string): string[] {
  const normalizedQuotes = text.replace(/[“”]/g, '"');
  const matches = normalizedQuotes.matchAll(/"([^"\n]{2,})"/g);
  const phrases: string[] = [];
  for (const match of matches) {
    const content = collapseWhitespace(match[1]);
    if (content) {
      phrases.push(content);
    }
  }
  return phrases;
}

function parseKeywordLine(line: string): { keywords: string[]; refinedQuery: string | null } {
  const bulletless = stripBulletPrefix(line.replace(/\r/g, " "));
  if (!bulletless) {
    return { keywords: [], refinedQuery: null };
  }

  let working = bulletless.replace(/[“”]/g, '"').trim();
  const quotedPhrases = extractQuotedPhrases(working);
  let refinedQuery: string | null = quotedPhrases.length > 0 ? quotedPhrases[0] : null;

  if (quotedPhrases.length > 0) {
    working = working.replace(/"([^"\n]{2,})"/g, (_match, group: string) => group);
  }

  const labelMatch = working.match(/^(?:refined(?:\s+search)?|better\s+query|search(?:\s+terms?)?|query(?:\s+idea)?|focus)\s*[:\-]\s*(.+)$/i);
  if (labelMatch && labelMatch[1]) {
    const labelContent = collapseWhitespace(labelMatch[1]);
    if (!refinedQuery && labelContent && isLikelyRefinedQuery(labelContent)) {
      refinedQuery = labelContent;
    }
    working = labelMatch[1];
  }

  let cleaned = working.trim().replace(/[.!?]+$/g, "").trim();

  let iterations = 0;
  while (DIRECTIVE_PREFIX_PATTERN.test(cleaned) && iterations < 4) {
    cleaned = cleaned.replace(DIRECTIVE_PREFIX_PATTERN, "").trim();
    iterations += 1;
  }

  cleaned = cleaned.replace(/^(?:the\s+)?phrase\s+/i, "");
  cleaned = cleaned.replace(/^(?:terms?\s+(?:like|such\s+as)|keywords?\s+(?:like|such\s+as))\s+/i, "");
  cleaned = cleaned.replace(/\([^)]*\)$/g, "").trim();
  cleaned = cleaned.replace(/^[–\-]\s*/, "").trim();

  const segments = cleaned
    .split(KEYWORD_SPLIT_PATTERN)
    .map((segment) => normalizeKeywordSegment(segment))
    .filter((segment) => segment.length > 0 && segment.length <= 120);

  return {
    keywords: [...quotedPhrases, ...segments],
    refinedQuery,
  };
}

function parseKeywordsSection(section: string): { keywords: string[]; refinedQuery: string | null } {
  if (!section || !section.trim()) {
    return { keywords: [], refinedQuery: null };
  }

  const lines = section
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const keywords: string[] = [];
  const seen = new Set<string>();
  let refinedQuery: string | null = null;

  for (const line of lines) {
    const { keywords: lineKeywords, refinedQuery: lineRefined } = parseKeywordLine(line);
    for (const keyword of lineKeywords) {
      const normalized = collapseWhitespace(keyword);
      if (!normalized) {
        continue;
      }
      const lowercase = normalized.toLowerCase();
      if (seen.has(lowercase)) {
        continue;
      }
      seen.add(lowercase);
      keywords.push(normalized);
    }
    if (!refinedQuery && lineRefined) {
      const normalizedRefined = collapseWhitespace(lineRefined);
      if (normalizedRefined && isLikelyRefinedQuery(normalizedRefined)) {
        refinedQuery = normalizedRefined;
      }
    }
  }

  return { keywords, refinedQuery };
}

export function parseModelSearchResponse(text: string): LocalAISearchInsights | null {
  if (!text || !text.trim()) {
    return null;
  }

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const sections = normalized
    .split(SECTION_SPLIT_PATTERN)
    .map((section) => section.trim())
    .filter((section) => section.length > 0);

  if (sections.length === 0) {
    return {
      summary: normalized,
      interpretation: null,
      keywords: [],
      refinedQuery: null,
      collectionHint: null,
    };
  }

  const interpretationSection = sections[0] ?? "";
  const interpretation = collapseWhitespace(interpretationSection) || null;

  const keywordSection = sections.length >= 2 ? sections[1] : "";
  const { keywords, refinedQuery } = parseKeywordsSection(keywordSection);

  let collectionHint: string | null = null;
  if (sections.length >= 3) {
    const combined = sections.slice(2).join(" ");
    const normalizedHint = collapseWhitespace(combined);
    collectionHint = normalizedHint || null;
  }

  return {
    summary: normalized,
    interpretation,
    keywords,
    refinedQuery: refinedQuery ?? null,
    collectionHint,
  };
}

function buildPrompt(query: string, mode: NSFWUserMode): string {
  const trimmed = query.trim();
  const guidance = buildNSFWPromptInstruction(mode);
  return (
    "You are Alexandria, an offline research assistant for the Internet Archive. " +
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
    const model = await loadModel();
    if (!model) {
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
      const raw = await model.prompt(prompt, DEFAULT_PROMPT_OPTIONS);
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

export async function generateAISearchInsights(
  query: string,
  options?: LocalAIResponseOptions
): Promise<LocalAISearchInsights | null> {
  const response = await generateAIResponse(query, options);
  if (!response) {
    return null;
  }

  const parsed = parseModelSearchResponse(response);
  if (parsed) {
    return parsed;
  }

  return {
    summary: response,
    interpretation: null,
    keywords: [],
    refinedQuery: null,
    collectionHint: null,
  };
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
    const model = await loadModel();
    if (!model) {
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
      const raw = await model.prompt(prompt, DEFAULT_PROMPT_OPTIONS);
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

export function getLastAIOutcome(): LocalAIOutcome {
  return lastOutcome;
}

export function resetLocalAIState(): void {
  cachedModel = null;
  modelReady = false;
  loadPromise = null;
  lastModelPath = null;
  lastOutcome = { status: isAIGloballyEnabled() ? "idle" : "disabled" };
}
