import React, { useState, useMemo, useEffect } from 'react';
import {
  groupRows, linesToRows, newRow, newRowId, bumpRowIdCounter, costLabel, euro, sumRange, enumerateCombinations,
  convertToBase, buildExportData, toMarkdown, deriveRouteChain, DEFAULT_TRIP_NOTES, costTextIssue,
} from '../utils/parseTripNotes';

function ratesToRows(rates) {
  return Object.entries(rates || {}).map(([code, factor]) => ({ id: newRowId(), code, factor: String(factor) }));
}

const STORAGE_KEY = 'trip-planner:v1';

// Reads the last-saved trip once per mount. Bumps the row-id counter past
// any restored id so a freshly added row can never collide with one that
// was persisted — the counter itself resets to 1 on every page load, but
// restored rows keep their original ids.
function loadSavedState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) return null;
    bumpRowIdCounter([
      ...data.rows.map((r) => r.id),
      ...(Array.isArray(data.rateRows) ? data.rateRows.map((r) => r.id) : []),
    ]);
    return data;
  } catch {
    return null;
  }
}

const COMBO_DISPLAY_LIMIT = 3;
const COMBO_CAP = 4000;

const CAT_NODE = { travel: 'bg-blue-500', stay: 'bg-purple-500', activity: 'bg-green-500' };

function rowGroupKey(row) {
  return row.category === 'activity' ? null : ((row.group && row.group.trim()) ? row.group.trim() : `Untitled ${row.id}`);
}

function pickedOption(group, selMap) {
  const id = selMap[group.key];
  return group.options.find((o) => o.idx === id) || group.options[0];
}

// Every non-universal window value in notes order (first-seen), scanned
// across travel and stay options. Empty when the trip has no WINDOW: tags.
function distinctWindowsOf(parsed) {
  const seen = {}; const order = [];
  const scan = (groups) => groups.forEach((g) => g.options.forEach((o) => {
    if (o.window && !seen[o.window]) { seen[o.window] = true; order.push(o.window); }
  }));
  scan(parsed.travel);
  scan(parsed.stay);
  return order;
}

// Switching the active window means "I'm planning for this date range now"
// — any pick that belongs to a different window falls back to the first
// compatible option (universal, untagged options are always compatible).
// When there are no windows at all, w === '' and every option qualifies, so
// this also subsumes the plain "fall back if the selected id was deleted"
// case for window-less trips.
function reconcileForWindow(parsed, prev, w) {
  function fix(groups, map) {
    const next = {};
    groups.forEach((g) => {
      const cur = map[g.key];
      const picked = g.options.find((o) => o.idx === cur);
      const ok = picked && (!picked.window || picked.window === w);
      next[g.key] = ok ? cur : (g.options.find((o) => !o.window || o.window === w) || g.options[0]).idx;
    });
    return next;
  }
  const activity = {};
  parsed.activities.forEach((a) => {
    activity[a.idx] = prev.activity[a.idx] !== undefined ? prev.activity[a.idx] : true;
  });
  return { travel: fix(parsed.travel, prev.travel), stay: fix(parsed.stay, prev.stay), activity };
}

