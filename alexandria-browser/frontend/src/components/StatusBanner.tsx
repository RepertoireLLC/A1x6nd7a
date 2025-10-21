import type { ReactNode } from "react";

type StatusTone = "info" | "success" | "warning" | "error";

interface StatusBannerProps {
  tone?: StatusTone;
  title?: string;
  message: string;
  children?: ReactNode;
}

const ICONS: Record<StatusTone, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "⚠️"
};

/**
 * StatusBanner surfaces success, warning, and error messages in a consistent style.
 */
export function StatusBanner({ tone = "info", title, message, children }: StatusBannerProps) {
  const role = tone === "error" ? "alert" : "status";
  return (
    <div className={`status-banner status-banner-${tone}`} role={role} aria-live="polite">
      <span className="status-banner-icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className="status-banner-body">
        {title ? <strong className="status-banner-title">{title}</strong> : null}
        <span>{message}</span>
        {children}
      </div>
    </div>
  );
}
