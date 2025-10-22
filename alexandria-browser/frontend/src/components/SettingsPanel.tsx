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
  onResetPreferences
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
          <option value="safe">Safe — hide all NSFW</option>
          <option value="moderate">Moderate — allow mild</option>
          <option value="off">No filter</option>
          <option value="only">Only NSFW content</option>
        </select>
      </label>
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
