const DAY_MS = 24 * 60 * 60 * 1000;

export function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Calendar days from `start` to `end`, inclusive of both ends, as YYYY-MM-DD strings. */
export function inclusiveDays(start: string, end: string): string[] {
  const days: string[] = [];
  let cur = new Date(`${toDateOnly(start)}T00:00:00Z`);
  const last = new Date(`${toDateOnly(end)}T00:00:00Z`);
  while (cur.getTime() <= last.getTime()) {
    days.push(toDateOnly(cur.toISOString()));
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return days;
}

export type DaySlot = "morning" | "afternoon" | "evening";

export function slotOf(iso: string): DaySlot {
  const hour = new Date(iso).getUTCHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime()
    && new Date(bStart).getTime() < new Date(aEnd).getTime();
}
