import { DEFAULT_SESSION_TTL_MINUTES } from "./session-actions.ts";
import { createSupabaseMoneyImportRepository, type MoneyImportRepository } from "./repository.ts";

export interface MoneyImportDeps {
  repository: MoneyImportRepository;
  now?: () => Date;
  sessionTtlMinutes?: number;
}

export function createDefaultMoneyImportDeps(): MoneyImportDeps {
  return {
    repository: createSupabaseMoneyImportRepository(),
    now: () => new Date(),
    sessionTtlMinutes: DEFAULT_SESSION_TTL_MINUTES,
  };
}
