import type { AiSearchPlan } from "../types";

const REQUEST_TIMEOUT_MS = 5000;
const RUNTIME_WAIT_MS = 2000;
const RUNTIME_POLL_INTERVAL_MS = 120;
const PRIMARY_MODELS = ["gpt-5", "gpt-5-mini", "gpt-4o"] as const;

function getRuntime(): PuterRuntime | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.puter ?? null;
}

async function waitForRuntime(): Promise<PuterRuntime | null> {
  const start = Date.now();
  while (Date.now() - start < RUNTIME_WAIT_MS) {
    const runtime = getRuntime();
    if (runtime) {
      return runtime;
    }
    await new Promise((resolve) => setTimeout(resolve, RUNTIME_POLL_INTERVAL_MS));
  }
  return getRuntime();
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) {
      return value;
    }
    if (value > 1 && value <= 100) {
      return value / 100;
    }
    if (value < 0) {
      return undefined;
    }
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return normalizeConfidence(parsed);
    }
  }
  return undefined;
}

function coerceResponseText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.text === "string") {
    return candidate.text;
  }

  if (typeof candidate.output === "string") {
    return candidate.output;
  }

  if (candidate.message && typeof candidate.message === "object") {
    const message = candidate.message as Record<string, unknown>;
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
            return String((part as Record<string, unknown>).text);
          }
          return "";
        })
        .join("");
    }
  }

  if (Array.isArray(candidate.choices)) {
    const [first] = candidate.choices as Array<Record<string, unknown>>;
    if (first) {
      if (typeof first.text === "string") {
        return first.text;
      }
      if (first.message && typeof first.message === "object") {
        const inner = first.message as Record<string, unknown>;
        if (typeof inner.content === "string") {
          return inner.content;
        }
        if (Array.isArray(inner.content)) {
          return inner.content
            .map((part) => {
              if (typeof part === "string") {
                return part;
              }
              if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
                return String((part as Record<string, unknown>).text);
              }
              return "";
            })
            .join("");
        }
      }
    }
  }

  return null;
}

function extractJsonCandidate(payload: string): Record<string, unknown> | null {
  const startIndex = payload.indexOf("{");
  const endIndex = payload.lastIndexOf("}");
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  const snippet = payload.slice(startIndex, endIndex + 1);
  try {
    return JSON.parse(snippet);
  } catch (error) {
    console.warn("AI planner returned non-JSON payload", error, { snippet });
    return null;
  }
}

function buildPlanFromPayload(
  source: string,
  model: string,
  payload: Record<string, unknown>
): AiSearchPlan | null {
  const optimizedCandidate = [
    payload.optimized_query,
    payload.optimizedQuery,
    payload.search_query,
    payload.query,
    payload.keywords_query,
  ].find((value): value is unknown => typeof value === "string" && value.trim().length > 0);

  const optimizedQuery = typeof optimizedCandidate === "string" ? optimizedCandidate.trim() : source;

  const keywordsCandidate = Array.isArray(payload.keywords)
    ? payload.keywords
    : Array.isArray(payload.terms)
    ? payload.terms
    : Array.isArray(payload.focus_terms)
    ? payload.focus_terms
    : [];

  const keywords: string[] = [];
  if (Array.isArray(keywordsCandidate)) {
    const seen = new Set<string>();
    for (const entry of keywordsCandidate) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      const normalized = trimmed.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      keywords.push(trimmed);
      if (keywords.length >= 8) {
        break;
      }
    }
  }

  const rationaleCandidate = [payload.rationale, payload.reason, payload.notes].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  const confidenceCandidate =
    payload.confidence ?? payload.score ?? payload.certainty ?? payload.probability;

  const modelCandidate =
    typeof payload.model === "string" && payload.model.trim().length > 0
      ? payload.model.trim()
      : model;

  const confidence = normalizeConfidence(confidenceCandidate);

  if (typeof optimizedQuery !== "string" || optimizedQuery.trim().length === 0) {
    return null;
  }

  return {
    source,
    optimizedQuery: optimizedQuery.trim(),
    keywords,
    rationale: rationaleCandidate?.trim(),
    model: modelCandidate,
    confidence,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("AI planner request timed out"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

async function invokeModel(runtime: PuterRuntime, prompt: string, model: string): Promise<string | null> {
  if (!runtime.ai || typeof runtime.ai.chat !== "function") {
    return null;
  }

  try {
    const response = await withTimeout(
      runtime.ai.chat(prompt, {
        model,
        temperature: 0.2,
        max_tokens: 220,
      }),
      REQUEST_TIMEOUT_MS
    );
    return coerceResponseText(response);
  } catch (error) {
    console.warn(`AI planner call failed for model ${model}`, error);
    return null;
  }
}

function buildPlannerPrompt(query: string): string {
  return [
    "You are the Alexandria Browser query planner.",
    "Convert the user's request into an Internet Archive advancedsearch query.",
    "Respond with STRICT JSON using this schema:",
    '{"optimized_query":"...","keywords":["..."],"rationale":"...","confidence":0.85}',
    "Guidelines:",
    "- Keep optimized_query concise (<= 6 key terms) and usable directly in archive search.",
    "- keywords must be 2-8 short phrases without quotes or punctuation beyond words.",
    "- rationale is a brief sentence explaining the chosen focus.",
    "- confidence is a number between 0 and 1.",
    "- If the request is already a good keyword search, reuse it.",
    "- Never add commentary outside the JSON object.",
    `User request: ${query}`,
  ].join("\n");
}

export function isPuterReady(): boolean {
  const runtime = getRuntime();
  return Boolean(runtime?.ai && typeof runtime.ai.chat === "function");
}

export async function planArchiveQuery(query: string): Promise<AiSearchPlan | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const immediateRuntime = getRuntime();
  const runtime = immediateRuntime ?? (await waitForRuntime());
  if (!runtime?.ai || typeof runtime.ai.chat !== "function") {
    return null;
  }

  const prompt = buildPlannerPrompt(trimmed);

  for (const model of PRIMARY_MODELS) {
    const text = await invokeModel(runtime, prompt, model);
    if (!text) {
      continue;
    }
    const jsonPayload = extractJsonCandidate(text);
    if (!jsonPayload) {
      continue;
    }
    const plan = buildPlanFromPayload(trimmed, model, jsonPayload);
    if (plan) {
      return plan;
    }
  }

  return null;
}
