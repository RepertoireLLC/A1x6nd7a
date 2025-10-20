import type { ReactNode } from "react";

interface BrowserNavProps {
  canGoBack: boolean;
  canGoForward: boolean;
  canRefresh: boolean;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onHome: () => void;
  onOpenLibrary: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * BrowserNav unifies navigation controls and the search affordance in a Harmonia-styled bar.
 */
export function BrowserNav({
  canGoBack,
  canGoForward,
  canRefresh,
  onBack,
  onForward,
  onRefresh,
  onHome,
  onOpenLibrary,
  actions,
  children
}: BrowserNavProps) {
  return (
    <nav className="browser-nav harmonia-card" role="navigation" aria-label="Browser controls">
      <div className="browser-nav-top">
        <div className="browser-nav-buttons" role="group" aria-label="Page navigation">
          <button type="button" onClick={onBack} disabled={!canGoBack} aria-label="Go back">
            ←
          </button>
          <button type="button" onClick={onForward} disabled={!canGoForward} aria-label="Go forward">
            →
          </button>
          <button type="button" onClick={onRefresh} disabled={!canRefresh} aria-label="Refresh">
            ⟳
          </button>
          <button type="button" onClick={onHome} aria-label="Home">
            ◎
          </button>
        </div>
        <div className="browser-nav-actions">
          <button type="button" className="library-button" onClick={onOpenLibrary}>
            ☰ Library
          </button>
          {actions}
        </div>
      </div>
      <div className="browser-nav-search">{children}</div>
    </nav>
  );
}
