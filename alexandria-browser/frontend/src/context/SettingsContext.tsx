import { createContext, useContext, useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { NSFW_KEYWORDS } from "../data/nsfwKeywords";

export interface SettingsContextValue {
  filterNSFW: boolean;
  setFilterNSFW: Dispatch<SetStateAction<boolean>>;
  toggleNSFW: () => void;
  nsfwKeywords: string[];
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

interface SettingsProviderProps {
  filterNSFW: boolean;
  setFilterNSFW: Dispatch<SetStateAction<boolean>>;
  children: ReactNode;
}

export function SettingsProvider({ filterNSFW, setFilterNSFW, children }: SettingsProviderProps) {
  const value = useMemo<SettingsContextValue>(
    () => ({
      filterNSFW,
      setFilterNSFW,
      toggleNSFW: () => setFilterNSFW((previous) => !previous),
      nsfwKeywords: NSFW_KEYWORDS
    }),
    [filterNSFW, setFilterNSFW]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
