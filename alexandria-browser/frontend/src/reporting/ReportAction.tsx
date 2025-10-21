import { FormEvent, useEffect, useId, useRef, useState } from "react";

import { DEFAULT_REPORT_REASON, REPORT_REASONS, type ReportReason } from "./options";
import type { ReportSubmitHandler } from "./types";

interface ReportActionProps {
  identifier: string;
  archiveUrl: string;
  title: string;
  onSubmit: ReportSubmitHandler;
}

/**
 * ReportAction renders a compact flag button with a contextual menu for sending
 * content reports to the Alexandria backend.
 */
export function ReportAction({ identifier, archiveUrl, title, onSubmit }: ReportActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<ReportReason>(DEFAULT_REPORT_REASON);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const menuId = useId();
  const headingId = useId();
  const reasonGroupName = useId();

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const closeMenu = () => {
    setIsOpen(false);
    setError(null);
  };

  const resetForm = () => {
    setSelectedReason(DEFAULT_REPORT_REASON);
    setMessage("");
  };

  const handleToggle = () => {
    setIsOpen((current) => !current);
    setError(null);
  };

  const handleCancel = () => {
    closeMenu();
    resetForm();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const trimmedMessage = message.trim();

    try {
      await onSubmit({
        identifier,
        archiveUrl,
        reason: selectedReason,
        message: trimmedMessage ? trimmedMessage : undefined,
        title
      });

      if (!isMountedRef.current) {
        return;
      }

      setIsSubmitting(false);
      setIsOpen(false);
      resetForm();
    } catch (submissionError) {
      if (!isMountedRef.current) {
        return;
      }

      let errorMessage = "Unable to submit report. Please try again.";
      if (submissionError instanceof Error && submissionError.message.trim()) {
        errorMessage = submissionError.message.trim();
      }
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="report-action" ref={containerRef}>
      <button
        type="button"
        className="report-button"
        aria-label="Report this item"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={handleToggle}
        disabled={!archiveUrl}
        title="Report this item"
      >
        <span aria-hidden="true">🚩</span>
      </button>
      {isOpen ? (
        <form
          className="report-menu"
          role="dialog"
          aria-modal="false"
          id={menuId}
          aria-labelledby={headingId}
          onSubmit={handleSubmit}
        >
          <p className="report-menu-title" id={headingId}>
            Report this item
          </p>
          <fieldset className="report-menu-fieldset">
            <legend>Reason</legend>
            <div className="report-menu-options">
              {REPORT_REASONS.map((option) => (
                <label key={option.value} className="report-option">
                  <input
                    type="radio"
                    name={reasonGroupName}
                    value={option.value}
                    checked={selectedReason === option.value}
                    onChange={() => setSelectedReason(option.value)}
                    disabled={isSubmitting}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="report-message-label">
            <span>Optional message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add context for the Archive team (2000 characters max)"
              maxLength={2000}
              rows={4}
              disabled={isSubmitting}
            />
          </label>
          {error ? (
            <p className="report-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="report-menu-actions">
            <button type="button" className="report-cancel" onClick={handleCancel} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="report-submit" disabled={isSubmitting}>
              {isSubmitting ? "Submitting…" : "Submit report"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
