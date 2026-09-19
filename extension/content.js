/* global chrome, TripAgentScrapers */
// Runs on booking sites. Scrapes the visible results and hands them to the
// service worker, which stages them until the planner tab asks for them.
//
// Results load asynchronously and keep mutating (filters, lazy rows), so
// rather than scraping once at load we debounce on DOM mutations and only
// report when the captured set actually changed.

(function () {
  'use strict';

  var DEBOUNCE_MS = 1200;
  var MIN_INTERVAL_MS = 8000;
  var lastSignature = '';
  var lastSentAt = 0;
  var timer = null;

  function signatureOf(offers) {
    return offers.map(function (o) {
      return [o.from, o.to, o.place, o.departure, o.arrival, o.price, o.label].join('~');
    }).join('|');
  }

  function capture(overrides) {
    try {
      return TripAgentScrapers.scrape(document, location.href, overrides);
    } catch (err) {
      console.warn('[TripAgent] scrape failed:', err);
      return [];
    }
  }

  function report(reason) {
    var now = Date.now();
    if (reason === 'auto' && now - lastSentAt < MIN_INTERVAL_MS) return;
    var offers = capture(null);
    if (!offers.length) return;
    var signature = signatureOf(offers);
    if (reason === 'auto' && signature === lastSignature) return;
    lastSignature = signature;
    lastSentAt = now;
    chrome.runtime.sendMessage({
      type: 'CAPTURED',
      offers: offers,
      sourceUrl: location.href,
      site: TripAgentScrapers.detectSite(location.href).id,
      reason: reason,
    }, function () { void chrome.runtime.lastError; });
  }

  function scheduleAuto() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { report('auto'); }, DEBOUNCE_MS);
  }

  // The popup can force a capture of exactly what is on screen right now,
  // with a manual route/window override.
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== 'SCRAPE_NOW') return undefined;
    var offers = capture(message.overrides);
    lastSignature = signatureOf(offers);
    lastSentAt = Date.now();
    sendResponse({ offers: offers, sourceUrl: location.href, site: TripAgentScrapers.detectSite(location.href).id });
    return true;
  });

  var observer = new MutationObserver(scheduleAuto);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleAuto();
})();
