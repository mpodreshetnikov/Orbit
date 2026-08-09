import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const CORPUS_ROOT = path.join(REPO_ROOT, "test", "fixtures", "extraction");
export const CASES_ROOT = path.join(CORPUS_ROOT, "cases");
export const SHARED_ROOT = path.join(CORPUS_ROOT, "shared");
export const CASSETTES_ROOT = path.join(CORPUS_ROOT, "cassettes");
export const CATALOGS_PATH = path.join(SHARED_ROOT, "catalogs.json");
export const CHECKUP_ITEMS_PATH = path.join(SHARED_ROOT, "checkup-items.json");
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, ".artifacts", "extraction-eval");
