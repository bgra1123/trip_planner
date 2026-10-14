import React from 'react';

// Which trip is open, plus new / rename / delete. When TripAgent is
// connected it also shows whether the trips are in step with the server.
export default function TripBar({ trips, activeId, connected, sync, onSelect, onNew, onRename, onDelete, onSync }) {
  const active = trips.find((t) => t.id === activeId);

  function handleNew() {
    const title = window.prompt('Name the new trip', '');
    if (title === null) return;
    onNew(title);
  }
  function handleRename() {
    const title = window.prompt('Rename this trip', active ? active.title : '');
    if (title === null) return;
    onRename(title);
  }
  function handleDelete() {
    const warning = connected
      ? 'Delete this trip here and on TripAgent, so Claude no longer sees it? This cannot be undone.'
      : 'Delete this trip? This cannot be undone.';
    if (window.confirm(`${warning}\n\n${active ? active.title : ''}`)) onDelete();
  }

  const btn = 'text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500';
  return (
    <div className="bg-slate-100 px-4 pt-4" data-testid="trip-bar">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          <span>Trip</span>
          <select
            aria-label="Trip"
            value={activeId}
            onChange={(e) => onSelect(e.target.value)}
            className="normal-case text-sm text-slate-800 px-2 py-1.5 rounded-lg border border-slate-300 bg-white max-w-[14rem]"
          >
            {trips.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <button type="button" onClick={handleNew} className={btn}>New trip</button>
        <button type="button" onClick={handleRename} className={btn}>Rename</button>
        <button type="button" onClick={handleDelete} className={`${btn} hover:border-red-500 hover:text-red-600`}>Delete</button>
        {connected && (
          <span className="text-xs text-slate-500 flex items-center gap-2">
            {sync.error
              ? <span className="text-red-600">{sync.error}</span>
              : <span>{sync.busy ? 'Syncing with TripAgent…' : sync.lastSyncedAt ? 'Shared with Claude' : 'Connected to TripAgent'}</span>}
            <button type="button" onClick={onSync} disabled={sync.busy} className="text-blue-600 underline disabled:text-slate-300">Sync now</button>
          </span>
        )}
      </div>
    </div>
  );
}
