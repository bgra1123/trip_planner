// Collects offers from both TripAgent sources — the Chrome extension
// (push, via window.postMessage) and the backend flight proxy (pull, via
// fetch) — into one staging list.
//
// Staging is deliberate: captured offers do NOT go straight into the
// planner table. The user reviews them and adds the ones they want, so a
// bad scrape can never quietly rewrite a plan they were working on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listenForExtension, requestCapturedOffers, clearExtensionOffers, consumeBookmarkletCapture } from '../utils/tripAgentBridge.js';
import { mergeOffers, offersToRows } from '../utils/tripAgentOffers.js';
import { searchFlights } from '../utils/tripAgentApi.js';

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

  const dismissOffer = useCallback((id) => {
    setOffers((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const clearOffers = useCallback(() => {
    setOffers([]);
    setCapturedRates({});
    clearExtensionOffers();
  }, []);

  const refreshFromExtension = useCallback(() => { requestCapturedOffers(); }, []);

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
    return rows;
  }, [offers]);

  return { offers, capturedRates, extension, search, runFlightSearch, dismissOffer, clearOffers, refreshFromExtension, takeRowsFor };
}
