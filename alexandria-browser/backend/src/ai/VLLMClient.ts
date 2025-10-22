const DEFAULT_TIMEOUT_MS = 20_000;

export interface VLLMChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface VLLMClientConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface VLLMCompletionResult {
  ok: boolean;
  content?: string;
  status?: number;
  error?: string;
  raw?: unknown;
}

function normalizeMessages(messages: VLLMChatMessage[]): VLLMChatMessage[] {
  return messages
    .filter((message) => Boolean(message?.content))
    .map<VLLMChatMessage>((message) => ({
      role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0);
}

function safeParseJson(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    return payload.trim() || null;
  }

  if (typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  const errorValue = record.error;
  if (typeof errorValue === "string" && errorValue.trim()) {
    return errorValue.trim();
  }

  if (errorValue && typeof errorValue === "object") {
    const nested = errorValue as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message.trim();
    }
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }

  return null;
}

function extractCompletionText(payload: unknown): string | null {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    return payload.trim() || null;
  }

  if (typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];

  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }

    const choiceRecord = choice as Record<string, unknown>;
    const message = choiceRecord.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }

    const delta = choiceRecord.delta as Record<string, unknown> | undefined;
    if (delta && typeof delta.content === "string" && delta.content.trim()) {
      return delta.content.trim();
    }

    if (typeof choiceRecord.text === "string" && choiceRecord.text.trim()) {
      return choiceRecord.text.trim();
    }
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }

  if (typeof record.text === "string" && record.text.trim()) {
    return record.text.trim();
  }

  return null;
}

export async function fetchVLLMChatCompletion(
  config: VLLMClientConfig,
  messages: VLLMChatMessage[]
): Promise<VLLMCompletionResult> {
  const preparedMessages = normalizeMessages(messages);
  if (preparedMessages.length === 0) {
    return { ok: false, error: "No messages provided for vLLM request." };
  }

  const baseUrl = config.baseUrl?.trim() ?? "";
  if (!baseUrl) {
    return { ok: false, error: "Missing base URL for the vLLM service." };
  }

  const model = config.model?.trim() ?? "";
  if (!model) {
    return { ok: false, error: "Missing model identifier for the vLLM request." };
  }

  const timeoutMs =
    typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? Math.floor(config.timeoutMs)
      : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(new Error("Request to vLLM timed out.")), timeoutMs);
  (timeoutHandle as NodeJS.Timeout).unref?.();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey && config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }

  const body = JSON.stringify({ model, messages: preparedMessages });

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    const status = response.status;
    let raw: unknown = null;
    let text = "";

    try {
      text = await response.text();
      raw = safeParseJson(text);
    } catch {
      raw = null;
    }

    if (!response.ok) {
      const errorMessage = extractErrorMessage(raw) ?? `Request failed with status ${status}.`;
      return { ok: false, status, error: errorMessage, raw };
    }

    const content = extractCompletionText(raw);
    if (!content) {
      return {
        ok: false,
        status,
        error: "No completion text returned by the vLLM service.",
        raw,
      };
    }

    return {
      ok: true,
      status,
      content,
      raw,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error occurred while contacting the vLLM service.";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeoutHandle as NodeJS.Timeout);
  }
}
