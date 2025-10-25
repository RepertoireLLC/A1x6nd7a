import { ChangeEvent, useCallback } from 'react';
import { useAlexandriaSettings } from '../state/useAlexandriaSettings';

export function AlexandriaPluginToggle() {
  const { enabled, setEnabled } = useAlexandriaSettings();

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setEnabled(event.target.checked);
  }, [setEnabled]);

  return (
    <div className="flex flex-col gap-2 p-4 border border-slate-700 rounded-xl bg-slate-900/70 text-slate-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Enable Alexandria Browser</p>
          <p className="text-xs text-slate-400">Browse the Internet Archive directly from the platform.</p>
        </div>
        <label className="inline-flex items-center cursor-pointer gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={handleChange}
            className="sr-only peer"
          />
          <span className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-700 transition peer-checked:bg-indigo-500">
            <span className="absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
          </span>
        </label>
      </div>
      <p className="text-xs text-slate-500">When disabled, Alexandria routes and UI remain unloaded.</p>
    </div>
  );
}
