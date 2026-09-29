import type { Item, ItemStatus, Segment } from "@trip-memory/core";
import { freshnessOf } from "../freshness.js";
import { AlertTriangleIcon, BookmarkIcon, CheckIcon, ChevronDownIcon, GlobeIcon, PencilIcon, SparkleIcon } from "./icons.js";

const FRESHNESS_DOT: Record<string, string> = {
  hot: "bg-emerald-500",
  warm: "bg-amber-500",
  cool: "bg-slate-300",
};

const TYPE_LABEL: Record<Item["type"], string> = {
  accommodation: "Stay",
  transport: "Transport",
  activity: "Activity",
  meal: "Meal",
  note: "Note",
};

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

export function ItemCard({
  item,
  segments,
  conflicted,
  dense,
  onStatusChange,
  onAssign,
  onUnassign,
  draggable,
}: {
  item: Item;
  segments: Segment[];
  conflicted?: boolean;
  dense?: boolean;
  onStatusChange: (status: ItemStatus) => void;
  onAssign?: (segmentId: string) => void;
  onUnassign?: () => void;
  draggable?: boolean;
}) {
  const freshness = freshnessOf(item);
  const agentClaimedCost =
    !item.cost && item.raw && typeof item.raw === "object" && "agent_claimed_cost" in item.raw
      ? (item.raw as { agent_claimed_cost: { amount: number; currency: string } | null }).agent_claimed_cost
      : null;

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`flex flex-col rounded-xl bg-white ${dense ? "gap-1.5 p-2.5" : "gap-2 p-3.5"} ${
        conflicted ? "ring-[1.5px] ring-red-400" : "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_1px_rgba(15,23,42,0.03)]"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span className={`font-semibold tracking-tight text-slate-900 ${dense ? "text-[13px]" : "text-sm"}`}>
          {item.title}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${FRESHNESS_DOT[freshness]}`} />
          <span className="text-[11px] text-slate-500">{freshness}</span>
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span>{TYPE_LABEL[item.type]}</span>
        <span className="text-slate-300">&middot;</span>
        <span className="capitalize">{item.status}</span>
      </div>

      {(item.source.origin === "extension" || item.source.origin === "manual" || item.place_ref?.provider === "unresolved") && (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.source.origin === "extension" && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
              <GlobeIcon className="h-2.5 w-2.5" />
              captured
            </span>
          )}
          {item.source.origin === "manual" && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
              <PencilIcon className="h-2.5 w-2.5" />
              manual entry
            </span>
          )}
          {item.place_ref?.provider === "unresolved" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
              <AlertTriangleIcon className="h-2.5 w-2.5" />
              place unverified
            </span>
          )}
        </div>
      )}

      {item.source.origin === "agent" && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
          <SparkleIcon className="h-2.5 w-2.5" />
          {item.source.agent_name ?? "agent"} proposed
        </span>
      )}

      {item.cost && <div className="text-sm font-semibold text-slate-900">{money(item.cost.amount, item.cost.currency)}</div>}
      {!item.cost && agentClaimedCost && (
        <div className="text-xs italic text-amber-700">
          agent said {money(agentClaimedCost.amount, agentClaimedCost.currency)}, unverified
        </div>
      )}

      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        {item.status !== "booked" && (
          <button
            onClick={() => onStatusChange("booked")}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800"
          >
            <CheckIcon className="h-3 w-3" strokeWidth={2.5} />
            Book
          </button>
        )}
        {item.status !== "shortlisted" && (
          <button
            onClick={() => onStatusChange("shortlisted")}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <BookmarkIcon className="h-3 w-3" />
            Shortlist
          </button>
        )}
        {onAssign && segments.length > 0 && (
          <div className="relative">
            <select
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
              defaultValue=""
              onChange={(e) => e.target.value && onAssign(e.target.value)}
            >
              <option value="" disabled>
                Assign to&hellip;
              </option>
              {segments.map((seg) => (
                <option key={seg.id} value={seg.id}>
                  {seg.city ?? (seg.kind === "transit" ? "Travel leg" : seg.kind)}
                </option>
              ))}
            </select>
            <span className="pointer-events-none inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 peer-hover:bg-slate-50">
              Assign
              <ChevronDownIcon className="h-3 w-3" />
            </span>
          </div>
        )}
        {onUnassign && (
          <button
            onClick={onUnassign}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Unassign
          </button>
        )}
        {item.status !== "rejected" && (
          <button onClick={() => onStatusChange("rejected")} className="ml-auto px-1 py-1 text-xs text-slate-400 hover:text-slate-600">
            Reject
          </button>
        )}
      </div>
    </div>
  );
}
