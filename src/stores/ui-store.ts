import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Language = "en" | "ru";

interface UIState {
  // Language
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      language: "en",
      setLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: "app.lang",
      partialize: (state) => ({ language: state.language }),
    }
  )
);
