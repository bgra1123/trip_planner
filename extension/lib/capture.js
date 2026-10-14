// Shared by background.js (service worker, loaded via importScripts) and
// popup.js (loaded via a plain <script> tag) — same tag vocabulary and cost
// shape as src/utils/parseTripNotes.js, kept as a small standalone copy
// since an extension can't import that ES module directly.
(function (global) {
  'use strict';

  var CATEGORY_TAG = {
    flight: 'FLIGHT',
    train: 'TRAIN',
    hotel: 'HOTEL',
    activity: 'ACTIVITY',
    note: 'NOTE',
  };

  var PRICE_RE = /(?:€|\$|£|₺|EUR|USD|GBP|TRY|CHF)\s?\d[\d.,]*/i;

  function hasPrice(text) {
    return PRICE_RE.test(text || '');
  }

  function guessCategory(text, title, url) {
    var hay = ((text || '') + ' ' + (title || '') + ' ' + (url || '')).toLowerCase();
    if (/\bflight|airfare|airline|nonstop|itinerary|departure|arrival\b/.test(hay) || /\b[a-z]{3}\s?(?:→|->|-)\s?[a-z]{3}\b/i.test(text || '')) return 'flight';
    if (/\btrain|rail|eurostar|thalys|deutsche bahn|renfe|trenitalia\b/.test(hay)) return 'train';
    if (/\bhotel|per night|\/night|stay|apartment|airbnb|resort|hostel|room\b/.test(hay)) return 'hotel';
    if (/\bticket|tour|museum|activity|attraction|admission|excursion\b/.test(hay)) return 'activity';
    return 'note';
  }

  function cleanText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function formatLine(category, body) {
    var tag = CATEGORY_TAG[category] || 'NOTE';
    return tag + ': ' + body;
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  global.TripCapture = {
    CATEGORY_TAG: CATEGORY_TAG,
    hasPrice: hasPrice,
    guessCategory: guessCategory,
    cleanText: cleanText,
    formatLine: formatLine,
    hostnameOf: hostnameOf,
  };
})(typeof self !== 'undefined' ? self : this);
