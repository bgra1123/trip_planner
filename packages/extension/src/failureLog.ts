import type { ExtractionFailure } from "./types.js";

const STORAGE_KEY = "extractionFailures";
const MAX_ENTRIES = 50;

export async function recordFailures(failures: ExtractionFailure[]): Promise<void> {
  if (failures.length === 0) return;
  const existing = await readFailures();
  const combined = [...failures, ...existing].slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [STORAGE_KEY]: combined });
}

export async function readFailures(): Promise<ExtractionFailure[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as ExtractionFailure[] | undefined) ?? [];
}

export async function clearFailures(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
