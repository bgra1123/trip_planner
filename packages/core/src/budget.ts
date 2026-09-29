import type { Item, Trip } from "./schema.js";

export type BudgetSummary = {
  total: number | null;
  committed: number;
  tentative: number;
  remaining: number | null;
};

function sumCost(items: Item[]): number {
  return items.reduce((sum, item) => sum + (item.cost?.amount ?? 0), 0);
}

export function deriveBudget(
  trip: Pick<Trip, "budget_total">,
  items: Item[],
): BudgetSummary {
  const committed = sumCost(items.filter((item) => item.status === "booked"));
  const tentative = sumCost(items.filter((item) => item.status === "shortlisted"));
  // "Remaining" nets out both what's already spent and what's likely to be spent,
  // so the budget strip can turn red on a shortlist that would blow the budget.
  const remaining = trip.budget_total === null ? null : trip.budget_total - committed - tentative;

  return { total: trip.budget_total, committed, tentative, remaining };
}
