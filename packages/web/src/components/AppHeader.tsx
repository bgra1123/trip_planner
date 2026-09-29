import type { BudgetSummary } from "@trip-memory/core";
import { CompassIcon, PlusIcon } from "./icons.js";

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

export function AppHeader({
  budget,
  currency,
  tripTitle,
  onAddItem,
  onDisconnect,
}: {
  budget: BudgetSummary;
  currency: string;
  tripTitle: string;
  onAddItem: () => void;
  onDisconnect: () => void;
}) {
  const overBudget = budget.remaining !== null && budget.remaining < 0;

  return (
    <div className="flex h-[68px] shrink-0 items-center gap-7 border-b border-slate-900/[0.06] bg-white px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#fbece3] text-[#b3542f]">
          <CompassIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-900">{tripTitle}</div>
      </div>

      <div className="ml-auto flex items-center gap-5 text-sm">
        <Stat label="Total" value={budget.total === null ? "—" : money(budget.total, currency)} />
        <Stat label="Committed" value={money(budget.committed, currency)} />
        <Stat label="Tentative" value={money(budget.tentative, currency)} />
        <div className="border-l border-slate-900/[0.06] pl-4 text-right">
          <div className="text-[11px] text-slate-500">Remaining</div>
          <div className={`font-bold ${overBudget ? "text-red-600" : "text-emerald-600"}`}>
            {budget.remaining === null ? "—" : money(budget.remaining, currency)}
          </div>
        </div>
      </div>

      <button
        onClick={onAddItem}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#b3542f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9a4527]"
      >
        <PlusIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
        Add item
      </button>

      <button
        onClick={onDisconnect}
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200"
        title="Disconnect"
      >
        ×
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-medium text-slate-700">{value}</div>
    </div>
  );
}
