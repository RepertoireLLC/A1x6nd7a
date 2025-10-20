import { create } from 'zustand';

const STORAGE_KEY = 'alexandria:plugin-settings';

interface StoredSettings {
  plugins?: {
    alexandriaBrowser?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface AlexandriaSettingsState {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  refresh: () => void;
}

function readStoredSettings(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return false;
    }

    const parsed: StoredSettings = JSON.parse(stored);
    return Boolean(parsed?.plugins?.alexandriaBrowser);
  } catch (error) {
    console.warn('[Alexandria] Failed to read stored settings', error);
    return false;
  }
}

function writeStoredSettings(enabled: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const payload: StoredSettings = {
      plugins: {
        alexandriaBrowser: enabled,
      },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('[Alexandria] Failed to write stored settings', error);
  }
}

export const useAlexandriaSettings = create<AlexandriaSettingsState>((set) => ({
  enabled: readStoredSettings(),
  setEnabled: (value: boolean) => {
    writeStoredSettings(value);
    set({ enabled: value });
  },
  refresh: () => {
    set({ enabled: readStoredSettings() });
  },
}));

export function isAlexandriaEnabled(): boolean {
  return useAlexandriaSettings.getState().enabled;
}
