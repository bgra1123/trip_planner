import React, { useState } from 'react';
import useTripAgent from '../hooks/useTripAgent.js';
import { offerCostText, rowCostIsParseable, offerPreviewRow } from '../utils/tripAgentOffers.js';

const KIND_BADGE = {
  flight: 'bg-blue-100 text-blue-700',
  train: 'bg-blue-100 text-blue-700',
  hotel: 'bg-purple-100 text-purple-700',
  stay: 'bg-purple-100 text-purple-700',
  activity: 'bg-green-100 text-green-700',
};

// Cost as it will read in the table, or an honest "n/a" when the captured
// currency is not one the planner's cost parser understands.
function priceLabel(offer) {
  const text = offerCostText(offer);
  if (text) return text;
  if (offer.price) return `${offer.price.currency} ${offer.price.low}${offer.price.high !== offer.price.low ? `-${offer.price.high}` : ''} (not parseable)`;
  return 'no price';
}

export default function TripAgentPanel({ onAddRows, defaultWindow = '' }) {
  const { offers, extension, search, runFlightSearch, dismissOffer, clearOffers, refreshFromExtension, takeRowsFor } = useTripAgent();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ from: '', to: '', date: '', adults: '1', currency: 'EUR', window: defaultWindow });

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSearch(e) {
    e.preventDefault();
    runFlightSearch(form);
  }

  function addOffers(ids) {
    const rows = takeRowsFor(ids);
    if (rows.length && onAddRows) onAddRows(rows);
  }

  const unparseable = offers.filter((o) => !rowCostIsParseable(offerPreviewRow(o))).length;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-900">TripAgent capture</span>
          <span className={`text-[0.65rem] px-1.5 py-0.5 rounded-full ${extension.connected ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
            {extension.connected ? 'extension connected' : 'extension not detected'}
          </span>
          {offers.length > 0 && (
            <span className="text-[0.65rem] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {offers.length} waiting
            </span>
          )}
        </span>
        <span className="text-slate-400 text-xs flex-shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500 mb-3">
            Offers captured by the browser extension or fetched from the backend land here first. Nothing reaches
            your table until you add it, so a bad scrape can never rewrite a plan you are working on.
          </p>

          {/* Backend flight search */}
          <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-2 mb-3">
            {[
              { field: 'from', label: 'From', placeholder: 'IST', size: 'w-20' },
              { field: 'to', label: 'To', placeholder: 'MUC', size: 'w-20' },
              { field: 'date', label: 'Date', placeholder: 'YYYY-MM-DD', size: 'w-36', type: 'date' },
              { field: 'adults', label: 'Adults', placeholder: '1', size: 'w-16' },
              { field: 'window', label: 'Window tag', placeholder: '14-19 Aug', size: 'w-28' },
            ].map((f) => (
              <label key={f.field} className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                <span className="block mb-1">{f.label}</span>
                <input
                  type={f.type || 'text'}
                  value={form[f.field]}
                  onChange={(e) => setField(f.field, e.target.value)}
                  placeholder={f.placeholder}
                  className={`${f.size} font-mono text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case`}
                />
              </label>
            ))}
            <button
              type="submit"
              disabled={search.busy || !form.from || !form.to || !form.date}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              {search.busy ? 'Searching…' : 'Search flights'}
            </button>
            <button
              type="button"
              onClick={refreshFromExtension}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500"
            >
              Pull from extension
            </button>
          </form>

          {search.error && <p className="text-xs text-red-600 mb-2">{search.error}</p>}
          {search.live === false && (
            <p className="text-xs text-amber-700 mb-2">
              Backend answered with sample data — set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET for live prices.
            </p>
          )}

          {/* Staged offers */}
          {offers.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              Nothing captured yet. Install the extension from <code className="bg-slate-100 rounded px-1">extension/</code>, then
              browse a flight or hotel search — or run a backend search above.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 uppercase text-[0.65rem] tracking-wide">
                      <th className="text-left font-medium px-2 py-2">Kind</th>
                      <th className="text-left font-medium px-2 py-2">Group</th>
                      <th className="text-left font-medium px-2 py-2">Option</th>
                      <th className="text-left font-medium px-2 py-2">Time</th>
                      <th className="text-left font-medium px-2 py-2">Cost</th>
                      <th className="text-left font-medium px-2 py-2">Source</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((o) => {
                      const row = offerPreviewRow(o);
                      return (
                        <tr key={o.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5">
                            <span className={`text-[0.65rem] px-1.5 py-0.5 rounded-full ${KIND_BADGE[o.kind] || 'bg-slate-100 text-slate-600'}`}>{o.kind}</span>
                          </td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{o.group || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-900">{row.option}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{row.timeText || '—'}</td>
                          <td className={`px-2 py-1.5 font-mono ${rowCostIsParseable(row) ? 'text-slate-900' : 'text-amber-700'}`}>{priceLabel(o)}</td>
                          <td className="px-2 py-1.5 text-slate-500">
                            {o.sourceUrl
                              ? <a href={o.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-blue-600 underline">{o.source}</a>
                              : o.source}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            <button type="button" onClick={() => addOffers([o.id])} className="text-blue-600 hover:underline px-1">Add</button>
                            <button type="button" onClick={() => dismissOffer(o.id)} className="text-slate-400 hover:text-red-600 px-1" aria-label="Dismiss offer">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {unparseable > 0 && (
                <p className="text-xs text-amber-700 mt-2">
                  {unparseable} offer{unparseable === 1 ? ' has' : 's have'} a price the planner cannot total automatically —
                  the captured amount is kept in the row's detail so you can retype it.
                </p>
              )}
              <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
                <button
                  type="button"
                  onClick={() => addOffers(offers.map((o) => o.id))}
                  className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  Add all {offers.length} to table
                </button>
                <button
                  type="button"
                  onClick={clearOffers}
                  className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-red-400"
                >
                  Discard all
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
