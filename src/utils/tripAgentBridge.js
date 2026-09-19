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

import { MSG_FROM_EXTENSION, MSG_FROM_PAGE, OFFER_PROTOCOL, normalizeOffers } from './tripAgentOffers.js';

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
