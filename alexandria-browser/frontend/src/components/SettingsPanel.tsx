import type { ChangeEvent } from "react";

import type { NSFWFilterMode } from "../types";

interface SettingsPanelProps {
  theme: "light" | "dark";
  nsfwMode: NSFWFilterMode;
  onToggleTheme: () => void;
  onChangeNSFWMode: (mode: NSFWFilterMode) => void;
  onClearHistory: () => void;
  onClearBookmarks: () => void;
  onResetPreferences: () => void; // ADD: Handler to restore default preference values.
  aiAssistantEnabled: boolean;
  onToggleAI: (enabled: boolean) => void;
}

/**
 * SettingsPanel shows toggles for NSFW filtering, theme, and data cleanup actions.
 */
export function SettingsPanel({
  theme,
  nsfwMode,
  onToggleTheme,
  onChangeNSFWMode,
  onClearHistory,
  onClearBookmarks,
  onResetPreferences,
  aiAssistantEnabled,
  onToggleAI
}: SettingsPanelProps) {
  const handleModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as NSFWFilterMode;
    onChangeNSFWMode(value);
  };

  return (
    <div className="settings-panel">
      <div className="setting-row">
        <span>Theme</span>
        <button type="button" onClick={onToggleTheme}>
          {theme === "light" ? "Switch to dark" : "Switch to light"}
        </button>
      </div>
      <label className="setting-row">
        <span>NSFW filtering</span>
        <select className="settings-select" value={nsfwMode} onChange={handleModeChange}>
          <option value="safe">Safe — Truthful content for all ages</option>
          <option value="moderate">Moderate — Truthful content with mature context</option>
          <option value="off">No Restriction — All truthful content visible</option>
          <option value="only">NSFW Only — Explicit truth-focused material only</option>
        </select>
      </label>
      <label className="setting-row">
        <span>AI Search Assistant</span>
        <input
          type="checkbox"
          checked={aiAssistantEnabled}
          onChange={(event) => onToggleAI(event.target.checked)}
        />
      </label>
      <p className="setting-description">
        When enabled, Alexandria will use a local model (if installed) to suggest improved queries.
      </p>
      <button type="button" className="danger" onClick={onClearHistory}>
        Clear history
      </button>
      <button type="button" className="danger" onClick={onClearBookmarks}>
        Clear bookmarks
      </button>
      <button
        type="button"
        onClick={onResetPreferences} // ADD: Reset control clears cached preferences without touching saved library data.
      >
        Reset saved preferences
      </button>
    </div>
  );
}
