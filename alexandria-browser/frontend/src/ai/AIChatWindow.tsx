import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { NSFWFilterMode } from "../types";
import { buildIAQuery, fetchIAResults, type IAItem } from "./archive";
import { applyNSFWFilter } from "./nsfw";
import { toAIInstruction } from "./prompt";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}

function createMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildFallbackPlan(query: string, mode: NSFWFilterMode): string {
  const sanitized = query.replace(/\s+/g, " ").trim();
  return [`topic: ${sanitized}`, "mediatypes: any", "years: any", "filters:", `nsfw: ${mode}`].join("\n");
}

const NSFW_MODE_LABELS: Record<NSFWFilterMode, string> = {
  safe: "Safe",
  moderate: "Moderate",
  unrestricted: "No restriction",
  "nsfw-only": "NSFW only"
};

function summarizeResults(items: IAItem[], more: boolean): string {
  if (items.length === 0) {
    return "No results matched your request. Try refining the topic, media type, or time range.";
  }
  const lines = items
    .slice(0, 10)
    .map((item) => formatIAItem(item))
    .join("\n");
  const suffix = more ? "\nType \"more\" to load additional results." : "";
  return `Found ${items.length}${more ? "+" : ""} results.\n${lines}${suffix}`;
}

function summarizeNewResults(page: number, items: IAItem[], more: boolean): string {
  if (items.length === 0) {
    return `Loaded page ${page}, but no additional items matched the current NSFW filter.`;
  }
  const lines = items
    .slice(0, 10)
    .map((item) => formatIAItem(item))
    .join("\n");
  const suffix = more ? "\nType \"more\" to keep loading." : "";
  return `Loaded page ${page}. ${items.length} items:\n${lines}${suffix}`;
}

function formatIAItem(item: IAItem): string {
  const title = item.title?.trim() || item.identifier;
  const metaParts: string[] = [];
  if (item.mediatype) {
    metaParts.push(item.mediatype);
  }
  if (item.year) {
    metaParts.push(item.year);
  }
  if (item.creator) {
    metaParts.push(item.creator);
  }
  const meta = metaParts.length > 0 ? ` [${metaParts.join(" · ")}]` : "";
  return `${title}${meta} → https://archive.org/details/${item.identifier}`;
}

export interface AIChatWindowProps {
  initialPrompt: string;
  nsfwMode: NSFWFilterMode;
}

