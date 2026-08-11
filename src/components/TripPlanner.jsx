import React, { useState, useMemo, useEffect } from 'react';
import { parseNotes, costLabel, euro, sumRange, DEFAULT_TRIP_NOTES } from '../utils/parseTripNotes';

const CAT_DOT = { travel: 'bg-blue-500', stay: 'bg-purple-500', activity: 'bg-green-500' };
const CAT_NODE = { travel: 'bg-blue-500', stay: 'bg-purple-500', activity: 'bg-green-500' };

export default function TripPlanner() {
  const [notesText, setNotesText] = useState(DEFAULT_TRIP_NOTES);
  const [selection, setSelection] = useState({ travel: {}, stay: {}, activity: {} });

  const parsed = useMemo(() => parseNotes(notesText), [notesText]);

  useEffect(() => {
    setSelection((prev) => {
      const travel = {};
      parsed.travel.forEach((g) => { travel[g.key] = prev.travel[g.key] !== undefined ? prev.travel[g.key] : 0; });
      const stay = {};
      parsed.stay.forEach((g) => { stay[g.key] = prev.stay[g.key] !== undefined ? prev.stay[g.key] : 0; });
      const activity = {};
      parsed.activities.forEach((a) => { activity[a.idx] = prev.activity[a.idx] !== undefined ? prev.activity[a.idx] : true; });
      return { travel, stay, activity };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  const travelPicks = parsed.travel.map((g) => g.options[selection.travel[g.key] || 0]);
  const stayPicks = parsed.stay.map((g) => g.options[selection.stay[g.key] || 0]);
  const activityPicks = parsed.activities.filter((a) => selection.activity[a.idx]);

  const travelRange = sumRange(travelPicks);
  const stayRange = sumRange(stayPicks);
  const activityRange = sumRange(activityPicks);
  const totalRange = {
    low: travelRange.low + stayRange.low + activityRange.low,
    high: travelRange.high + stayRange.high + activityRange.high,
  };

  const stayNights = parsed.stay.reduce((sum, g) => {
    const o = g.options[selection.stay[g.key] || 0];
    return sum + (o && o.cost && o.cost.nights ? o.cost.nights : 1);
  }, 0);

  const headerStops = [];
  parsed.travel.forEach((g) => {
    const parts = g.key.split(' → ');
    if (headerStops.length === 0) headerStops.push(parts[0]);
    headerStops.push(parts[1] || g.key);
  });

  function pickTravel(key, i) {
    setSelection((s) => ({ ...s, travel: { ...s.travel, [key]: i } }));
  }
  function pickStay(key, i) {
    setSelection((s) => ({ ...s, stay: { ...s.stay, [key]: i } }));
  }
  function toggleActivity(idx) {
    setSelection((s) => ({ ...s, activity: { ...s.activity, [idx]: !s.activity[idx] } }));
  }

  const total = parsed.travel.length + parsed.stay.length + parsed.activities.length + parsed.notes.length;

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
              onClick={() => setNotesText(DEFAULT_TRIP_NOTES)}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500"
            >
              Load example trip
            </button>
          </div>
          <p className={`mt-2 text-xs ${total === 0 ? 'text-red-600' : 'text-slate-500'}`}>
            {total === 0
              ? 'No recognizable lines yet — try FLIGHT:, TRAIN:, HOTEL:, ACTIVITY: or NOTE:.'
              : `Parsed ${parsed.travel.length} travel leg(s), ${parsed.stay.length} stay(s), ${parsed.activities.length} activit${parsed.activities.length === 1 ? 'y' : 'ies'}.`}
          </p>
        </div>

        {/* Control Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {parsed.travel.map((g) => (
            <div key={g.key} className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 mb-3 uppercase tracking-wide">
                <span className={`inline-block w-2 h-2 rounded-full ${CAT_DOT.travel}`} />
                {g.key}
              </label>
              <div className="space-y-2">
                {g.options.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => pickTravel(g.key, i)}
                    className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-all text-xs ${
                      (selection.travel[g.key] || 0) === i ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="font-semibold text-slate-900">{o.label}</p>
                    <p className="text-xs text-slate-600">
                      {[o.time.from && o.time.to ? `${o.time.from}–${o.time.to}` : o.time.from, costLabel(o)].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {parsed.stay.map((g) => (
            <div key={g.key} className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 mb-3 uppercase tracking-wide">
                <span className={`inline-block w-2 h-2 rounded-full ${CAT_DOT.stay}`} />
                {g.key} stay
              </label>
              <div className="space-y-2">
                {g.options.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => pickStay(g.key, i)}
                    className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-all text-xs ${
                      (selection.stay[g.key] || 0) === i ? 'border-purple-500 bg-purple-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="font-semibold text-slate-900">{o.label}</p>
                    <p className="text-xs text-slate-600">
                      {costLabel(o)}{o.cost && o.cost.nights > 1 ? ` · ${o.cost.nights} nights` : ''}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {parsed.activities.length > 0 && (
            <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 mb-3 uppercase tracking-wide">
                <span className={`inline-block w-2 h-2 rounded-full ${CAT_DOT.activity}`} />
                Activities
              </label>
              <div className="space-y-2">
                {parsed.activities.map((a) => (
                  <button
                    key={a.idx}
                    onClick={() => toggleActivity(a.idx)}
                    className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-all text-xs ${
                      selection.activity[a.idx] ? 'border-green-500 bg-green-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="font-semibold text-slate-900">{selection.activity[a.idx] ? '☑' : '☐'} {a.label}</p>
                    <p className="text-xs text-slate-600">{costLabel(a)}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
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
                    const o = g.options[selection.travel[item.key] || 0];
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
                    const o = g.options[selection.stay[item.key] || 0];
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

        {/* Notes */}
        {parsed.notes.length > 0 && (
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
            <h3 className="text-xs font-semibold text-amber-900 mb-2 uppercase tracking-wide">Trip Planning Notes</h3>
            <ul className="text-xs text-amber-900 space-y-1 list-disc list-inside">
              {parsed.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        )}

      </div>
    </div>
  );
}
