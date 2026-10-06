// Collects offers from both TripAgent sources — the Chrome extension
// (push, via window.postMessage) and the backend flight proxy (pull, via
// fetch) — into one staging list.
//
// Staging is deliberate: captured offers do NOT go straight into the
// planner table. The user reviews them and adds the ones they want, so a
// bad scrape can never quietly rewrite a plan they were working on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listenForExtension, requestCapturedOffers, clearExtensionOffers, consumeBookmarkletCapture } from '../utils/tripAgentBridge.js';
import { mergeOffers, offersToRows, offersFromNotesText, normalizeOffers } from '../utils/tripAgentOffers.js';
import { searchFlights } from '../utils/tripAgentApi.js';
import { fetchPendingOffers, ackOffers } from '../utils/connectorSync.js';

const CONNECTOR_STORAGE = 'tripagent:claude-connector-url';
function readConnectorUrl() {
  try { return window.localStorage.getItem(CONNECTOR_STORAGE) || ''; } catch { return ''; }
}

export default function useTripAgent() {
  const [offers, setOffers] = useState([]);
  // Rates that arrived with a capture (a `RATE:` line in selected text). Kept
  // so the panel can tell the user which currencies still lack one, and so a
  // rate they captured isn't silently dropped.
  const [capturedRates, setCapturedRates] = useState({});
  const [extension, setExtension] = useState({ connected: false, version: null });
  const [search, setSearch] = useState({ busy: false, error: null, live: null, provider: null, sources: [], ingestedCount: 0, providerError: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const stop = listenForExtension({
      onOffers: (incoming, envelope) => {
        if (!mounted.current) return;
        setExtension((s) => (s.connected ? s : { ...s, connected: true }));
        setOffers((prev) => mergeOffers(prev, incoming));
        if (envelope && envelope.rates && Object.keys(envelope.rates).length) {
          setCapturedRates((prev) => ({ ...prev, ...envelope.rates }));
        }
      },
      onStatus: (status) => {
        if (!mounted.current) return;
        setExtension({ connected: true, version: status.version });
      },
    });
    // The listener above is what actually catches this — see
    // consumeBookmarkletCapture's own comment for why it exists.
    consumeBookmarkletCapture();
    return () => { mounted.current = false; stop(); };
  }, []);

  const runFlightSearch = useCallback(async (query) => {
    setSearch({ busy: true, error: null, live: null, provider: null });
    try {
      const result = await searchFlights(query);
      if (!mounted.current) return;
      setOffers((prev) => mergeOffers(prev, result.offers));
      setSearch({
        busy: false,
        error: result.offers.length ? null : 'Backend returned no offers for that route and date.',
        live: result.live,
        provider: result.provider,
        sources: result.sources,
        ingestedCount: result.ingestedCount,
        // The API failing while scraped portal data still answered is worth
        // saying out loud: the results are real but incomplete.
        providerError: result.providerError,
      });
    } catch (err) {
      if (!mounted.current) return;
      setSearch({ busy: false, error: err.message, live: null, provider: null });
    }
  }, []);

  // ---- Claude connector (mcp-server/) ------------------------------------
  // Options Claude recorded wait on the connector until the user adds or
  // dismisses them here; only then is the connector told to forget them.
  // Staging lives in memory, so a reload before reviewing just pulls them
  // again rather than losing them.
  const [connectorUrl, setConnectorUrlState] = useState(readConnectorUrl);
  const [connector, setConnector] = useState({ busy: false, error: null, lastCount: null });
  const connectorUrlRef = useRef(connectorUrl);
  const fromConnector = useRef(new Set());

  const pullFromClaude = useCallback(async () => {
    const url = connectorUrlRef.current;
    if (!url) return;
    setConnector((s) => ({ ...s, busy: true, error: null }));
    try {
      const incoming = normalizeOffers(await fetchPendingOffers(url), { source: 'claude' });
      if (!mounted.current) return;
      incoming.forEach((o) => fromConnector.current.add(o.id));
      if (incoming.length) setOffers((prev) => mergeOffers(prev, incoming));
      setConnector({ busy: false, error: null, lastCount: incoming.length });
    } catch (err) {
      if (!mounted.current) return;
      setConnector({ busy: false, error: err.message, lastCount: null });
    }
  }, []);

  const setConnectorUrl = useCallback((url) => {
    const value = String(url || '').trim();
    try {
      if (value) window.localStorage.setItem(CONNECTOR_STORAGE, value);
      else window.localStorage.removeItem(CONNECTOR_STORAGE);
    } catch { /* storage blocked — kept for this session only */ }
    connectorUrlRef.current = value;
    fromConnector.current = new Set();
    setConnectorUrlState(value);
    setConnector({ busy: false, error: null, lastCount: null });
  }, []);

  // Pull on open, and again whenever the tab comes back into view — the
  // usual path is: record in the Claude app, switch back here.
  useEffect(() => {
    if (!connectorUrl) return undefined;
    pullFromClaude();
    const onVisible = () => { if (document.visibilityState === 'visible') pullFromClaude(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connectorUrl, pullFromClaude]);

  const forgetOnConnector = useCallback((ids) => {
    const done = ids.filter((id) => fromConnector.current.has(id));
    if (!done.length || !connectorUrlRef.current) return;
    done.forEach((id) => fromConnector.current.delete(id));
    ackOffers(connectorUrlRef.current, done).catch((err) => {
      // Harmless if it fails: they come back on the next pull, still unreviewed.
      if (mounted.current) setConnector((s) => ({ ...s, error: err.message }));
    });
  }, []);

  const dismissOffer = useCallback((id) => {
    setOffers((prev) => prev.filter((o) => o.id !== id));
    forgetOnConnector([id]);
  }, [forgetOnConnector]);

  const clearOffers = useCallback(() => {
    forgetOnConnector(Array.from(fromConnector.current));
    setOffers([]);
    setCapturedRates({});
    clearExtensionOffers();
  }, [forgetOnConnector]);

  const refreshFromExtension = useCallback(() => { requestCapturedOffers(); }, []);

  // Trip-notes lines from somewhere other than the extension (a screenshot
  // the model transcribed) go through the same parser and into the same
  // staging list, so they are reviewed before anything reaches the plan.
  // Returns how many offers were staged.
  const stageNotes = useCallback((notesText, source) => {
    const { offers: incoming, rates } = offersFromNotesText(notesText, { source: source || 'screenshot' });
    if (incoming.length) setOffers((prev) => mergeOffers(prev, incoming));
    if (rates && Object.keys(rates).length) setCapturedRates((prev) => ({ ...prev, ...rates }));
    return incoming.length;
  }, []);

  // Hand back rows for the given offer ids and drop them from staging, so
  // an offer cannot be added to the table twice by a double click. Rows are
  // built from the rendered `offers` (not inside the state updater, which
  // React may run later or twice) and the removal is a separate update.
  //
  // `groupOverrides` ({id: group}) lets the panel apply a group the user
  // picked or confirmed for a stay whose capture had none — without this, a
  // hotel captured from a page with no parseable place silently becomes its
  // own disconnected itinerary leg instead of an alternative to compare.
  const takeRowsFor = useCallback((ids, groupOverrides = {}) => {
    const wanted = new Set(ids);
    const picked = offers
      .filter((o) => wanted.has(o.id))
      .map((o) => (groupOverrides[o.id] !== undefined ? { ...o, group: groupOverrides[o.id] } : o));
    const rows = offersToRows(picked);
    setOffers((prev) => prev.filter((o) => !wanted.has(o.id)));
    forgetOnConnector(ids);
    return rows;
  }, [offers, forgetOnConnector]);

  return {
    offers, capturedRates, extension, search, runFlightSearch, dismissOffer, clearOffers, refreshFromExtension, takeRowsFor, stageNotes,
    connectorUrl, setConnectorUrl, connector, pullFromClaude,
  };
}
