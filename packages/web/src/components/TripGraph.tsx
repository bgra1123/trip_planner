import { useState } from "react";
import { routeLabel } from "@trip-memory/core";
import type { Item, ItemStatus, ItemType, TripNode } from "@trip-memory/core";
import { ItemCard } from "./ItemCard.js";
import {
  BuildingIcon,
  CarIcon,
  ChevronDownRightIcon,
  ChevronRightIcon,
  HomeIcon,
  PencilIcon,
  PlaneIcon,
  PlusIcon,
  TrainIcon,
} from "./icons.js";

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

function groupByDay(items: Item[]): [string, Item[]][] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const day = item.starts_at ? item.starts_at.slice(0, 10) : "Unscheduled";
    const list = groups.get(day) ?? [];
    list.push(item);
    groups.set(day, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// Icon-by-category is inferred from the chosen item's title — there's no dedicated
// "mode of transport" or "accommodation type" field on Item, and adding one just to
// pick a glyph isn't worth a schema change. A title that mentions "train"/"car" is
// the same signal a person would use to tell the cards apart at a glance.
function transportIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes("train") || t.includes("rail")) return TrainIcon;
  if (t.includes("car") || t.includes("drive") || t.includes("rental")) return CarIcon;
  return PlaneIcon;
}

function accommodationIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes("airbnb") || t.includes("apartment") || t.includes("guesthouse") || t.includes("house")) {
    return HomeIcon;
  }
  return BuildingIcon;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function EditableTimeWindow({
  startsAt,
  endsAt,
  onSave,
}: {
  startsAt: string | null;
  endsAt: string | null;
  onSave: (startsAt: string, endsAt: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(startsAt ? toLocalInputValue(startsAt) : "");
  const [end, setEnd] = useState(endsAt ? toLocalInputValue(endsAt) : "");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setStart(startsAt ? toLocalInputValue(startsAt) : "");
          setEnd(endsAt ? toLocalInputValue(endsAt) : "");
          setEditing(true);
        }}
        className="group inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-[#b3542f]"
      >
        {startsAt ? new Date(startsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "?"}
        {" → "}
        {endsAt ? new Date(endsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "?"}
        <PencilIcon className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        type="datetime-local"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
      />
      <span className="text-slate-300">→</span>
      <input
        type="datetime-local"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
      />
      <button
        type="button"
        onClick={() => {
          const startIso = fromLocalInputValue(start);
          const endIso = fromLocalInputValue(end);
          if (startIso && endIso) onSave(startIso, endIso);
          setEditing(false);
        }}
        className="rounded-full bg-[#b3542f] px-2 py-0.5 text-[11px] font-semibold text-white"
      >
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-[11px] text-slate-400">
        Cancel
      </button>
    </div>
  );
}

function Connector({ direction }: { direction: "right" | "down" }) {
  return (
    <div className="flex shrink-0 items-center justify-center self-center px-1 text-slate-300">
      {direction === "right" ? <ChevronRightIcon className="h-5 w-5" /> : <ChevronDownRightIcon className="h-5 w-5" />}
    </div>
  );
}

function NodeCard({
  node,
  index,
  nodes,
  conflictedItemIds,
  onChooseOption,
  onStatusChange,
  onOpenAddOption,
  onEditTimeWindow,
}: {
  node: TripNode;
  index: number;
  nodes: TripNode[];
  conflictedItemIds: Set<string>;
  onChooseOption: (segmentId: string, itemId: string) => void;
  onStatusChange: (itemId: string, status: ItemStatus) => void;
  onOpenAddOption: (segmentId: string, candidateType: ItemType) => void;
  onEditTimeWindow: (itemId: string, startsAt: string, endsAt: string) => void;
}) {
  const isTransit = node.segment.kind === "transit";
  const label = isTransit ? routeLabel(nodes, index) : node.segment.city ?? "Stay";
  const alternates = node.candidates.filter((c) => c.id !== node.chosen?.id);
  const IconComp = node.chosen
    ? isTransit
      ? transportIcon(node.chosen.title)
      : accommodationIcon(node.chosen.title)
    : isTransit
      ? PlaneIcon
      : BuildingIcon;

  return (
    <div className="w-[290px] shrink-0 overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)]">
      <div className={`h-1.5 w-full ${isTransit ? "bg-[#e0a184]" : "bg-[#b3542f]"}`} />
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fbece3] text-[#b3542f]">
            <IconComp className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-slate-900">{label}</div>
            {node.chosen ? (
              <EditableTimeWindow
                startsAt={node.chosen.starts_at}
                endsAt={node.chosen.ends_at}
                onSave={(startsAt, endsAt) => onEditTimeWindow(node.chosen!.id, startsAt, endsAt)}
              />
            ) : (
              <div className="text-[11px] text-slate-500">
                {node.segment.start_date} → {node.segment.end_date}
              </div>
            )}
          </div>
        </div>

        {node.chosen ? (
          <ItemCard
            item={node.chosen}
            segments={[]}
            dense
            conflicted={conflictedItemIds.has(node.chosen.id)}
            onStatusChange={(status) => onStatusChange(node.chosen!.id, status)}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 p-3.5 text-center text-xs text-slate-400">
            No option chosen yet
          </div>
        )}

        {alternates.length > 0 && (
          <details className="mt-2.5">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">
              {alternates.length} other option{alternates.length > 1 ? "s" : ""}
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
              {alternates.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-slate-700">{item.title}</div>
                    {item.cost && (
                      <div className="text-[11px] text-slate-500">{money(item.cost.amount, item.cost.currency)}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onChooseOption(node.segment.id, item.id)}
                    className="shrink-0 rounded-full bg-[#b3542f] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#9a4527]"
                  >
                    Choose
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}

        <button
          type="button"
          onClick={() => onOpenAddOption(node.segment.id, node.candidateType)}
          className="mt-2.5 text-xs font-medium text-[#b3542f] hover:text-[#9a4527]"
        >
          + Add option
        </button>

        {!isTransit && node.otherItems.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 text-[10.5px] font-semibold text-slate-500">Also happening here</div>
            {groupByDay(node.otherItems).map(([day, dayItems]) => (
              <div key={day} className="mb-2.5 last:mb-0">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">{day}</div>
                <div className="flex flex-col gap-1.5">
                  {dayItems.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      segments={[]}
                      dense
                      conflicted={conflictedItemIds.has(item.id)}
                      onStatusChange={(status) => onStatusChange(item.id, status)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TripGraph({
  nodes,
  conflictedItemIds,
  onChooseOption,
  onStatusChange,
  onOpenAddOption,
  onOpenAddSegment,
  onEditTimeWindow,
}: {
  nodes: TripNode[];
  conflictedItemIds: Set<string>;
  onChooseOption: (segmentId: string, itemId: string) => void;
  onStatusChange: (itemId: string, status: ItemStatus) => void;
  onOpenAddOption: (segmentId: string, candidateType: ItemType) => void;
  onOpenAddSegment: () => void;
  onEditTimeWindow: (itemId: string, startsAt: string, endsAt: string) => void;
}) {
  if (nodes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#faf7f5] text-sm text-slate-400">
        <p>No legs yet — add the first one to start planning.</p>
        <button
          type="button"
          onClick={onOpenAddSegment}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#b3542f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9a4527]"
        >
          <PlusIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
          Add first leg
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf7f5] p-6">
      {/* A wrapping "ladder": cards flow left-to-right and wrap onto new rows as the
          container narrows, so the whole chain reflows to fit instead of scrolling
          off to the right. Alternating vertical offsets give it a staggered,
          climbing rhythm rather than a flat grid. */}
      <div className="flex flex-wrap items-start gap-x-1 gap-y-8">
        {nodes.map((node, index) => (
          <div key={node.segment.id} className={`flex items-start ${index % 2 === 1 ? "mt-9" : ""}`}>
            {index > 0 && <Connector direction="right" />}
            <NodeCard
              node={node}
              index={index}
              nodes={nodes}
              conflictedItemIds={conflictedItemIds}
              onChooseOption={onChooseOption}
              onStatusChange={onStatusChange}
              onOpenAddOption={onOpenAddOption}
              onEditTimeWindow={onEditTimeWindow}
            />
          </div>
        ))}
        <div className={`flex items-start ${nodes.length % 2 === 1 ? "mt-9" : ""}`}>
          <Connector direction="right" />
          <button
            type="button"
            onClick={onOpenAddSegment}
            className="flex h-[100px] w-[160px] shrink-0 flex-col items-center justify-center gap-1.5 self-center rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-[#b3542f] hover:text-[#b3542f]"
          >
            <PlusIcon className="h-5 w-5" />
            <span className="text-xs font-medium">Add next leg</span>
          </button>
        </div>
      </div>
    </div>
  );
}
