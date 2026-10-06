// Page side of the extension bridge.
//
// The Chrome extension cannot talk to this page directly: its content
// script runs in an isolated world, so the two sides exchange
// window.postMessage envelopes and the content script relays them on to
// the service worker. Everything below is the page half of that contract —
// see extension/bridge.js for the other half and
// docs/TRIPAGENT-INTEGRATION.md for the envelope format.
//
// Trust boundary: any script on the page (or an iframe) can post a message,
// so we accept only same-window, same-origin envelopes carrying our
// protocol tag, and every payload still goes through normalizeOffers()
// before it can become a row.

import { MSG_FROM_EXTENSION, MSG_FROM_PAGE, OFFER_PROTOCOL, normalizeOffers, offersFromNotesText } from './tripAgentOffers.js';

export function isExtensionEnvelope(event) {
  if (!event || event.source !== window) return false;
  if (event.origin !== window.location.origin) return false;
  const data = event.data;
  if (!data || typeof data !== 'object') return false;
  return data.source === MSG_FROM_EXTENSION && data.protocol === OFFER_PROTOCOL;
}

export function postToExtension(type, payload = {}) {
  if (typeof window === 'undefined') return;
  window.postMessage(
    { source: MSG_FROM_PAGE, protocol: OFFER_PROTOCOL, type, ...payload },
    window.location.origin
  );
}

// Subscribe to extension traffic. `handlers` takes {onOffers, onStatus}.
// Returns an unsubscribe function.
//
// Two payload shapes arrive, matching the extension's two capture paths:
// OFFERS (structured rows a scraper lifted from a page) and NOTES (trip-notes
// lines from a text selection the user reviewed by hand). NOTES is parsed here
// with the planner's own grammar, so the extension never has to know it.
export function listenForExtension(handlers = {}) {
  if (typeof window === 'undefined') return () => {};
  const onMessage = (event) => {
    if (!isExtensionEnvelope(event)) return;
    const data = event.data;
    if (data.type === 'OFFERS' && handlers.onOffers) {
      const offers = normalizeOffers(data.offers, {
        source: data.captureSource || 'extension',
        sourceUrl: data.sourceUrl || '',
      });
      if (offers.length) handlers.onOffers(offers, data);
    } else if (data.type === 'NOTES' && handlers.onOffers) {
      const { offers, rates } = offersFromNotesText(data.notes, {
        source: data.captureSource || 'selection',
        sourceUrl: data.sourceUrl || '',
      });
      if (offers.length) handlers.onOffers(offers, { ...data, rates });
    } else if (data.type === 'STATUS' && handlers.onStatus) {
      handlers.onStatus({
        connected: true,
        version: data.version || null,
        capturedCount: Number.isFinite(data.capturedCount) ? data.capturedCount : null,
      });
    }
  };
  window.addEventListener('message', onMessage);
  // Announce ourselves so an already-loaded extension replies with STATUS
  // and flushes anything it captured before this tab was open.
  postToExtension('READY');
  return () => window.removeEventListener('message', onMessage);
}

export function requestCapturedOffers() {
  postToExtension('REQUEST_OFFERS');
}

export function clearExtensionOffers() {
  postToExtension('CLEAR_OFFERS');
}

// iPhone has no extension system at all (not even in "Chrome" there — see
// docs/BOOKMARKLET.md), so a real extension can never reach the page there.
// The bookmarklet is the mobile substitute: it runs the same scraper against
// whatever page is open, then opens the planner with the result base64'd
// into the URL hash, since there is no content-script channel to post
// through. This reads that once on load and re-posts it as a normal
// extension envelope, so staging, normalization and dedupe all go through
// the one path above rather than a second one that could drift from it.
export function consumeBookmarkletCapture() {
  if (typeof window === 'undefined') return;
  const match = (window.location.hash || '').match(/(?:^#|[&])capture=([^&]+)/);
  if (!match) return;
  // Strip it immediately — a reload or a shared link must never replay it.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  let payload;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(match[1]))));
    payload = JSON.parse(json);
  } catch (err) {
    console.warn('[TripAgent] could not read the bookmarklet capture:', err);
    return;
  }
  if (!payload || !Array.isArray(payload.offers) || !payload.offers.length) return;
  window.postMessage({
    source: MSG_FROM_EXTENSION,
    protocol: OFFER_PROTOCOL,
    type: 'OFFERS',
    offers: payload.offers,
    sourceUrl: payload.sourceUrl || '',
    captureSource: payload.site || 'bookmarklet',
  }, window.location.origin);
}
