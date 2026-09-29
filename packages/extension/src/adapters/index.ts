import type { Adapter, ExtractedCandidate, ExtractionFailure } from "../types.js";
import { bookingComAdapter } from "./bookingComAdapter.js";
import { flightSearchAdapter } from "./flightSearchAdapter.js";
import { genericAdapter } from "./genericAdapter.js";

// Order matters: specific site adapters first, generic (always matches) last.
export const adapters: Adapter[] = [bookingComAdapter, flightSearchAdapter, genericAdapter];

export type ExtractionResult = {
  candidate: ExtractedCandidate | null;
  adapterId: string | null;
  failures: ExtractionFailure[];
};

/**
 * Tries each matching adapter in order. A thrown error is recorded and the next
 * adapter is tried rather than aborting — genericAdapter always matches and
 * always returns something, so in practice this only comes back candidate-less
 * if every single adapter throws.
 */
export function extractCandidate(
  document: Document,
  url: string,
  adapterList: Adapter[] = adapters,
): ExtractionResult {
  const failures: ExtractionFailure[] = [];

  for (const adapter of adapterList) {
    if (!adapter.matches(url)) continue;
    try {
      const candidate = adapter.extract(document, url);
      if (candidate) return { candidate, adapterId: adapter.id, failures };
    } catch (err) {
      failures.push({
        adapterId: adapter.id,
        adapterVersion: adapter.version,
        url,
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
    }
  }

  return { candidate: null, adapterId: null, failures };
}
