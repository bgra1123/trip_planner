import { useMemo, useState } from "react";
import type { ItemStatus, ItemType } from "@trip-memory/core";
import { CredentialsGate } from "./components/CredentialsGate.js";
import { AppHeader } from "./components/AppHeader.js";
import { AddItemModal } from "./components/AddItemModal.js";
import { AddSegmentModal } from "./components/AddSegmentModal.js";
import { Inbox } from "./components/Inbox.js";
import { TripGraph } from "./components/TripGraph.js";
import { useCredentials } from "./useCredentials.js";
import { useTripData } from "./useTripData.js";
import { updateItem } from "./api.js";

type AddItemTarget = { segmentId: string | null; lockedType?: ItemType };

export function App() {
  const { credentials, setCredentials } = useCredentials();

  if (!credentials) {
    return <CredentialsGate onConnect={setCredentials} />;
  }

  return <TripWorkspace credentials={credentials} onDisconnect={() => setCredentials(null)} />;
}

function TripWorkspace({
  credentials,
  onDisconnect,
}: {
  credentials: NonNullable<ReturnType<typeof useCredentials>["credentials"]>;
  onDisconnect: () => void;
}) {
  const { trip, segments, effectiveSegments, items, nodes, budget, gaps, conflicts, loading, error, refresh } =
    useTripData(credentials);
  const [addItemTarget, setAddItemTarget] = useState<AddItemTarget | null>(null);
  const [showAddSegment, setShowAddSegment] = useState(false);

  const conflictedItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const conflict of conflicts) for (const id of conflict.item_ids) ids.add(id);
    return ids;
  }, [conflicts]);

  async function handleStatusChange(itemId: string, status: ItemStatus) {
    await updateItem(credentials, itemId, { status });
    await refresh();
  }

  async function handleAssign(itemId: string, segmentId: string) {
    await updateItem(credentials, itemId, { segment_id: segmentId });
    await refresh();
  }

  async function handleEditTimeWindow(itemId: string, startsAt: string, endsAt: string) {
    await updateItem(credentials, itemId, { starts_at: startsAt, ends_at: endsAt });
    await refresh();
  }

  async function handleChooseOption(segmentId: string, itemId: string) {
    const node = nodes.find((n) => n.segment.id === segmentId);
    const previousChosen = node?.chosen;
    if (previousChosen && previousChosen.id !== itemId) {
      // Demote to 'idea', not 'shortlisted' — shortlisted feeds the tentative
      // budget total, and this option isn't being considered anymore, it's just
      // been swapped out.
      await updateItem(credentials, previousChosen.id, { status: "idea" });
    }
    await updateItem(credentials, itemId, { status: "booked" });
    await refresh();
  }

  const nextSegmentOrder = segments.length === 0 ? 0 : Math.max(...segments.map((s) => s.order)) + 1;

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600">
        <p>Couldn't load this trip: {error}</p>
        <button onClick={onDisconnect} className="text-slate-900 underline">
          Disconnect and try again
        </button>
      </div>
    );
  }

  if (loading && !trip) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        Loading trip…
      </div>
    );
  }

  if (!trip) return null;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <AppHeader
        budget={budget!}
        currency={trip.currency}
        tripTitle={trip.title}
        onAddItem={() => setAddItemTarget({ segmentId: null })}
        onDisconnect={onDisconnect}
      />
      <div className="flex min-h-0 flex-1 bg-white">
        <Inbox
          items={items}
          segments={effectiveSegments}
          conflictedItemIds={conflictedItemIds}
          onStatusChange={handleStatusChange}
          onAssign={handleAssign}
        />
        <TripGraph
          nodes={nodes}
          conflictedItemIds={conflictedItemIds}
          onChooseOption={handleChooseOption}
          onStatusChange={handleStatusChange}
          onOpenAddOption={(segmentId, candidateType) => setAddItemTarget({ segmentId, lockedType: candidateType })}
          onOpenAddSegment={() => setShowAddSegment(true)}
          onEditTimeWindow={handleEditTimeWindow}
        />
      </div>

      {gaps.length > 0 && (
        <div className="border-t border-slate-900/[0.06] bg-white px-5 py-2 text-[11px] text-slate-400">
          {gaps.length} open gap{gaps.length > 1 ? "s" : ""} in this trip
        </div>
      )}

      {addItemTarget && (
        <AddItemModal
          credentials={credentials}
          initialSegmentId={addItemTarget.segmentId}
          lockedType={addItemTarget.lockedType}
          onClose={() => setAddItemTarget(null)}
          onAdded={refresh}
        />
      )}

      {showAddSegment && (
        <AddSegmentModal
          credentials={credentials}
          nextOrder={nextSegmentOrder}
          onClose={() => setShowAddSegment(false)}
          onAdded={refresh}
        />
      )}
    </div>
  );
}
