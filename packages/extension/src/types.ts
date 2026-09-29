import type { ItemType } from "@trip-memory/core";

export type PlaceGuess = { name: string; address?: string | null; city?: string | null };

/** What an adapter pulls off a page — a partial Item, not yet a trusted one. */
export type ExtractedCandidate = {
  type: ItemType;
  title: string;
  cost: { amount: number; currency: string } | null;
  starts_at: string | null;
  ends_at: string | null;
  place_guess: PlaceGuess | null;
  url: string;
  /** Whatever the adapter scraped, kept for debugging when extraction goes wrong. */
  raw: unknown;
};

export type Adapter = {
  id: string;
  /** Bumped whenever the extraction logic changes, so failures can be traced to a version. */
  version: number;
  matches(url: string): boolean;
  extract(document: Document, url: string): ExtractedCandidate | null;
};

export type ExtractionFailure = {
  adapterId: string;
  adapterVersion: number;
  url: string;
  message: string;
  at: string;
};
