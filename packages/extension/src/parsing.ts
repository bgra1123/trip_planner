const SYMBOL_CURRENCY: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₺": "TRY",
};

/**
 * Best-effort price parse from free text like "$1,234.56", "EUR 140", "€140/night".
 * Returns null rather than guessing when nothing currency-shaped is found — an
 * unparsed price is better than a wrong one, since callers surface this as
 * unverified either way.
 */
export function parsePrice(text: string): { amount: number; currency: string } | null {
  const cleaned = text.replace(/,(?=\d{3}(\D|$))/g, "");

  const symbolMatch = cleaned.match(/([$€£¥₺])\s*(\d+(?:\.\d+)?)/);
  if (symbolMatch) {
    const currency = SYMBOL_CURRENCY[symbolMatch[1]!];
    if (currency) return { amount: Number(symbolMatch[2]), currency };
  }

  const codeMatch = cleaned.match(/\b([A-Z]{3})\s*(\d+(?:\.\d+)?)\b/);
  if (codeMatch) return { amount: Number(codeMatch[2]), currency: codeMatch[1]! };

  const trailingCodeMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\s*([A-Z]{3})\b/);
  if (trailingCodeMatch) return { amount: Number(trailingCodeMatch[1]), currency: trailingCodeMatch[2]! };

  return null;
}

/** Parses an ISO-ish date/datetime string, returning null instead of "Invalid Date". */
export function parseIsoDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