export default function TripPlanner() {
  // Read once on mount; restored fields fall back to the example trip
  // individually so a partially-corrupt save still recovers gracefully.
  const [saved] = useState(loadSavedState);
  const [notesText, setNotesText] = useState(() => (saved && typeof saved.notesText === 'string') ? saved.notesText : DEFAULT_TRIP_NOTES);
  const [rows, setRows] = useState(() => (saved && Array.isArray(saved.rows)) ? saved.rows : linesToRows(DEFAULT_TRIP_NOTES).rows);
  const [notes, setNotes] = useState(() => (saved && Array.isArray(saved.notes)) ? saved.notes : linesToRows(DEFAULT_TRIP_NOTES).notes);
  const [rateRows, setRateRows] = useState(() => (saved && Array.isArray(saved.rateRows)) ? saved.rateRows : ratesToRows(linesToRows(DEFAULT_TRIP_NOTES).rates));
  const [selection, setSelection] = useState(() => (saved && saved.selection) || { travel: {}, stay: {}, activity: {} });

  const rates = useMemo(() => {
    const m = {};
    rateRows.forEach((r) => {
      const code = (r.code || '').trim().toUpperCase();
      const val = parseFloat(r.factor);
      if (code && !Number.isNaN(val)) m[code] = val;
    });
    return m;
  }, [rateRows]);

  const parsed = useMemo(() => groupRows(rows, notes, rates), [rows, notes, rates]);

  // Edit panel (notes/rates/table) is collapsed by default — fixing a
  // transcription mistake is occasional, not something a family member
  // glancing at the plan needs to see every time. It force-opens whenever
  // there's nothing to show yet (empty trip), regardless of the last toggle.
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const effectiveEditOpen = editPanelOpen || rows.length === 0;

  const [activeWindow, setActiveWindow] = useState(() => (saved && typeof saved.activeWindow === 'string') ? saved.activeWindow : null);
  const distinctWindows = useMemo(() => distinctWindowsOf(parsed), [parsed]);

  // Keep existing picks where the selected row still exists and (re)default
  // new groups/activities and the active window whenever the data changes —
  // e.g. after a row add/edit/delete, or a notes conversion.
  useEffect(() => {
    const w = distinctWindows.length
      ? (activeWindow && distinctWindows.includes(activeWindow) ? activeWindow : distinctWindows[0])
      : '';
    if (w !== activeWindow) setActiveWindow(w);
    setSelection((prev) => reconcileForWindow(parsed, prev, w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, distinctWindows]);

  function selectWindow(w) {
    setActiveWindow(w);
    setSelection((prev) => reconcileForWindow(parsed, prev, w));
  }

  // Auto-save the trip so a reload doesn't lose it. localStorage can throw
  // (private browsing, quota, disabled) — degrade to in-memory-only rather
  // than crash the app.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, notesText, rows, notes, rateRows, selection, activeWindow,
      }));
    } catch {
      // ignore — editing still works for the rest of this session
    }
  }, [notesText, rows, notes, rateRows, selection, activeWindow]);

  function convertNotesToTable() {
    const result = linesToRows(notesText);
    setRows(result.rows);
    setNotes(result.notes);
    setRateRows(ratesToRows(result.rates));
    setSelection({ travel: {}, stay: {}, activity: {} });
    setActiveWindow(null);
  }
  function addRow(category = 'travel') {
    setRows((rs) => [...rs, newRow(category)]);
  }
  function deleteRow(id) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }
  function updateRow(id, field, value) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }
  function addRateRow() {
    setRateRows((rs) => [...rs, { id: newRowId(), code: '', factor: '' }]);
  }
  function deleteRateRow(id) {
    setRateRows((rs) => rs.filter((r) => r.id !== id));
  }
  function updateRateRow(id, field, value) {
    setRateRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }
  function pickGroup(kind, groupKey, rowId) {
    setSelection((s) => ({ ...s, [kind]: { ...s[kind], [groupKey]: rowId } }));
  }
  function toggleActivity(rowId) {
    setSelection((s) => ({ ...s, activity: { ...s.activity, [rowId]: !s.activity[rowId] } }));
  }
  function applyCombo(picks) {
    setSelection((s) => {
      const travel = { ...s.travel };
      const stay = { ...s.stay };
      picks.forEach((p) => { if (p.kind === 'travel') travel[p.key] = p.option.idx; else stay[p.key] = p.option.idx; });
      return { ...s, travel, stay };
    });
  }

  const travelPicks = parsed.travel.map((g) => pickedOption(g, selection.travel));
  const stayPicks = parsed.stay.map((g) => pickedOption(g, selection.stay));
  const activityPicks = parsed.activities.filter((a) => selection.activity[a.idx]);

  const travelRange = sumRange(travelPicks, rates);
  const stayRange = sumRange(stayPicks, rates);
  const activityRange = sumRange(activityPicks, rates);
  const totalRange = {
    low: travelRange.low + stayRange.low + activityRange.low,
    high: travelRange.high + stayRange.high + activityRange.high,
  };
  const missingRates = Array.from(new Set([
    ...travelRange.missingCurrencies, ...stayRange.missingCurrencies, ...activityRange.missingCurrencies,
  ]));

  const headerStops = deriveRouteChain(parsed.travel);

  const comboGroups = useMemo(() => {
    const groups = [];
    parsed.travel.forEach((g) => groups.push({ kind: 'travel', key: g.key, options: g.options }));
    parsed.stay.forEach((g) => groups.push({ kind: 'stay', key: g.key, options: g.options }));
    return groups;
  }, [parsed]);

  const comboResult = useMemo(() => enumerateCombinations(comboGroups, rates, COMBO_CAP), [comboGroups, rates]);

  const rankedCombos = useMemo(() => {
    if (comboResult.truncated) return null;
    const withOffset = comboResult.combos.map((c) => ({
      picks: c.picks,
      low: c.low + activityRange.low,
      high: c.high + activityRange.high,
      mid: (c.low + c.high) / 2 + (activityRange.low + activityRange.high) / 2,
      window: c.window,
    }));
    withOffset.sort((a, b) => a.mid - b.mid);
    return withOffset;
  }, [comboResult, activityRange.low, activityRange.high]);

  const comboKey = (picks) => picks.map((p) => `${p.key}:${p.option.idx}`).join('|');
  const currentPicksKey = comboGroups
    .map((g) => `${g.key}:${g.kind === 'travel' ? selection.travel[g.key] : selection.stay[g.key]}`)
    .join('|');
  const currentRank = rankedCombos ? rankedCombos.findIndex((c) => comboKey(c.picks) === currentPicksKey) : -1;
  const displayCombos = rankedCombos
    ? rankedCombos.slice(0, COMBO_DISPLAY_LIMIT).map((c, i) => ({ combo: c, rank: i }))
    : [];
  if (rankedCombos && currentRank >= COMBO_DISPLAY_LIMIT) {
    displayCombos.push({ combo: rankedCombos[currentRank], rank: currentRank });
  }
  const bestForActiveWindow = rankedCombos
    ? rankedCombos.find((c) => (c.window || '') === (activeWindow || '')) || null
    : null;

  // Travel + stay groups, in trip order, filtered to only those with at
  // least one option compatible with the active window (universal or
  // tagged). Activities are intentionally excluded — the path is the
  // travel/stay itinerary; activities get their own compact chip row.
  const pathNodes = useMemo(() => {
    const nodes = [];
    parsed.timelineOrder.forEach((item) => {
      if (item.type === 'travel') {
        const g = parsed.travelGroupsByKey[item.key];
        const compat = g.options.filter((o) => !o.window || o.window === activeWindow);
        if (compat.length) nodes.push({ type: 'travel', group: g, compat });
      } else if (item.type === 'stay') {
        const g = parsed.stayGroupsByKey[item.key];
        const compat = g.options.filter((o) => !o.window || o.window === activeWindow);
        if (compat.length) nodes.push({ type: 'stay', group: g, compat });
      }
    });
    return nodes;
  }, [parsed, activeWindow]);

  // The Trip Path is the primary view, so its total is the FULL trip cost
  // (travel + stay + checked activities), not just the visualized nodes —
  // one authoritative number, matching the export total.
  const pathTotal = useMemo(() => {
    let low = 0, high = 0;
    const missing = new Set();
    pathNodes.forEach((node) => {
      const selMap = node.type === 'travel' ? selection.travel : selection.stay;
      const picked = pickedOption(node.group, selMap);
      if (!picked || !picked.cost) return;
      const converted = convertToBase(picked.cost, rates);
      if (converted.missingRate) missing.add(picked.cost.currency);
      else { low += converted.low; high += converted.high; }
    });
    parsed.activities.forEach((a) => {
      if (!selection.activity[a.idx] || !a.cost) return;
      const converted = convertToBase(a.cost, rates);
      if (converted.missingRate) missing.add(a.cost.currency);
      else { low += converted.low; high += converted.high; }
    });
    return { low, high, missingCurrencies: Array.from(missing) };
  }, [pathNodes, selection, rates, parsed.activities]);

  const total = parsed.travel.length + parsed.stay.length + parsed.activities.length + parsed.notes.length;

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function handleExportJson() {
    const data = buildExportData(parsed, selection, headerStops.length ? headerStops.join(' → ') : null);
    downloadFile('trip-plan.json', JSON.stringify(data, null, 2), 'application/json');
  }
  function handleExportMarkdown() {
    const data = buildExportData(parsed, selection, headerStops.length ? headerStops.join(' → ') : null);
    downloadFile('trip-plan.md', toMarkdown(data), 'text/markdown');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-1">Adaptive Itinerary &amp; Cost Optimizer</p>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-slate-900 mb-2">
            {headerStops.length ? headerStops.join(' → ') : 'Paste your trip notes below'}
          </h1>
          <p className="text-sm md:text-base text-slate-600">
            {headerStops.length
              ? 'Adjust the picks below. Cost and schedule recalculate as you go.'
              : 'Add flights, trains, stays and activities as plain lines — the planner extracts the data, builds the picks, and totals the cost.'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-3 mb-8 flex-wrap">
          <button
            type="button"
            onClick={() => setEditPanelOpen((v) => !v)}
            className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500"
          >
            {effectiveEditOpen ? 'Hide trip data' : 'Edit trip data'}
          </button>
          <span className="text-xs text-slate-500">Fix a transcription mistake, add options, or set exchange rates.</span>
        </div>

        {effectiveEditOpen && (
        <>
        {/* Notes input */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200 mb-8">
          <label className="block text-xs font-semibold text-slate-900 mb-2 uppercase tracking-wide">Trip Notes</label>
          <p className="text-xs text-slate-500 mb-3">
            One line per item. Start with <code className="bg-slate-100 rounded px-1">FLIGHT:</code>{' '}
            <code className="bg-slate-100 rounded px-1">TRAIN:</code> <code className="bg-slate-100 rounded px-1">BUS:</code>{' '}
            <code className="bg-slate-100 rounded px-1">HOTEL:</code> <code className="bg-slate-100 rounded px-1">ACTIVITY:</code>{' '}
            or <code className="bg-slate-100 rounded px-1">NOTE:</code>. Include a route (<code className="bg-slate-100 rounded px-1">A to B</code>),
            times (<code className="bg-slate-100 rounded px-1">6:45-11:30</code>), and a cost
            (<code className="bg-slate-100 rounded px-1">€2100</code>, <code className="bg-slate-100 rounded px-1">€250-350</code>,{' '}
            <code className="bg-slate-100 rounded px-1">€90/night x3</code>, or <code className="bg-slate-100 rounded px-1">free</code>).
            Repeat a tag with the same route/place for alternative options. Put a{' '}
            <code className="bg-slate-100 rounded px-1">WINDOW: 14-19 Aug</code> line before a block of options to tag them
            with a date range — combinations will never mix options from different windows;{' '}
            <code className="bg-slate-100 rounded px-1">WINDOW:</code> alone clears it. Costs can use other currencies
            (<code className="bg-slate-100 rounded px-1">TRY21000</code>, <code className="bg-slate-100 rounded px-1">$40</code>) —
            add a <code className="bg-slate-100 rounded px-1">RATE: TRY 0.018</code> line (EUR per unit) to convert them, or edit the
            Exchange Rates panel below directly. Costs in a currency with no rate are excluded from totals, with a warning.
          </p>
          <textarea
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[10rem] font-mono text-xs leading-relaxed p-3 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={convertNotesToTable}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Convert notes to table
            </button>
            <button
              type="button"
              onClick={() => { setNotesText(DEFAULT_TRIP_NOTES); const r = linesToRows(DEFAULT_TRIP_NOTES); setRows(r.rows); setNotes(r.notes); setRateRows(ratesToRows(r.rates)); setSelection({ travel: {}, stay: {}, activity: {} }); setActiveWindow(null); }}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500"
            >
              Load example trip
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">Converting replaces the table below — edit rows directly afterward to fix any transcription mistakes.</p>
          <p className={`mt-1 text-xs ${total === 0 ? 'text-red-600' : 'text-slate-500'}`}>
            {total === 0
              ? 'Table is empty — convert some notes or add a row.'
              : `Tracking ${parsed.travel.length} travel leg(s), ${parsed.stay.length} stay(s), ${parsed.activities.length} activit${parsed.activities.length === 1 ? 'y' : 'ies'}.`}
          </p>
        </div>

        {/* Exchange Rates */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200 mb-8">
          <label className="block text-xs font-semibold text-slate-900 mb-2 uppercase tracking-wide">Exchange Rates</label>
          <p className="text-xs text-slate-500 mb-3">
            Base currency is EUR. Enter EUR-per-unit for any other currency used in a cost (e.g. TRY = 0.018). Costs in a
            currency with no rate here are excluded from totals and combinations, never guessed as 1:1.
          </p>
          {rateRows.length === 0 ? (
            <p className="text-xs text-slate-500 mb-2">No conversion rates set — only EUR costs are included in totals.</p>
          ) : (
            <table className="text-xs mb-2">
              <thead>
                <tr className="text-slate-500 uppercase text-[0.65rem] tracking-wide">
                  <th className="text-left font-medium px-2 py-1">Currency</th>
                  <th className="text-left font-medium px-2 py-1">EUR per unit</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {rateRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={r.code}
                        onChange={(e) => updateRateRow(r.id, 'code', e.target.value.toUpperCase())}
                        placeholder="TRY"
                        maxLength={3}
                        className="w-16 font-mono text-xs px-1.5 py-1 rounded border border-slate-200 focus:border-blue-400 focus:outline-none uppercase"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={r.factor}
                        onChange={(e) => updateRateRow(r.id, 'factor', e.target.value)}
                        placeholder="0.018"
                        className="w-24 font-mono text-xs px-1.5 py-1 rounded border border-slate-200 focus:border-blue-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button type="button" onClick={() => deleteRateRow(r.id)} className="text-slate-400 hover:text-red-600 px-1" aria-label="Delete rate">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            type="button"
            onClick={addRateRow}
            className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500"
          >
            + Add rate
          </button>
          {missingRates.length > 0 && (
            <p className="text-xs text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              ⚠️ Currently-picked costs in {missingRates.join(', ')} have no rate and are excluded from the totals below.
            </p>
          )}
        </div>

        {/* Editable rows table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-8 overflow-x-auto">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              No rows yet. Convert your notes above, or{' '}
              <button type="button" onClick={() => addRow('travel')} className="text-blue-600 underline">add a row</button>{' '}
              to start typing directly.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase text-[0.65rem] tracking-wide">
                  <th className="text-left font-medium px-2 py-2">Pick</th>
                  <th className="text-left font-medium px-2 py-2">Category</th>
                  <th className="text-left font-medium px-2 py-2">Group / Leg</th>
                  <th className="text-left font-medium px-2 py-2">Window</th>
                  <th className="text-left font-medium px-2 py-2">Option</th>
                  <th className="text-left font-medium px-2 py-2">Time</th>
                  <th className="text-left font-medium px-2 py-2">Cost</th>
                  <th className="text-left font-medium px-2 py-2">Detail</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const gk = rowGroupKey(row);
                  const inputCls = 'w-full min-w-[7rem] font-mono text-xs px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none bg-transparent';
                  const costUnrecognized = costTextIssue(row.costText);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">
                        {row.category === 'activity' ? (
                          <input
                            type="checkbox"
                            checked={!!selection.activity[row.id]}
                            onChange={(e) => toggleActivity(row.id)}
                            aria-label="Include this activity"
                          />
                        ) : (
                          <input
                            type="radio"
                            name={`pick-${row.category}-${gk}`}
                            checked={selection[row.category][gk] === row.id}
                            onChange={() => pickGroup(row.category, gk, row.id)}
                            aria-label="Use this option"
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={row.category}
                          onChange={(e) => updateRow(row.id, 'category', e.target.value)}
                          className="text-xs font-mono border border-slate-200 rounded px-1 py-1"
                        >
                          <option value="travel">Travel</option>
                          <option value="stay">Stay</option>
                          <option value="activity">Activity</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className={inputCls}
                          value={row.group}
                          onChange={(e) => updateRow(row.id, 'group', e.target.value)}
                          placeholder={row.category === 'activity' ? 'n/a' : 'IST → MUN'}
                          disabled={row.category === 'activity'}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className={inputCls}
                          value={row.window}
                          onChange={(e) => updateRow(row.id, 'window', e.target.value)}
                          placeholder="any"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className={`${inputCls} min-w-[11rem]`}
                          value={row.option}
                          onChange={(e) => updateRow(row.id, 'option', e.target.value)}
                          placeholder="6:45 departure"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className={inputCls}
                          value={row.timeText}
                          onChange={(e) => updateRow(row.id, 'timeText', e.target.value)}
                          placeholder="6:45-11:30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className={costUnrecognized ? `${inputCls} border-red-300 bg-red-50` : inputCls}
                          value={row.costText}
                          onChange={(e) => updateRow(row.id, 'costText', e.target.value)}
                          placeholder="€2100 or free"
                          title={costUnrecognized ? "Not recognized as a cost — excluded from totals until fixed" : undefined}
                          aria-invalid={costUnrecognized || undefined}
                        />
                        {costUnrecognized && <span className="text-red-600 text-[0.65rem]" title="Not recognized as a cost — excluded from totals until fixed">⚠ not recognized</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className={`${inputCls} min-w-[10rem]`}
                          value={row.detail}
                          onChange={(e) => updateRow(row.id, 'detail', e.target.value)}
                          placeholder="notes"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <button type="button" onClick={() => deleteRow(row.id)} className="text-slate-400 hover:text-red-600 px-1" aria-label="Delete row">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2.5 border-t border-slate-100">
            <span className="text-xs text-slate-500">Edit any cell directly — pick one option per group, check the activities you want. Everything below updates as you go.</span>
            <button
              type="button"
              onClick={() => addRow('travel')}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500 flex-shrink-0"
            >
              + Add row
            </button>
          </div>
        </div>

        </>
        )}

        {/* Trip Path */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 md:p-6 mb-8">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
            <h2 className="text-xl font-light text-slate-900">Trip Path</h2>
            {distinctWindows.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {distinctWindows.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => selectWindow(w)}
                    className={`text-[0.65rem] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border ${
                      w === activeWindow ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-4">Travel and accommodation, in order. Swap the option at any node — the total below updates live.</p>

          {pathNodes.length === 0 ? (
            <p className="text-sm text-slate-500 italic">Nothing to show yet — add some notes above.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap bg-slate-900 text-white rounded-lg px-4 py-3 mb-4">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-[0.65rem] uppercase tracking-wide text-slate-400">
                    Trip total{activeWindow ? ` · ${activeWindow}` : ''}
                  </span>
                  <span className="text-xl font-semibold tabular-nums">
                    {euro(pathTotal.low)}{pathTotal.high !== pathTotal.low ? `–${euro(pathTotal.high)}` : ''}
                  </span>
                  {pathTotal.missingCurrencies.length > 0 && (
                    <span className="text-xs text-amber-300">⚠️ {pathTotal.missingCurrencies.join(', ')} excluded (no rate)</span>
                  )}
                </div>
                {bestForActiveWindow && (
                  <button
                    type="button"
                    onClick={() => applyCombo(bestForActiveWindow.picks)}
                    className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white flex-shrink-0"
                  >
                    Cheapest{activeWindow ? ` for ${activeWindow}` : ''}
                  </button>
                )}
              </div>

              <div className="flex items-stretch gap-2 flex-wrap">
                {pathNodes.map((node, i) => {
                  const selMap = node.type === 'travel' ? selection.travel : selection.stay;
                  const picked = pickedOption(node.group, selMap);
                  const meta = node.type === 'travel'
                    ? `${picked.time.from || '–'}–${picked.time.to || '–'}`
                    : (picked.cost && picked.cost.nights > 1 ? `${picked.cost.nights} nights` : '');
                  return (
                    <React.Fragment key={`${node.type}-${node.group.key}`}>
                      <div className="flex-1 min-w-[12rem] max-w-[16rem] bg-white border border-slate-200 rounded-lg shadow-sm p-3 flex flex-col gap-2">
                        <div className={`flex items-center gap-2 -m-3 mb-0 px-3 pt-3 pb-2 border-t-4 rounded-t-lg ${node.type === 'travel' ? 'border-blue-500' : 'border-purple-500'}`}>
                          <span className={`w-6 h-6 rounded-full ${CAT_NODE[node.type]} text-white flex items-center justify-center font-semibold text-[0.65rem] flex-shrink-0`}>{i + 1}</span>
                          <h3 className="text-sm font-semibold text-slate-900 truncate">{node.type === 'travel' ? node.group.key : `${node.group.key} stay`}</h3>
                        </div>
                        <select
                          value={picked.idx}
                          onChange={(e) => pickGroup(node.type, node.group.key, e.target.value)}
                          className="w-full text-xs font-mono border border-slate-200 rounded px-1.5 py-1"
                        >
                          {node.compat.map((o) => (
                            <option key={o.idx} value={o.idx}>{o.label}{o.window ? ` [${o.window}]` : ''}</option>
                          ))}
                        </select>
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-slate-500">{meta}</span>
                          <span className="font-semibold text-slate-900">{costLabel(picked)}</span>
                        </div>
                      </div>
                      {i < pathNodes.length - 1 && <div className="flex items-center text-slate-400">→</div>}
                    </React.Fragment>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Activities */}
        {parsed.activities.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {parsed.activities.map((a) => {
              const checked = !!selection.activity[a.idx];
              return (
                <label
                  key={a.idx}
                  className={`inline-flex items-center gap-2 text-xs rounded-full border pl-2.5 pr-3 py-1.5 cursor-pointer ${
                    checked ? 'border-green-500 bg-green-50' : 'border-slate-300 bg-white'
                  }`}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleActivity(a.idx)} />
                  <span className="text-slate-900">{a.label}</span>
                  <span className="font-mono text-slate-500">{costLabel(a)}</span>
                </label>
              );
            })}
          </div>
        )}

        {/* Cost Breakdown */}
        <details className="mb-4">
          <summary className="text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none">Cost breakdown by category</summary>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase text-[0.65rem] tracking-wide">
                  <th className="text-left font-medium pb-2">Category</th>
                  <th className="text-right font-medium pb-2">Low</th>
                  <th className="text-right font-medium pb-2">Likely</th>
                  <th className="text-right font-medium pb-2">High</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Travel', travelRange],
                  ['Accommodation', stayRange],
                  ['Activities', activityRange],
                ].map(([label, r]) => (
                  <tr key={label} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-700">{label}</td>
                    <td className="py-1.5 text-right font-semibold text-slate-900">{euro(r.low)}</td>
                    <td className="py-1.5 text-right font-semibold text-slate-900">{euro((r.low + r.high) / 2)}</td>
                    <td className="py-1.5 text-right font-semibold text-slate-900">{euro(r.high)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 font-bold">
                  <td className="py-2 text-slate-900">Total</td>
                  <td className="py-2 text-right text-slate-900">{euro(totalRange.low)}</td>
                  <td className="py-2 text-right text-slate-900">{euro((totalRange.low + totalRange.high) / 2)}</td>
                  <td className="py-2 text-right text-slate-900">{euro(totalRange.high)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-2">Likely = midpoint of each selection's own quoted range.</p>
          </div>
        </details>

        {/* Time-Window Cost Analysis */}
        {comboGroups.length >= 2 && (
        <details className="mb-6">
          <summary className="text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none">Compare all combinations</summary>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mt-2 overflow-x-auto">
            {comboResult.truncated ? (
              <p className="text-xs text-slate-500">
                {comboResult.count.toLocaleString('en-US')} possible combinations — narrow the alternatives per leg to see a ranked comparison.
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-3">
                  {rankedCombos.length.toLocaleString('en-US')} valid combination{rankedCombos.length === 1 ? '' : 's'} across your travel and stay picks, cheapest first. Click a row to apply it.
                </p>
                {comboResult.missingCurrencies && comboResult.missingCurrencies.length > 0 && (
                  <p className="text-xs text-amber-700 mb-3 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    ⚠️ Options priced in {comboResult.missingCurrencies.join(', ')} have no rate and are left out of these combinations.
                  </p>
                )}
                <table className="w-full text-xs whitespace-nowrap">
                  <thead>
                    <tr className="text-slate-500 uppercase text-[0.65rem] tracking-wide">
                      <th className="text-left font-medium pb-2 pr-3">#</th>
                      {comboGroups.map((g) => (
                        <th key={g.key} className="text-left font-medium pb-2 pr-4">{g.key}</th>
                      ))}
                      {rankedCombos.some((c) => c.window) && <th className="text-left font-medium pb-2 pr-4">Window</th>}
                      <th className="text-right font-medium pb-2 pl-4">Low</th>
                      <th className="text-right font-medium pb-2 pl-4">Likely</th>
                      <th className="text-right font-medium pb-2 pl-4">High</th>
                      <th className="pb-2 pl-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayCombos.map(({ combo, rank }) => {
                      const isCheapest = rank === 0;
                      const isCurrent = comboKey(combo.picks) === currentPicksKey;
                      const hasWindows = rankedCombos.some((c) => c.window);
                      return (
                        <tr
                          key={comboKey(combo.picks)}
                          onClick={() => applyCombo(combo.picks)}
                          className={`border-t border-slate-100 cursor-pointer hover:bg-blue-50 ${isCurrent ? 'bg-blue-50 font-semibold' : ''}`}
                        >
                          <td className="py-1.5 pr-3 text-slate-500">{isCheapest ? '★ ' : ''}{rank + 1}</td>
                          {combo.picks.map((p) => (
                            <td key={p.key} className="py-1.5 pr-4 text-slate-700">{p.option.label}</td>
                          ))}
                          {hasWindows && <td className="py-1.5 pr-4 text-slate-700">{combo.window || '—'}</td>}
                          <td className="py-1.5 pl-4 text-right text-slate-900">{euro(combo.low)}</td>
                          <td className="py-1.5 pl-4 text-right text-slate-900">{euro(combo.mid)}</td>
                          <td className="py-1.5 pl-4 text-right text-slate-900">{euro(combo.high)}</td>
                          <td className="py-1.5 pl-3">
                            {isCurrent && <span className="text-[0.65rem] uppercase tracking-wide bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">current</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </details>
        )}

        {/* Notes */}
        {parsed.notes.length > 0 && (
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
            <h3 className="text-xs font-semibold text-amber-900 mb-2 uppercase tracking-wide">Trip Planning Notes</h3>
            <ul className="text-xs text-amber-900 space-y-1 list-disc list-inside">
              {parsed.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        )}

        {/* Export */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200 mt-6">
          <label className="block text-xs font-semibold text-slate-900 mb-2 uppercase tracking-wide">Export</label>
          <p className="text-xs text-slate-500 mb-3">Download your current picks, the cost breakdown, and the full ranked combination list.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExportJson}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Download JSON
            </button>
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500"
            >
              Download Markdown
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
