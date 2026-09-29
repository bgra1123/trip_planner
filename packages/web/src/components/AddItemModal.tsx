import { useState } from "react";
import { resolvePlace, type ItemType } from "@trip-memory/core";
import { createItem, type Credentials } from "../api.js";
import { PlusIcon, XIcon } from "./icons.js";

const TYPE_OPTIONS: { value: ItemType; label: string }[] = [
  { value: "accommodation", label: "Stay" },
  { value: "transport", label: "Transport" },
  { value: "activity", label: "Activity" },
  { value: "meal", label: "Meal" },
  { value: "note", label: "Note" },
];

function toIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function AddItemModal({
  credentials,
  initialSegmentId = null,
  lockedType,
  onClose,
  onAdded,
}: {
  credentials: Credentials;
  /** Pre-targets a node (segment) instead of landing unassigned in the Inbox. */
  initialSegmentId?: string | null;
  /** When set (adding a candidate option to a node), the type picker is replaced
   *  by a fixed label instead of being freely selectable. */
  lockedType?: ItemType;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [type, setType] = useState<ItemType>(lockedType ?? "accommodation");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give it a title first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createItem(credentials, {
        segment_id: initialSegmentId,
        type,
        status: "idea",
        title: title.trim(),
        place_ref: placeName.trim() ? resolvePlace({ name: placeName.trim(), address: placeAddress.trim() || null }) : null,
        starts_at: toIso(startsAt),
        ends_at: toIso(endsAt),
        cost: amount && currency ? { amount: Number(amount), currency: currency.toUpperCase() } : null,
        source: { origin: "manual", url: null, agent_name: null },
        cancellable_until: null,
        raw: null,
      });
      await onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-auto bg-slate-900/40 p-12">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[460px] shrink-0 rounded-2xl bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.14)]"
      >
        <div className="mb-1 flex items-start justify-between">
          <div className="text-base font-semibold tracking-tight text-slate-900">
            {initialSegmentId ? "Add an option" : "Add a trip item"}
          </div>
          <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mb-5 text-[12.5px] text-slate-500">
          Entered manually, or captured automatically with the{" "}
          <span className="font-medium text-violet-700">Trip Memory browser extension</span> while you browse.
        </p>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Type</label>
          {lockedType ? (
            <div className="inline-flex rounded-full bg-[#fbece3] px-3.5 py-1.5 text-xs font-semibold text-[#b3542f]">
              {TYPE_OPTIONS.find((o) => o.value === lockedType)?.label}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setType(opt.value)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    type === opt.value ? "bg-[#b3542f] text-white" : "border border-slate-200 text-slate-500"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="mb-4 block">
          <span className="mb-1.5 block text-xs font-medium text-slate-700">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ribeira Riverside Guesthouse"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
          />
        </label>

        <div className="mb-4 flex gap-3">
          <label className="flex-[2]">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">Cost</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="180"
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">Currency</span>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={3}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm uppercase outline-none focus:border-slate-400"
            />
          </label>
        </div>

        <div className="mb-4 flex gap-3">
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">Starts</span>
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">Ends</span>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
        </div>

        <label className="mb-1.5 block">
          <span className="mb-1.5 block text-xs font-medium text-slate-700">Place</span>
          <input
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            placeholder="Name"
            className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
          />
          <input
            value={placeAddress}
            onChange={(e) => setPlaceAddress(e.target.value)}
            placeholder="Address (optional)"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
          />
        </label>
        <p className="mb-5 text-[11.5px] text-slate-500">
          We&apos;ll verify this against a maps provider before it&apos;s trusted — unverified places are flagged, not hidden.
        </p>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2.5">
          <button type="button" onClick={onClose} className="px-1.5 py-2 text-sm font-medium text-slate-500">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#b3542f] px-4.5 py-2 text-sm font-semibold text-white hover:bg-[#9a4527] disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
            {saving ? "Adding…" : initialSegmentId ? "Add option" : "Add to Inbox"}
          </button>
        </div>
      </form>
    </div>
  );
}
