// Collects offers from both TripAgent sources — the Chrome extension
// (push, via window.postMessage) and the backend flight proxy (pull, via
// fetch) — into one staging list.
//
// Staging is deliberate: captured offers do NOT go straight into the
// planner table. The user reviews them and adds the ones they want, so a
// bad scrape can never quietly rewrite a plan they were working on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listenForExtension, requestCapturedOffers, clearExtensionOffers } from '../utils/tripAgentBridge.js';
import { mergeOffers, offersToRows } from '../utils/tripAgentOffers.js';
import { searchFlights } from '../utils/tripAgentApi.js';

export default function useTripAgent() {
  const [offers, setOffers] = useState([]);
  const [extension, setExtension] = useState({ connected: false, version: null });
  const [search, setSearch] = useState({ busy: false, error: null, live: null, provider: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const stop = listenForExtension({
      onOffers: (incoming) => {
        if (!mounted.current) return;
        setExtension((s) => (s.connected ? s : { ...s, connected: true }));
        setOffers((prev) => mergeOffers(prev, incoming));
      },
      onStatus: (status) => {
        if (!mounted.current) return;
        setExtension({ connected: true, version: status.version });
      },
    });
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
    clearExtensionOffers();
  }, []);

  const refreshFromExtension = useCallback(() => { requestCapturedOffers(); }, []);

  // Hand back rows for the given offer ids and drop them from staging, so
  // an offer cannot be added to the table twice by a double click. Rows are
  // built from the rendered `offers` (not inside the state updater, which
  // React may run later or twice) and the removal is a separate update.
  const takeRowsFor = useCallback((ids) => {
    const wanted = new Set(ids);
    const rows = offersToRows(offers.filter((o) => wanted.has(o.id)));
    setOffers((prev) => prev.filter((o) => !wanted.has(o.id)));
    return rows;
  }, [offers]);

  return { offers, extension, search, runFlightSearch, dismissOffer, clearOffers, refreshFromExtension, takeRowsFor };
}
