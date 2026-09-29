import type { Item, ItemStatus, Segment } from "@trip-memory/core";
import { ItemCard } from "./ItemCard.js";

const TYPE_ORDER: Item["type"][] = ["accommodation", "transport", "activity", "meal", "note"];
const TYPE_HEADING: Record<Item["type"], string> = {
  accommodation: "Accommodation",
  transport: "Transport",
  activity: "Activities",
  meal: "Meals",
  note: "Notes",
};

export function Inbox({
  items,
  segments,
  conflictedItemIds,
  onStatusChange,
  onAssign,
}: {
  items: Item[];
  segments: Segment[];
  conflictedItemIds: Set<string>;
  onStatusChange: (itemId: string, status: ItemStatus) => void;
  onAssign: (itemId: string, segmentId: string) => void;
}) {
  const unassigned = items.filter((i) => i.segment_id === null);

  return (
    <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-slate-900/[0.06] p-5">
      <h2 className="text-[13px] font-semibold text-slate-900">Inbox &middot; {unassigned.length}</h2>
      <p className="mb-5 text-xs text-slate-500">Not yet assigned to a city.</p>

      {unassigned.length === 0 && (
        <p className="text-sm text-slate-400">Nothing unassigned. Drag items here to unassign them.</p>
      )}

      {TYPE_ORDER.map((type) => {
        const group = unassigned.filter((i) => i.type === type);
        if (group.length === 0) return null;
        return (
          <div key={type} className="mb-[22px]">
            <h3 className="mb-[9px] text-[11.5px] font-semibold text-slate-500">{TYPE_HEADING[type]}</h3>
            <div className="flex flex-col gap-2.5">
              {group.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  segments={segments}
                  draggable
                  conflicted={conflictedItemIds.has(item.id)}
                  onStatusChange={(status) => onStatusChange(item.id, status)}
                  onAssign={(segmentId) => onAssign(item.id, segmentId)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
