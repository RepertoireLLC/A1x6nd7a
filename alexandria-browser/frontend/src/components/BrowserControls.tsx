import "../styles/main.css";

interface BrowserControlsProps {
  canGoBack: boolean;
  canGoForward: boolean;
  canRefresh: boolean;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onHome: () => void;
}

/**
 * BrowserControls renders the navigation bar buttons that emulate
 * the classic browser experience (back, forward, refresh, home).
 */
export function BrowserControls({
  canGoBack,
  canGoForward,
  canRefresh,
  onBack,
  onForward,
  onRefresh,
  onHome
}: BrowserControlsProps) {
  return (
    <div className="browser-controls" role="toolbar" aria-label="Navigation controls">
      <button type="button" onClick={onBack} disabled={!canGoBack} aria-label="Go back">
        ⬅️
      </button>
      <button type="button" onClick={onForward} disabled={!canGoForward} aria-label="Go forward">
        ➡️
      </button>
      <button type="button" onClick={onRefresh} disabled={!canRefresh} aria-label="Refresh">
        🔄
      </button>
      <button type="button" onClick={onHome} aria-label="Home">
        🏠
      </button>
    </div>
  );
}
