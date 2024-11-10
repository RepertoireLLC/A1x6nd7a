import { create } from 'zustand';

export type ThemeType = 'classic' | 'neon' | 'galaxy' | 'matrix' | 'minimal';

interface ThemeState {
  currentTheme: ThemeType;
  setTheme: (theme: ThemeType) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  currentTheme: 'classic',
  setTheme: (theme) => set({ currentTheme: theme }),
}));