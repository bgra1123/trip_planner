/* global chrome */
// Runs on the Trip Planner origin. Content scripts live in an isolated
// world, so this is the only path between the page and the extension:
// window.postMessage in one direction, chrome.runtime messaging in the
// other. The page half of this contract is src/utils/tripAgentBridge.js.

(function () {
  'use strict';

  var PROTOCOL = 'tripagent/v1';
  var FROM_EXTENSION = 'tripagent-extension';
  var FROM_PAGE = 'tripagent-page';

  function toPage(type, payload) {
    var envelope = { source: FROM_EXTENSION, protocol: PROTOCOL, type: type };
    Object.keys(payload || {}).forEach(function (k) { envelope[k] = payload[k]; });
    window.postMessage(envelope, window.location.origin);
  }

  function ask(message, onReply) {
    chrome.runtime.sendMessage(message, function (reply) {
      if (chrome.runtime.lastError) return; // service worker asleep or reloading
      if (reply) onReply(reply);
    });
  }

  function sendOffers(reply) {
    if (reply.offers && reply.offers.length) {
      toPage('OFFERS', { offers: reply.offers, captureSource: 'extension' });
    }
  }

  // Page -> extension. Only same-window, same-origin envelopes carrying our
  // protocol tag are relayed, so an embedded frame or a third-party script
  // cannot drive the extension.
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== FROM_PAGE || data.protocol !== PROTOCOL) return;

    if (data.type === 'READY') {
      ask({ type: 'PAGE_READY' }, function (reply) {
        toPage('STATUS', { version: reply.version, capturedCount: reply.offers ? reply.offers.length : 0 });
        sendOffers(reply);
      });
    } else if (data.type === 'REQUEST_OFFERS') {
      ask({ type: 'PAGE_REQUEST_OFFERS' }, sendOffers);
    } else if (data.type === 'CLEAR_OFFERS') {
      ask({ type: 'PAGE_CLEAR_OFFERS' }, function () {});
    }
  });

  // Extension -> page: the service worker pushes captures into any open
  // planner tab without the page having to poll. Two shapes, because the two
  // capture paths produce genuinely different things: structured offers from
  // a scraper, and trip-notes lines from a hand-reviewed text selection. The
  // page parses the latter with its own notes grammar.
  chrome.runtime.onMessage.addListener(function (message) {
    if (!message) return;
    if (message.type === 'PUSH_OFFERS') sendOffers(message);
    else if (message.type === 'PUSH_NOTES' && message.notes) {
      toPage('NOTES', { notes: message.notes, captureSource: 'selection' });
    }
  });
})();
