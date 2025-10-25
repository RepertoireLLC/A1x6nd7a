import { API_BASE_URL, type ApiErrorInfo, type ApiResult } from "./archive";

export type AIQueryMode = "chat" | "navigation" | "document" | "search";

export interface AIQueryHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AIQueryContext {
  activeQuery?: string;
  currentUrl?: string;
  documentTitle?: string;
  documentSummary?: string;
  navigationTrail?: string[];
  extraNotes?: string;
}

export interface AIQueryRequest {
  message: string;
  mode?: AIQueryMode;
  query?: string;
  context?: AIQueryContext;
  history?: AIQueryHistoryTurn[];
  nsfwMode?: string;
}

export interface AIQueryOutcome {
  status: "idle" | "success" | "missing-model" | "error" | "disabled" | "blocked";
  message?: string;
  modelPath?: string | null;
}

export interface AIQueryResponse {
  status: "success" | "unavailable" | "error" | "disabled";
  reply: string | null;
  error?: string | null;
  mode: AIQueryMode;
  outcome?: AIQueryOutcome;
}

export interface AIStatusResponse {
  enabled: boolean;
  outcome: AIQueryOutcome;
  models: string[];
  modelPaths: string[];
  modelDirectory: string;
  directoryAccessible: boolean;
  directoryError?: string;
}

function buildQueryUrl(): string {
  const url = new URL("/api/ai/query", `${API_BASE_URL}/`);
  return url.toString();
}

function buildStatusUrl(): string {
  const url = new URL("/api/ai/status", `${API_BASE_URL}/`);
  url.searchParams.set("warmup", "1");
  return url.toString();
}

function coerceHistory(history: AIQueryHistoryTurn[] | undefined): AIQueryHistoryTurn[] | undefined {
  if (!history || history.length === 0) {
    return undefined;
  }

  const normalized = history
    .filter((turn) => Boolean(turn) && typeof turn.content === "string" && turn.content.trim())
    .map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content.trim(),
    }));

  return normalized.length > 0 ? normalized.slice(-6) : undefined;
}

function coerceContext(context: AIQueryContext | undefined): AIQueryContext | undefined {
  if (!context) {
    return undefined;
  }

  const normalized: AIQueryContext = {};

  const assign = (key: keyof AIQueryContext, value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        normalized[key] = trimmed;
      }
    }
  };

  assign("activeQuery", context.activeQuery);
  assign("currentUrl", context.currentUrl);
  assign("documentTitle", context.documentTitle);
  assign("documentSummary", context.documentSummary);
  assign("extraNotes", context.extraNotes);

  if (Array.isArray(context.navigationTrail)) {
    const trail = context.navigationTrail
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => Boolean(item));
    if (trail.length > 0) {
      normalized.navigationTrail = trail.slice(-5);
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export async function submitAIQuery(request: AIQueryRequest): Promise<ApiResult<AIQueryResponse>> {
  const message = request.message.trim();
  if (!message) {
    return {
      ok: false,
      error: {
        message: "AI query message cannot be empty.",
        type: "invalid-response",
      },
    };
  }

  const payload: Record<string, unknown> = { message };
  if (request.mode) {
    payload.mode = request.mode;
  }
  if (request.query && request.query.trim()) {
    payload.query = request.query.trim();
  }

  const context = coerceContext(request.context);
  if (context) {
    payload.context = context;
  }

  const history = coerceHistory(request.history);
  if (history) {
    payload.history = history;
  }

  if (request.nsfwMode) {
    payload.nsfwMode = request.nsfwMode;
  }

  try {
    const response = await fetch(buildQueryUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const status = response.status;
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      if (contentType.includes("application/json")) {
        try {
          const errorBody = (await response.json()) as { error?: unknown; details?: unknown };
          const messageText = typeof errorBody.error === "string" ? errorBody.error : undefined;
          const detailsText = typeof errorBody.details === "string" ? errorBody.details : undefined;
          const info: ApiErrorInfo = {
            message: messageText || "AI request failed.",
            status,
            details: detailsText,
          };
          return { ok: false, error: info, status };
        } catch (error) {
          console.warn("Failed to parse AI error response", error);
        }
      }

      const fallbackError: ApiErrorInfo = {
        message: `AI request failed with status ${status}.`,
        status,
      };
      return { ok: false, error: fallbackError, status };
    }

    const data = (await response.json()) as AIQueryResponse;
    return { ok: true, data, status };
  } catch (error) {
    const info: ApiErrorInfo = {
      message: "Unable to reach the Alexandria AI service.",
      details: error instanceof Error ? error.message : String(error),
      type: "network",
    };
    return { ok: false, error: info };
  }
}

export async function fetchAIStatus(): Promise<ApiResult<AIStatusResponse>> {
  try {
    const response = await fetch(buildStatusUrl(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const status = response.status;
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      if (contentType.includes("application/json")) {
        try {
          const errorBody = (await response.json()) as { error?: unknown; details?: unknown };
          const message = typeof errorBody.error === "string" ? errorBody.error : "AI status request failed.";
          const details = typeof errorBody.details === "string" ? errorBody.details : undefined;
          return {
            ok: false,
            error: { message, details, status },
            status,
          };
        } catch (error) {
          console.warn("Failed to parse AI status error response", error);
        }
      }

      return {
        ok: false,
        error: { message: `AI status request failed with status ${status}.`, status },
        status,
      };
    }

    if (!contentType.includes("application/json")) {
      const preview = (await response.text()).slice(0, 200).trim();
      return {
        ok: false,
        error: {
          message: "AI status response was not JSON.",
          status,
          details: preview,
        },
        status,
      };
    }

    const data = (await response.json()) as AIStatusResponse;
    return { ok: true, data, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const info: ApiErrorInfo = {
      message: "Unable to reach the Alexandria AI status endpoint.",
      details: message,
      type: "network",
    };
    return { ok: false, error: info };
  }
}
