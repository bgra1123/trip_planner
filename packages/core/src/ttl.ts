import type { Item, ItemType } from "./schema.js";

const HOUR_MS = 60 * 60 * 1000;

/** Freshness window per item type, in hours. `null` means the item never expires. */
export const TTL_HOURS: Record<ItemType, number | null> = {
  accommodation: 48,
  transport: 24,
  activity: 24 * 90,
  meal: 24 * 90,
  note: null,
};

export function computeExpiry(type: ItemType, capturedAt: string): string | null {
  const ttl = TTL_HOURS[type];
  if (ttl === null) return null;
  return new Date(new Date(capturedAt).getTime() + ttl * HOUR_MS).toISOString();
}

export function isExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  if (expiresAt === null) return false;
  return new Date(expiresAt).getTime() <= now.getTime();
}

/**
 * Whether an item counts toward gaps/agent-context. A `booked` item is a committed
 * fact, not a price quote — it stays active even once the offer that captured it
 * would otherwise have gone stale. `rejected` items never count.
 */
export function isItemActive(
  item: Pick<Item, "status" | "expires_at">,
  now: Date = new Date(),
): boolean {
  if (item.status === "rejected") return false;
  if (item.status === "booked") return true;
  return !isExpired(item.expires_at, now);
}