export function AIChatWindow({ initialPrompt, nsfwMode }: AIChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rawResults, setRawResults] = useState<IAItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [lastPlan, setLastPlan] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastInitialPrompt = useRef<string | null>(null);
  const previousNsfwModeRef = useRef<NSFWFilterMode>(nsfwMode);
  const queuedRefreshModeRef = useRef<NSFWFilterMode | null>(null);

  const filteredResults = useMemo(() => applyNSFWFilter(rawResults, nsfwMode), [rawResults, nsfwMode]);

  const pushMessage = useCallback((message: ChatMessage) => {
    setMessages((previous) => [...previous, message]);
  }, []);

  const setMessageText = useCallback((id: string, text: string, streaming?: boolean) => {
    setMessages((previous) =>
      previous.map((message) =>
        message.id === id
          ? {
              ...message,
              text,
              streaming: streaming ?? message.streaming
            }
          : message
      )
    );
  }, []);

  const generatePlan = useCallback(
    async (
      query: string,
      mode: NSFWFilterMode,
      onStream?: (partial: string, streaming: boolean) => void
    ) => {
      const fallback = buildFallbackPlan(query, mode);
      const globalScope: any = typeof window !== "undefined" ? (window as any) : undefined;
      const puterAI = globalScope?.puter?.ai;
      if (!puterAI?.chat) {
        return fallback;
      }

      try {
        const stream = await puterAI.chat(toAIInstruction(query, mode), {
          stream: true,
          model: "gpt-5-nano",
          temperature: 0.2
        });
        let buffer = "";
        for await (const part of stream) {
          if (typeof part?.text === "string") {
            buffer += part.text;
            if (onStream) {
              onStream(buffer, true);
            }
          }
        }
        const plan = buffer.trim();
        return plan || fallback;
      } catch (error) {
        return fallback;
      }
    },
    []
  );

  const runInitialSearch = useCallback(
    async (query: string, plan: string, mode: NSFWFilterMode, summaryPrefix?: string) => {
      setLastQuery(query);
      setLastPlan(plan);
      const params = buildIAQuery(query, mode, plan);
      const { items, more } = await fetchIAResults(params, 1);
      setRawResults(items);
      setHasMore(more);
      setPage(1);
      const filtered = applyNSFWFilter(items, mode);
      const summary = summarizeResults(filtered, more);
      pushMessage({
        id: createMessageId(),
        role: "assistant",
        text: summaryPrefix ? `${summaryPrefix}\n${summary}` : summary
      });
    },
    [pushMessage]
  );

  const refreshResultsForMode = useCallback(
    async (mode: NSFWFilterMode, readableLabel: string) => {
      if (!lastQuery) {
        return;
      }
      try {
        const plan = await generatePlan(lastQuery, mode);
        await runInitialSearch(lastQuery, plan, mode, `Updated results for ${readableLabel}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushMessage({
          id: createMessageId(),
          role: "assistant",
          text: `Failed to refresh results for ${readableLabel}: ${message}`
        });
      }
    },
    [generatePlan, lastQuery, runInitialSearch, pushMessage]
  );

  const runModeRefresh = useCallback(
    async (mode: NSFWFilterMode) => {
      const readable = NSFW_MODE_LABELS[mode] ?? mode;
      setPending(true);
      try {
        await refreshResultsForMode(mode, readable);
      } finally {
        setPending(false);
      }
    },
    [refreshResultsForMode]
  );

  const handleSend = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) {
        return;
      }

      pushMessage({ id: createMessageId(), role: "user", text: trimmed });
      setPending(true);
      setPage(1);
      setHasMore(false);
      setRawResults([]);
      setLastQuery(trimmed);
      setLastPlan(null);

      const planMessageId = createMessageId();
      pushMessage({ id: planMessageId, role: "assistant", text: "Analyzing your request…", streaming: true });

      let planText = "";
      try {
        planText = await generatePlan(trimmed, nsfwMode, (partial, streaming) => {
          const display = partial.trim() || "Analyzing your request…";
          setMessageText(planMessageId, display, streaming);
        });
        setMessageText(planMessageId, `Search plan:\n${planText}`, false);

        await runInitialSearch(trimmed, planText, nsfwMode);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!planText) {
          planText = buildFallbackPlan(trimmed, nsfwMode);
          setMessageText(planMessageId, `Search plan:\n${planText}`, false);
        }
        setLastPlan(planText);
        pushMessage({
          id: createMessageId(),
          role: "assistant",
          text: `Error: ${message}`
        });
      } finally {
        setPending(false);
        if (queuedRefreshModeRef.current) {
          const mode = queuedRefreshModeRef.current;
          queuedRefreshModeRef.current = null;
          void runModeRefresh(mode);
        }
      }
    },
    [nsfwMode, pushMessage, setMessageText, generatePlan, runInitialSearch, runModeRefresh]
  );

  const loadMore = useCallback(async () => {
    if (pending) {
      pushMessage({
        id: createMessageId(),
        role: "assistant",
        text: "Still processing the previous request. Please wait a moment before loading more results."
      });
      return;
    }
    if (!lastQuery) {
      pushMessage({
        id: createMessageId(),
        role: "assistant",
        text: "No active AI search yet. Submit a query before asking for additional pages."
      });
      return;
    }
    if (!hasMore) {
      pushMessage({
        id: createMessageId(),
        role: "assistant",
        text: "No additional pages are available for this query. Try refining your request for more results."
      });
      return;
    }
    setPending(true);
    try {
      const nextPage = page + 1;
      const planForPaging = lastPlan ?? buildFallbackPlan(lastQuery, nsfwMode);
      const params = buildIAQuery(lastQuery, nsfwMode, planForPaging);
      const { items, more } = await fetchIAResults(params, nextPage);
      setRawResults((previous) => [...previous, ...items]);
      setHasMore(more);
      setPage(nextPage);
      const filtered = applyNSFWFilter(items, nsfwMode);
      pushMessage({
        id: createMessageId(),
        role: "assistant",
        text: summarizeNewResults(nextPage, filtered, more)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushMessage({
        id: createMessageId(),
        role: "assistant",
        text: `Error loading more results: ${message}`
      });
    } finally {
      setPending(false);
    }
  }, [pending, lastQuery, hasMore, page, nsfwMode, lastPlan, pushMessage]);

  useEffect(() => {
    const trimmed = initialPrompt.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed === lastInitialPrompt.current) {
      return;
    }
    lastInitialPrompt.current = trimmed;
    void handleSend(trimmed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = inputRef.current?.value ?? "";
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      if (trimmed.toLowerCase() === "more") {
        void loadMore();
      } else {
        void handleSend(trimmed);
      }
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [handleSend, loadMore]
  );

  useEffect(() => {
    if (previousNsfwModeRef.current === nsfwMode) {
      return;
    }
    previousNsfwModeRef.current = nsfwMode;
    if (!lastQuery) {
      return;
    }
    const readableMode = NSFW_MODE_LABELS[nsfwMode] ?? nsfwMode;
    pushMessage({
      id: createMessageId(),
      role: "assistant",
      text: `NSFW mode switched to ${readableMode}. Updating results to respect this preference…`
    });

    if (pending) {
      queuedRefreshModeRef.current = nsfwMode;
      return;
    }
    queuedRefreshModeRef.current = null;
    void runModeRefresh(nsfwMode);
  }, [nsfwMode, lastQuery, pending, runModeRefresh, pushMessage]);

  return (
    <div className="ai-chat-window">
      <div className="ai-chat-messages" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={`ai-chat-message ai-chat-message-${message.role}`}>
            <pre>{message.text}</pre>
          </div>
        ))}
        {pending && (
          <div className="ai-chat-message ai-chat-message-assistant" aria-live="polite">
            <pre>Working…</pre>
          </div>
        )}
      </div>

      <div className="ai-chat-results">
        {filteredResults.map((item) => (
          <article key={item.identifier} className="ai-chat-result">
            <h3>
              <a href={`https://archive.org/details/${item.identifier}`} target="_blank" rel="noreferrer">
                {item.title?.trim() || item.identifier}
              </a>
            </h3>
            <p className="ai-chat-result-meta">
              {item.mediatype ? <span>{item.mediatype}</span> : null}
              {item.year ? <span> · {item.year}</span> : null}
              {item.creator ? <span> · {item.creator}</span> : null}
              {item.wayback ? (
                <span> · Wayback: {item.wayback.available ? "available" : "n/a"}</span>
              ) : null}
            </p>
            {item.description ? <p className="ai-chat-result-description">{item.description}</p> : null}
          </article>
        ))}
        {!pending && filteredResults.length === 0 ? (
          <p className="ai-chat-empty" role="note">
            No items to display yet. Ask for anything in the Internet Archive.
          </p>
        ) : null}
      </div>

      <form className="ai-chat-composer" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask for anything in the Internet Archive… (type 'more' for next page)"
          disabled={pending}
        />
        <button type="submit" disabled={pending}>
          Send
        </button>
      </form>
    </div>
  );
}
