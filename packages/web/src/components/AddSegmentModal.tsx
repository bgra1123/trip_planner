import { useState } from "react";
import type { SegmentKind } from "@trip-memory/core";
import { createSegment, type Credentials } from "../api.js";
import { PlusIcon, XIcon } from "./icons.js";

export function AddSegmentModal({
  credentials,
  nextOrder,
  onClose,
  onAdded,
}: {
  credentials: Credentials;
  nextOrder: number;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [kind, setKind] = useState<SegmentKind>("transit");
  const [city, setCity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) {
      setError("Give it a start and end date — a fallback until an option is chosen for it.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createSegment(credentials, {
        kind,
        city: kind === "stay" && city.trim() ? city.trim() : null,
        start_date: startDate,
        end_date: endDate,
        order: nextOrder,
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
        className="w-full max-w-[400px] shrink-0 rounded-2xl bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.14)]"
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="text-base font-semibold tracking-tight text-slate-900">Add the next leg</div>
          <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Kind</label>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setKind("transit")}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                kind === "transit" ? "bg-[#b3542f] text-white" : "border border-slate-200 text-slate-500"
              }`}
            >
              Travel
            </button>
            <button
              type="button"
              onClick={() => setKind("stay")}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                kind === "stay" ? "bg-[#b3542f] text-white" : "border border-slate-200 text-slate-500"
              }`}
            >
              Stay
            </button>
          </div>
        </div>

        {kind === "stay" && (
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">City</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Porto"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
        )}

        <div className="mb-4 flex gap-3">
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">Start (fallback)</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-slate-700">End (fallback)</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
        </div>
        <p className="mb-5 text-[11.5px] text-slate-500">
          Once you choose an option for this leg, its dates take over — these are just what shows until then.
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
            {saving ? "Adding…" : "Add leg"}
          </button>
        </div>
      </form>
    </div>
  );
}
