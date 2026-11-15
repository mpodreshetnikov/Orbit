import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const CORPUS_ROOT = path.join(REPO_ROOT, "test", "fixtures", "money-categorization");
export const CASES_ROOT = path.join(CORPUS_ROOT, "cases");
export const SHARED_ROOT = path.join(CORPUS_ROOT, "shared");
export const CASSETTES_ROOT = path.join(CORPUS_ROOT, "cassettes");
export const CATEGORIES_PATH = path.join(SHARED_ROOT, "categories.json");
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, ".artifacts", "money-categorization-eval");
