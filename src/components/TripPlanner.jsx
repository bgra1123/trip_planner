import React, { useState, useMemo, useEffect } from 'react';
import {
  groupRows, linesToRows, newRow, costLabel, euro, sumRange, enumerateCombinations,
  buildExportData, toMarkdown, DEFAULT_TRIP_NOTES,
} from '../utils/parseTripNotes';

const COMBO_DISPLAY_LIMIT = 12;
const COMBO_CAP = 4000;

const CAT_NODE = { travel: 'bg-blue-500', stay: 'bg-purple-500', activity: 'bg-green-500' };

function rowGroupKey(row) {
  return row.category === 'activity' ? null : ((row.group && row.group.trim()) ? row.group.trim() : `Untitled ${row.id}`);
}

function pickedOption(group, selMap) {
  const id = selMap[group.key];
  return group.options.find((o) => o.idx === id) || group.options[0];
}

export default function TripPlanner() {
  const [notesText, setNotesText] = useState(DEFAULT_TRIP_NOTES);
  const [rows, setRows] = useState(() => linesToRows(DEFAULT_TRIP_NOTES).rows);
  const [notes, setNotes] = useState(() => linesToRows(DEFAULT_TRIP_NOTES).notes);
  const [selection, setSelection] = useState({ travel: {}, stay: {}, activity: {} });

  const parsed = useMemo(() => groupRows(rows, notes), [rows, notes]);

  // Keep existing picks where the selected row still exists; default new
  // groups/activities. Runs after any row add/edit/delete.
  useEffect(() => {
    setSelection((prev) => {
      const travel = {};
      parsed.travel.forEach((g) => {
        const cur = prev.travel[g.key];
        const stillValid = cur && g.options.some((o) => o.idx === cur);
        travel[g.key] = stillValid ? cur : g.options[0].idx;
      });
      const stay = {};
      parsed.stay.forEach((g) => {
        const cur = prev.stay[g.key];
        const stillValid = cur && g.options.some((o) => o.idx === cur);
        stay[g.key] = stillValid ? cur : g.options[0].idx;
      });
      const activity = {};
      parsed.activities.forEach((a) => {
        activity[a.idx] = prev.activity[a.idx] !== undefined ? prev.activity[a.idx] : true;
      });
      return { travel, stay, activity };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  function convertNotesToTable() {
    const result = linesToRows(notesText);
    setRows(result.rows);
    setNotes(result.notes);
    setSelection({ travel: {}, stay: {}, activity: {} });
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

  const travelRange = sumRange(travelPicks);
  const stayRange = sumRange(stayPicks);
  const activityRange = sumRange(activityPicks);
  const totalRange = {
    low: travelRange.low + stayRange.low + activityRange.low,
    high: travelRange.high + stayRange.high + activityRange.high,
  };

  const stayNights = parsed.stay.reduce((sum, g) => {
    const o = pickedOption(g, selection.stay);
    return sum + (o && o.cost && o.cost.nights ? o.cost.nights : 1);
  }, 0);

  const headerStops = [];
  parsed.travel.forEach((g) => {
    const parts = g.key.split(' → ');
    if (headerStops.length === 0) headerStops.push(parts[0]);
    headerStops.push(parts[1] || g.key);
  });

  const comboGroups = useMemo(() => {
    const groups = [];
    parsed.travel.forEach((g) => groups.push({ kind: 'travel', key: g.key, options: g.options }));
    parsed.stay.forEach((g) => groups.push({ kind: 'stay', key: g.key, options: g.options }));
    return groups;
  }, [parsed]);

  const comboResult = useMemo(() => enumerateCombinations(comboGroups, COMBO_CAP), [comboGroups]);

  const rankedCombos = useMemo(() => {
    if (comboResult.truncated) return null;
    const withOffset = comboResult.combos.map((c) => ({
      picks: c.picks,
      low: c.low + activityRange.low,
      high: c.high + activityRange.high,
      mid: (c.low + c.high) / 2 + (activityRange.low + activityRange.high) / 2,
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
            Repeat a tag with the same route/place for alternative options.
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
              onClick={() => { setNotesText(DEFAULT_TRIP_NOTES); const r = linesToRows(DEFAULT_TRIP_NOTES); setRows(r.rows); setNotes(r.notes); setSelection({ travel: {}, stay: {}, activity: {} }); }}
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
                          className={inputCls}
                          value={row.costText}
                          onChange={(e) => updateRow(row.id, 'costText', e.target.value)}
                          placeholder="€2100 or free"
                        />
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

        {/* Itinerary Timeline */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 md:p-6 mb-8">
          <h2 className="text-xl font-light text-slate-900 mb-6">Itinerary</h2>

          {parsed.timelineOrder.length === 0 ? (
            <p className="text-sm text-slate-500 italic">Nothing to show yet — add some notes above.</p>
          ) : (
            <div className="space-y-6">
              {(() => {
                let n = 0;
                const rendered = [];
                parsed.timelineOrder.forEach((item, i) => {
                  const isLast = i === parsed.timelineOrder.length - 1;
                  if (item.type === 'travel') {
                    const g = parsed.travelGroupsByKey[item.key];
                    const o = pickedOption(g, selection.travel);
                    n += 1;
                    rendered.push(
                      <div key={`t-${item.key}`} className="flex gap-3 md:gap-4">
                        <div className="flex flex-col items-center flex-shrink-0">
                          <div className={`w-9 md:w-10 h-9 md:h-10 rounded-full ${CAT_NODE.travel} text-white flex items-center justify-center font-semibold text-sm`}>{n}</div>
                          {!isLast && <div className="w-1 h-12 bg-slate-300 mt-1" />}
                        </div>
                        <div className="pb-6 flex-1 min-w-0">
                          <h3 className="text-sm md:text-base font-semibold text-slate-900 mb-2">{g.key}</h3>
                          <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                            <div><p className="text-slate-600">Departure</p><p className="font-semibold text-slate-900">{o.time.from || '–'}</p></div>
                            <div><p className="text-slate-600">Arrival</p><p className="font-semibold text-slate-900">{o.time.to || '–'}</p></div>
                            <div><p className="text-slate-600">Cost</p><p className="font-semibold text-slate-900">{costLabel(o)}</p></div>
                            <div><p className="text-slate-600">Pick</p><p className="font-semibold text-slate-900">{o.label}</p></div>
                          </div>
                          {o.detail && <p className="text-xs text-slate-500">{o.detail}</p>}
                        </div>
                      </div>
                    );
                  } else if (item.type === 'stay') {
                    const g = parsed.stayGroupsByKey[item.key];
                    const o = pickedOption(g, selection.stay);
                    n += 1;
                    rendered.push(
                      <div key={`s-${item.key}`} className="flex gap-3 md:gap-4">
                        <div className="flex flex-col items-center flex-shrink-0">
                          <div className={`w-9 md:w-10 h-9 md:h-10 rounded-full ${CAT_NODE.stay} text-white flex items-center justify-center font-semibold text-sm`}>{n}</div>
                          {!isLast && <div className="w-1 h-12 bg-slate-300 mt-1" />}
                        </div>
                        <div className="pb-6 flex-1 min-w-0">
                          <h3 className="text-sm md:text-base font-semibold text-slate-900 mb-2">{g.key} stay</h3>
                          <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                            <div><p className="text-slate-600">Pick</p><p className="font-semibold text-slate-900">{o.label}</p></div>
                            <div><p className="text-slate-600">Cost</p><p className="font-semibold text-slate-900">{costLabel(o)}{o.cost && o.cost.nights > 1 ? ` (${o.cost.nights} nights)` : ''}</p></div>
                          </div>
                          {o.detail && <p className="text-xs text-slate-500">{o.detail}</p>}
                        </div>
                      </div>
                    );
                  } else if (item.type === 'activity') {
                    const a = parsed.activities.find((x) => x.idx === item.id);
                    if (a && selection.activity[a.idx]) {
                      n += 1;
                      rendered.push(
                        <div key={`a-${a.idx}`} className="flex gap-3 md:gap-4">
                          <div className="flex flex-col items-center flex-shrink-0">
                            <div className={`w-9 md:w-10 h-9 md:h-10 rounded-full ${CAT_NODE.activity} text-white flex items-center justify-center font-semibold text-sm`}>{n}</div>
                            {!isLast && <div className="w-1 h-12 bg-slate-300 mt-1" />}
                          </div>
                          <div className="pb-6 flex-1 min-w-0">
                            <h3 className="text-sm md:text-base font-semibold text-slate-900 mb-1">{a.label}</h3>
                            <p className="text-xs text-slate-500">{costLabel(a)}{a.detail ? ` · ${a.detail}` : ''}</p>
                          </div>
                        </div>
                      );
                    }
                  }
                });
                return rendered;
              })()}
            </div>
          )}
        </div>

        {/* Cost Breakdown & Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold text-amber-700 mb-3 uppercase tracking-wide">Cost Breakdown</h3>
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

          <div className="bg-slate-100 rounded-lg p-4 border border-slate-300">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Trip Summary</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-600">Travel legs</span><span className="font-semibold text-slate-900">{parsed.travel.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Nights booked</span><span className="font-semibold text-slate-900">{stayNights}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Activities picked</span><span className="font-semibold text-slate-900">{activityPicks.length} of {parsed.activities.length}</span></div>
            </div>
          </div>
        </div>

        {/* Time-Window Cost Analysis */}
        {comboGroups.length >= 2 && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6 overflow-x-auto">
            <h3 className="text-sm font-semibold text-amber-700 mb-1 uppercase tracking-wide">Time-Window Cost Analysis</h3>
            {comboResult.truncated ? (
              <p className="text-xs text-slate-500">
                {comboResult.count.toLocaleString('en-US')} possible combinations — narrow the alternatives per leg to see a ranked comparison.
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-3">
                  {rankedCombos.length.toLocaleString('en-US')} combination{rankedCombos.length === 1 ? '' : 's'} across your travel and stay picks, cheapest first. Click a row to apply it.
                </p>
                <table className="w-full text-xs whitespace-nowrap">
                  <thead>
                    <tr className="text-slate-500 uppercase text-[0.65rem] tracking-wide">
                      <th className="text-left font-medium pb-2 pr-3">#</th>
                      {comboGroups.map((g) => (
                        <th key={g.key} className="text-left font-medium pb-2 pr-4">{g.key}</th>
                      ))}
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
