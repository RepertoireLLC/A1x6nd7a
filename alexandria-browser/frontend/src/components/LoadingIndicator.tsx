interface LoadingIndicatorProps {
  label?: string;
  inline?: boolean;
}

/**
 * LoadingIndicator renders a Harmonia-styled spinner with optional label.
 */
export function LoadingIndicator({ label = "Loading…", inline = false }: LoadingIndicatorProps) {
  const classes = ["loading-indicator"];
  if (inline) {
    classes.push("loading-indicator-inline");
  }
  return (
    <div className={classes.join(" ")} role="status" aria-live="polite" aria-busy="true">
      <span className="loading-spinner" aria-hidden="true" />
      <span className="loading-label">{label}</span>
    </div>
  );
}
