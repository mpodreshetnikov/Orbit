import type { StoreApi, UseBoundStore } from "zustand";

type ResettableStore<T> = UseBoundStore<StoreApi<T>> & {
  getInitialState?: () => T;
};

export function resetZustandStore<T>(store: ResettableStore<T>): void {
  const initialState = typeof store.getInitialState === "function" ? store.getInitialState() : null;
  if (initialState == null) {
    store.setState(store.getState(), true);
    return;
  }
  store.setState(initialState, true);
}

export function clearPersistedStore(storageKey: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(storageKey);
}
