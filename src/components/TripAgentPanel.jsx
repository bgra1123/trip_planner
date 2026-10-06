import React, { useState } from 'react';
import useTripAgent from '../hooks/useTripAgent.js';
import { offerCostText, rowCostIsParseable, offerPreviewRow, currenciesNeedingRate, offerFromLink, offerToRow, categoryForKind, rowFromQuickEntry } from '../utils/tripAgentOffers.js';
import { costTextIssue } from '../utils/parseTripNotes.js';
import { extractNotesFromImages, withWindow } from '../utils/screenshotExtract.js';
import { imageFileToUpload } from '../utils/imageForUpload.js';

// The user's own Anthropic key, kept only in this browser. localStorage can
// throw (private browsing, blocked storage), so every access is guarded and
// the panel still works with a key typed in for this session only.
const KEY_STORAGE = 'tripagent:anthropic-api-key';
function readStoredKey() {
  try { return window.localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
function writeStoredKey(value) {
  try {
    if (value) window.localStorage.setItem(KEY_STORAGE, value);
    else window.localStorage.removeItem(KEY_STORAGE);
  } catch { /* storage blocked — the key just isn't remembered */ }
}

const CATEGORY_WHERE_LABEL = { travel: 'Route', stay: 'Place', activity: null };
const CATEGORY_WHERE_PLACEHOLDER = { travel: 'IST → MUN', stay: 'Milan' };

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

export default function TripAgentPanel({ onAddRows, defaultWindow = '', rates = {}, existingStayGroups = [] }) {
  const { offers, capturedRates, extension, search, runFlightSearch, dismissOffer, clearOffers, refreshFromExtension, takeRowsFor, stageNotes } = useTripAgent();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ from: '', to: '', date: '', adults: '1', currency: 'EUR', window: defaultWindow });
  const [linkForm, setLinkForm] = useState({ url: '', note: '' });
  // A stay captured from a page with no parseable place arrives with an
  // empty group — left alone it becomes its own disconnected itinerary leg
  // instead of an alternative to compare (see rowGroupKey in TripPlanner).
  // When there is exactly one existing stay to compare against, default to
  // it; the field stays editable either way, before anything is added.
  const [groupOverrides, setGroupOverrides] = useState({});
  const soleExistingStayGroup = existingStayGroups.length === 1 ? existingStayGroups[0] : '';

  function groupFor(offer) {
    if (groupOverrides[offer.id] !== undefined) return groupOverrides[offer.id];
    return offer.group || soleExistingStayGroup;
  }

  // A price read off an internal system (a card's travel portal, a quote
  // email, anything the extension cannot reach) — typed straight in, added
  // immediately, no staging step, same as "Save a link as an activity".
  // Category/route/window are kept after each add rather than cleared,
  // since the realistic case is entering several options for the same leg
  // one after another (three flight times quoted on one portal page, say).
  const [quickForm, setQuickForm] = useState({ category: 'travel', group: '', option: '', time: '', cost: '', window: defaultWindow });
  function setQuickField(field, value) {
    setQuickForm((f) => ({ ...f, [field]: value }));
  }
  function handleQuickAdd(e) {
    e.preventDefault();
    const row = rowFromQuickEntry(quickForm);
    if (!row) return;
    if (onAddRows) onAddRows([row]);
    setQuickForm((f) => ({ ...f, option: '', time: '', cost: '' }));
  }
  const quickCostIssue = quickForm.cost.trim() ? costTextIssue(quickForm.cost) : null;

  // Read a screenshot — for a portal page only the user can see (logged in),
  // on any device. The model transcribes it into notes lines; those are
  // staged for review exactly like an extension capture.
  const [savedKey, setSavedKey] = useState(readStoredKey);
  const [keyDraft, setKeyDraft] = useState('');
  const [shotFiles, setShotFiles] = useState([]);
  const [shotWindow, setShotWindow] = useState(defaultWindow);
  const [shot, setShot] = useState({ busy: false, error: null, message: null });
  const fileInputRef = React.useRef(null);
  const activeKey = savedKey || keyDraft.trim();

  function saveKey() {
    const value = keyDraft.trim();
    if (!value) return;
    writeStoredKey(value);
    setSavedKey(value);
    setKeyDraft('');
  }
  function forgetKey() {
    writeStoredKey('');
    setSavedKey('');
  }
  async function handleReadScreenshots(e) {
    e.preventDefault();
    if (!shotFiles.length || !activeKey) return;
    setShot({ busy: true, error: null, message: null });
    try {
      const images = await Promise.all(shotFiles.map((f) => imageFileToUpload(f)));
      const { notes, truncated } = await extractNotesFromImages(images, { apiKey: activeKey, browser: true });
      const count = stageNotes(withWindow(notes, shotWindow), 'screenshot');
      setShot({
        busy: false,
        error: null,
        message: count
          ? `Found ${count} option${count === 1 ? '' : 's'} — review ${count === 1 ? 'it' : 'them'} below before adding.${truncated ? ' The reply was cut short; some options may be missing.' : ''}`
          : 'No priced options were recognized in that screenshot. Type the price in with Quick Add above instead.',
      });
      setShotFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setShot({ busy: false, error: err.message || String(err), message: null });
    }
  }

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setLinkField(field, value) {
    setLinkForm((f) => ({ ...f, [field]: value }));
  }

  function handleSearch(e) {
    e.preventDefault();
    runFlightSearch(form);
  }

  // Straight to the table, the same shape a captured price already takes —
  // no staging step, since typing the note and clicking "Save as activity"
  // already is the review step.
  function handleSaveLink(e) {
    e.preventDefault();
    const offer = offerFromLink(linkForm.url, linkForm.note);
    if (!offer) return;
    if (onAddRows) onAddRows([offerToRow(offer)]);
    setLinkForm({ url: '', note: '' });
  }

  function addOffers(ids) {
    const overrides = {};
    ids.forEach((id) => {
      const offer = offers.find((o) => o.id === id);
      if (offer && categoryForKind(offer.kind) === 'stay') overrides[id] = groupFor(offer);
    });
    const rows = takeRowsFor(ids, overrides);
    if (rows.length && onAddRows) onAddRows(rows);
  }

  const unparseable = offers.filter((o) => !rowCostIsParseable(offerPreviewRow(o))).length;
  // A price in a foreign currency is written faithfully, but the planner can
  // only put it in a total once a conversion rate exists. Rates already set on
  // the trip, plus any that arrived with a capture, both count.
  const missingRates = currenciesNeedingRate(offers, { ...rates, ...capturedRates });

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
          <datalist id="tripagent-existing-stay-groups">
            {existingStayGroups.map((g) => <option key={g} value={g} />)}
          </datalist>
          <p className="text-xs text-slate-500 mb-3">
            Offers captured by the browser extension or fetched from the backend land here first. Nothing reaches
            your table until you add it, so a bad scrape can never rewrite a plan you are working on.
          </p>

          {/* Type in a price — for anything the extension cannot reach: a
              bank portal's own page, a quote by email, a price read over the
              phone. Added straight to the table, same as "Save a link as an
              activity" — typing it already is the review step. Category,
              route and window stay filled in after each add, since entering
              a few options off one portal page is the realistic case. */}
          <form onSubmit={handleQuickAdd} className="flex flex-wrap items-end gap-2 mb-2 pb-3 border-b border-slate-100">
            <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
              <span className="block mb-1">Kind</span>
              <select
                value={quickForm.category}
                onChange={(e) => setQuickField('category', e.target.value)}
                className="text-xs font-mono px-1.5 py-1.5 rounded border border-slate-300"
              >
                <option value="travel">Travel</option>
                <option value="stay">Stay</option>
                <option value="activity">Activity</option>
              </select>
            </label>
            {CATEGORY_WHERE_LABEL[quickForm.category] && (
              <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                <span className="block mb-1">{CATEGORY_WHERE_LABEL[quickForm.category]}</span>
                <input
                  type="text"
                  list={quickForm.category === 'stay' ? 'tripagent-existing-stay-groups' : undefined}
                  value={quickForm.group}
                  onChange={(e) => setQuickField('group', e.target.value)}
                  placeholder={CATEGORY_WHERE_PLACEHOLDER[quickForm.category]}
                  className="w-28 font-mono text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
                />
              </label>
            )}
            <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
              <span className="block mb-1">Option</span>
              <input
                type="text"
                value={quickForm.option}
                onChange={(e) => setQuickField('option', e.target.value)}
                placeholder={quickForm.category === 'stay' ? 'Family room' : (quickForm.category === 'activity' ? 'City tour' : '07:25 departure')}
                className="w-32 text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
              />
            </label>
            {quickForm.category !== 'activity' && (
              <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                <span className="block mb-1">Time</span>
                <input
                  type="text"
                  value={quickForm.time}
                  onChange={(e) => setQuickField('time', e.target.value)}
                  placeholder="07:25-09:40"
                  className="w-24 font-mono text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
                />
              </label>
            )}
            <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
              <span className="block mb-1">Price</span>
              <input
                type="text"
                value={quickForm.cost}
                onChange={(e) => setQuickField('cost', e.target.value)}
                placeholder="€245 or free"
                title={quickCostIssue ? 'Not recognized as a price — it will still be added, flagged for you to fix' : undefined}
                className={`w-24 font-mono text-xs px-2 py-1.5 rounded border focus:outline-none normal-case ${
                  quickCostIssue ? 'border-red-300 bg-red-50' : 'border-slate-300 focus:border-blue-400'
                }`}
              />
            </label>
            <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
              <span className="block mb-1">Window</span>
              <input
                type="text"
                value={quickForm.window}
                onChange={(e) => setQuickField('window', e.target.value)}
                placeholder="14-19 Aug"
                className="w-24 font-mono text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
              />
            </label>
            <button
              type="submit"
              disabled={!quickForm.option.trim() && !quickForm.group.trim() && !quickForm.cost.trim()}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              Add to table
            </button>
          </form>
          <p className="text-xs text-slate-500 mb-3">
            Got a price from your own card portal, an email quote, or anywhere else the extension cannot reach?
            Type it straight in — it's added to the table immediately, exactly like any other row, and you can
            keep entering more options for the same {quickForm.category === 'stay' ? 'stay' : 'leg'} right after.
          </p>

          {/* Read a screenshot — the capture path that works on any device,
              iPhone included, for pages only the user can see. */}
          <form onSubmit={handleReadScreenshots} className="mb-2 pb-3 border-b border-slate-100">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                <span className="block mb-1">Screenshot</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setShotFiles(Array.from(e.target.files || []))}
                  className="text-xs normal-case max-w-[14rem]"
                  aria-label="Screenshot of search results"
                />
              </label>
              <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                <span className="block mb-1">Window</span>
                <input
                  type="text"
                  value={shotWindow}
                  onChange={(e) => setShotWindow(e.target.value)}
                  placeholder="14-19 Aug"
                  className="w-24 font-mono text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
                />
              </label>
              {!savedKey && (
                <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                  <span className="block mb-1">Anthropic API key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="sk-ant-..."
                    className="w-40 font-mono text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
                  />
                </label>
              )}
              {!savedKey && (
                <button
                  type="button"
                  onClick={saveKey}
                  disabled={!keyDraft.trim()}
                  className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500 disabled:text-slate-300"
                >
                  Remember key
                </button>
              )}
              <button
                type="submit"
                disabled={shot.busy || !shotFiles.length || !activeKey}
                className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {shot.busy ? `Reading ${shotFiles.length > 1 ? `${shotFiles.length} screenshots` : 'screenshot'}…` : 'Read screenshot'}
              </button>
            </div>
            {savedKey && (
              <p className="text-xs text-slate-500 mt-2">
                API key saved in this browser only.{' '}
                <button type="button" onClick={forgetKey} className="text-blue-600 underline">Forget it</button>
              </p>
            )}
            {shot.error && <p className="text-xs text-red-600 mt-2">{shot.error}</p>}
            {shot.message && <p className="text-xs text-green-700 mt-2">{shot.message}</p>}
          </form>
          <p className="text-xs text-slate-500 mb-3">
            Screenshot your card portal's results (it only shows prices to you, logged in — no server can see
            that page, but it can read a picture of it). Claude reads the screenshot into options you review
            below before anything is added; a few cents per screenshot on your own Anthropic key, which is
            sent only to api.anthropic.com and never to this site. Use a dedicated key with a spend limit set at
            console.anthropic.com.
          </p>

          {/* Save a link as an activity — a reel, a blog post, a listing, plus
              the user's own note about it. Nothing at the link is fetched or
              parsed; the note is the whole description, and the link is kept
              (never dropped) by folding it into the saved row's detail text. */}
          <form onSubmit={handleSaveLink} className="flex flex-wrap items-end gap-2 mb-2 pb-3 border-b border-slate-100">
            <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
              <span className="block mb-1">Link</span>
              <input
                type="text"
                value={linkForm.url}
                onChange={(e) => setLinkField('url', e.target.value)}
                placeholder="https://..."
                className="w-56 font-mono text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
              />
            </label>
            <label className="text-[0.65rem] uppercase tracking-wide text-slate-500">
              <span className="block mb-1">What you liked</span>
              <input
                type="text"
                value={linkForm.note}
                onChange={(e) => setLinkField('note', e.target.value)}
                placeholder="Rooftop bar with sunset views"
                className="w-56 text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
              />
            </label>
            <button
              type="submit"
              disabled={!linkForm.url.trim() || !linkForm.note.trim()}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-slate-300"
            >
              Save as activity
            </button>
          </form>
          <p className="text-xs text-slate-500 mb-3">
            Paste a link and your own short note about it — it's added straight to the table as an activity, with the
            link kept in its detail so it's never lost.
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
          {search.providerError && (
            <p className="text-xs text-amber-700 mb-2">
              The flight API failed ({search.providerError}) — results below are from captured portal data only.
            </p>
          )}
          {search.sources && search.sources.length > 0 && (
            <p className="text-xs text-slate-500 mb-2">
              Answered by {search.sources.join(', ')}
              {search.ingestedCount ? ` · ${search.ingestedCount} from captured bank-portal data` : ''}.
            </p>
          )}
          {search.live === false && (
            <p className="text-xs text-amber-700 mb-2">
              Backend answered with sample data — set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET for live prices.
            </p>
          )}

          {/* Staged offers */}
          {offers.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              Nothing captured yet. Install the extension from <code className="bg-slate-100 rounded px-1">extension/</code>, then
              browse a flight or hotel search — or run a backend search above. On iPhone, the extension
              can't run at all (no browser there supports one) — use the <a href="./capture.html" className="text-blue-600 underline not-italic">capture bookmarklet</a> instead.
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
                          <td className="px-2 py-1.5 font-mono text-slate-700">
                            {categoryForKind(o.kind) === 'stay' ? (
                              <>
                                <input
                                  type="text"
                                  list="tripagent-existing-stay-groups"
                                  value={groupFor(o)}
                                  onChange={(e) => setGroupOverrides((m) => ({ ...m, [o.id]: e.target.value }))}
                                  placeholder="e.g. Milan"
                                  title="Which stay is this an alternative for? Pick an existing one from the list, or type a new city if this is really a different stop. Left blank, it becomes its own separate leg of the trip."
                                  className={`w-24 px-1 py-0.5 rounded border focus:outline-none normal-case ${
                                    groupFor(o) ? 'border-transparent hover:border-slate-200 focus:border-blue-400' : 'border-amber-300 bg-amber-50'
                                  }`}
                                />
                                {!groupFor(o) && existingStayGroups.length > 1 && (
                                  <div className="text-[0.6rem] text-amber-700 mt-0.5">pick a stay above, or it adds as a new one</div>
                                )}
                              </>
                            ) : (o.group || '—')}
                          </td>
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
                  {unparseable} offer{unparseable === 1 ? ' has' : 's have'} a price the planner cannot read —
                  the captured amount is kept in the row's detail so you can retype it.
                </p>
              )}
              {missingRates.length > 0 && (
                <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  ⚠️ No conversion rate for {missingRates.join(', ')}. These prices are captured correctly, but stay
                  out of your totals until you add one: open <strong>Edit trip data</strong>, then under{' '}
                  <strong>Exchange Rates</strong> click <code className="bg-amber-100 rounded px-1">+ Add rate</code> —
                  it only adds the rate, nothing else on your table changes.
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
