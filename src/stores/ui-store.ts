import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Language = "en" | "ru";

interface UIState {
  // Language
  language: Language;
  setLanguage: (lang: Language) => void;

  // Selected Person
  selectedPersonId: string | null;
  setSelectedPersonId: (id: string | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      language: "en",
      setLanguage: (lang) => set({ language: lang }),

      selectedPersonId: null,
      setSelectedPersonId: (id) => set({ selectedPersonId: id }),
    }),
    {
      name: "app.settings",
      partialize: (state) => ({
        language: state.language,
        selectedPersonId: state.selectedPersonId,
      }),
    }
  )
);
