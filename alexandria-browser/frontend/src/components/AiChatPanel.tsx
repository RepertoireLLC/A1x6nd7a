import { FormEvent, useMemo, useState } from "react";

import type { AIAvailabilityStatus, AIChatMessage } from "../types";

interface AiChatPanelProps {
  enabled: boolean;
  availability: AIAvailabilityStatus;
  messages: AIChatMessage[];
  isSending: boolean;
  onSend: (message: string) => void;
  onClear: () => void;
  onRequestNavigation?: () => void;
  navigationLoading?: boolean;
  error?: string | null;
}

function availabilityLabel(status: AIAvailabilityStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "unavailable":
      return "Unavailable";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled";
    default:
      return "Checking";
  }
}

function isInputDisabled(status: AIAvailabilityStatus, isSending: boolean): boolean {
  if (isSending) {
    return true;
  }
  return status !== "ready";
}

export function AiChatPanel({
  enabled,
  availability,
  messages,
  isSending,
  onSend,
  onClear,
  onRequestNavigation,
  navigationLoading,
  error,
}: AiChatPanelProps) {
  const [draft, setDraft] = useState("");
  const statusLabel = useMemo(() => availabilityLabel(availability), [availability]);
  const disabled = !enabled || isInputDisabled(availability, isSending);

  if (!enabled) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    onSend(trimmed);
    setDraft("");
  };

  return (
    <section className="ai-chat-panel harmonia-card" aria-live="polite">
      <header className="ai-chat-header">
        <div>
          <h2>AI Research Assistant</h2>
          <p className="ai-chat-subtitle">Ask questions or request navigation tips.</p>
        </div>
        <div className="ai-chat-actions">
          <span className={`ai-chat-status ai-chat-status-${availability}`}>{statusLabel}</span>
          <button type="button" onClick={onClear} disabled={messages.length === 0}>
            Clear
          </button>
        </div>
      </header>
      <div className="ai-chat-body">
        {messages.length === 0 ? (
          <p className="ai-chat-placeholder">
            {availability === "ready"
              ? "Start by asking how to refine your research or request a summary of the current item."
              : availability === "disabled"
              ? "AI mode is disabled by the server configuration."
              : availability === "unavailable"
              ? error || "No local AI model is available. Install a compatible model to enable suggestions."
              : availability === "error"
              ? error || "The AI assistant encountered an error."
              : "Preparing local AI assistant…"}
          </p>
        ) : (
          <ul className="ai-chat-messages">
            {messages.map((message) => (
              <li key={message.id} className={`ai-chat-message ai-chat-role-${message.role}${message.error ? " ai-chat-message-error" : ""}`}>
                <span className="ai-chat-message-role">
                  {message.role === "assistant"
                    ? "Alexandria"
                    : message.role === "system"
                    ? "System"
                    : "You"}
                </span>
                <p className="ai-chat-message-content">{message.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="ai-chat-footer">
        <form onSubmit={handleSubmit} className="ai-chat-form">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              availability === "ready"
                ? "Ask Alexandria for research help or follow-up questions"
                : "AI assistant unavailable"
            }
            disabled={disabled}
            rows={3}
          />
          <div className="ai-chat-controls">
            <button type="submit" disabled={disabled}>
              {isSending ? "Sending…" : "Send"}
            </button>
            {onRequestNavigation ? (
              <button
                type="button"
                className="secondary"
                onClick={onRequestNavigation}
                disabled={availability !== "ready" || Boolean(navigationLoading)}
              >
                {navigationLoading ? "Loading…" : "Navigation tips"}
              </button>
            ) : null}
          </div>
        </form>
        {error && availability !== "ready" ? (
          <p className="ai-chat-error" role="status">
            {error}
          </p>
        ) : null}
      </footer>
    </section>
  );
}
