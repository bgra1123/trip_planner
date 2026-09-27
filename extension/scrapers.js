/* global globalThis */
// Site scrapers for TripAgent Capture.
//
// Booking sites rewrite their markup constantly, so nothing here depends on
// a class name. Two strategies, tried in order:
//
//   1. JSON-LD (<script type="application/ld+json">) — structured data the
//      sites publish for search engines. Stable, but only some pages have it.
//   2. A text heuristic — walk candidate result containers and keep the ones
//      that contain a price AND (for travel) two clock times. Survives
//      markup churn because it reads rendered text, not selectors.
//
// A scraper's job is only to produce rough raw offers. Normalization,
// validation and dedupe all happen later in the web app
// (src/utils/tripAgentOffers.js), so a sloppy capture degrades into a row
// the user fixes by hand rather than into bad data they cannot see.

var TripAgentScrapers = (function () {
  'use strict';

  var PRICE_RE = /(?:[€$£]|\bEUR\b|\bUSD\b|\bGBP\b|\bTRY\b|\bCHF\b)\s?\d[\d.,]*/i;
  var TIME_RE = /\b\d{1,2}:\d{2}(?:\s?(?:AM|PM))?\b/gi;
  var DURATION_RE = /\b\d{1,2}\s?hr?\s?\d{0,2}\s?m(?:in)?\b|\b\d{1,2}h\s?\d{0,2}m?\b/i;
  var STOPS_RE = /\b(nonstop|direct|(\d)\s?stops?)\b/i;

  // Bank travel portals: reachable only in the user's authenticated session,
  // which is the whole reason the extension scrapes them instead of a server
  // querying an API. They price in the card's currency (USD for these two) and
  // often quote points as well as cash.
  var BANK_PORTALS = ['capital-one', 'amex'];

  var SITES = [
    { id: 'capital-one', kind: 'flight', currency: 'USD', test: /travel\.capitalone\.com/i,
      rootSelectors: ['[data-testid*="flight"]', '[class*="flight-card"]', '[class*="FlightCard"]', 'li[class*="result"]'] },
    { id: 'amex', kind: 'flight', currency: 'USD', test: /travel\.americanexpress\.com/i,
      rootSelectors: ['[data-test*="flight"]', '[class*="flight-result"]', '[class*="FlightResult"]', 'li[class*="offer"]'] },
    { id: 'google-flights', kind: 'flight', test: /google\.[a-z.]+\/travel\/flights/i, rootSelectors: ['li[role="listitem"]', 'ul li'] },
    { id: 'kayak', kind: 'flight', test: /kayak\.[a-z.]+\/flights/i, rootSelectors: ['div[class*="result"]', 'div[data-resultid]'] },
    { id: 'skyscanner', kind: 'flight', test: /skyscanner\.[a-z.]+\/transport\/flights/i, rootSelectors: ['div[class*="FlightsResults"] > div', 'div[class*="ItineraryCard"]'] },
    { id: 'booking-com', kind: 'hotel', test: /booking\.com/i, rootSelectors: ['div[data-testid="property-card"]', 'div[class*="property-card"]'] },
    { id: 'trainline', kind: 'train', test: /(thetrainline|trainline)\.com/i, rootSelectors: ['div[class*="journey"]', 'li[class*="journey"]'] },
    { id: 'db-bahn', kind: 'train', test: /bahn\.de/i, rootSelectors: ['div[class*="reiseloesung"]', 'li[class*="verbindung"]'] },
  ];

  function detectSite(url) {
    for (var i = 0; i < SITES.length; i++) {
      if (SITES[i].test.test(url)) return SITES[i];
    }
    return { id: 'unknown', kind: 'flight', rootSelectors: [] };
  }

  function text(node) {
    return (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  }

  // ---- Route detection from the URL -------------------------------------
  // Most search URLs carry the route; when they do not, the popup's manual
  // override fills it in. Codes are upper-cased but never invented.
  function routeFromUrl(url) {
    var m = url.match(/\/flights\/([A-Za-z]{3})-([A-Za-z]{3})/); // kayak
    if (m) return { from: m[1].toUpperCase(), to: m[2].toUpperCase() };
    m = url.match(/\/transport\/flights\/([a-z]{3,4})\/([a-z]{3,4})\//i); // skyscanner
    if (m) return { from: m[1].toUpperCase(), to: m[2].toUpperCase() };
    try {
      var params = new URL(url).searchParams;
      var origin = params.get('origin') || params.get('from') || params.get('f');
      var dest = params.get('destination') || params.get('to') || params.get('t');
      if (origin && dest) return { from: String(origin).toUpperCase(), to: String(dest).toUpperCase() };
    } catch (e) { /* not a parseable URL — fall through */ }
    return null;
  }

  function placeFromUrl(url) {
    try {
      var params = new URL(url).searchParams;
      var ss = params.get('ss') || params.get('city') || params.get('dest_id_name');
      if (ss) return String(ss).split(',')[0].trim();
    } catch (e) { /* ignore */ }
    var m = url.match(/\/hotel\/[a-z]{2}\/([a-z0-9-]+)/i);
    if (m) return m[1].replace(/-/g, ' ');
    return '';
  }

  // ---- Strategy 1: JSON-LD ----------------------------------------------
  function fromJsonLd(doc) {
    var offers = [];
    var nodes = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) {
      var parsed;
      try { parsed = JSON.parse(nodes[i].textContent); } catch (e) { continue; }
      collectJsonLd(parsed, offers);
    }
    return offers;
  }

  function collectJsonLd(node, out, depth) {
    depth = depth || 0;
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach(function (n) { collectJsonLd(n, out, depth + 1); });
      return;
    }
    if (typeof node !== 'object') return;
    var type = String(node['@type'] || '').toLowerCase();
    if (type === 'flight') {
      out.push({
        kind: 'flight',
        from: airportCode(node.departureAirport),
        to: airportCode(node.arrivalAirport),
        departure: node.departureTime || '',
        arrival: node.arrivalTime || '',
        carrier: nameOf(node.provider) || nameOf(node.airline),
        price: priceFromOffer(node.offers),
      });
    } else if (type === 'hotel' || type === 'lodgingbusiness') {
      out.push({
        kind: 'hotel',
        place: nameOf(node.address && node.address.addressLocality) || nameOf(node),
        label: nameOf(node),
        price: priceFromOffer(node.offers) || node.priceRange || null,
        perNight: true,
      });
    }
    Object.keys(node).forEach(function (k) {
      if (k.charAt(0) !== '@') collectJsonLd(node[k], out, depth + 1);
    });
  }

  function nameOf(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return String(value.name || '');
  }

  function airportCode(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return String(value.iataCode || value.name || '');
  }

  function priceFromOffer(offers) {
    if (!offers) return null;
    var first = Array.isArray(offers) ? offers[0] : offers;
    if (!first) return null;
    if (first.price === undefined && first.lowPrice === undefined) return null;
    return {
      amount: first.price !== undefined ? first.price : first.lowPrice,
      currency: first.priceCurrency || 'EUR',
    };
  }

  // ---- Strategy 2: rendered-text heuristic ------------------------------
  function candidateNodes(doc, site) {
    var nodes = [];
    var selectors = (site.rootSelectors || []).concat(['li', 'article', 'div[role="listitem"]']);
    for (var i = 0; i < selectors.length; i++) {
      var found;
      try { found = doc.querySelectorAll(selectors[i]); } catch (e) { continue; }
      if (found && found.length) {
        for (var j = 0; j < found.length && nodes.length < 400; j++) nodes.push(found[j]);
        if (nodes.length >= 8) break;
      }
    }
    return nodes;
  }

  function fromHeuristic(doc, site, url) {
    var route = routeFromUrl(url);
    var place = placeFromUrl(url);
    var wantsTimes = site.kind !== 'hotel';
    var offers = [];
    var seen = Object.create(null);

    candidateNodes(doc, site).forEach(function (node) {
      var content = text(node);
      // Skip containers so large they are the whole page, and fragments too
      // small to be a result row.
      if (content.length < 12 || content.length > 600) return;
      var priceMatch = content.match(PRICE_RE);
      if (!priceMatch) return;
      var times = content.match(TIME_RE) || [];
      if (wantsTimes && times.length < 2) return;

      var key = content.slice(0, 160);
      if (seen[key]) return;
      seen[key] = true;

      var durationMatch = content.match(DURATION_RE);
      var stopsMatch = content.match(STOPS_RE);
      var stops = null;
      if (stopsMatch) stops = stopsMatch[2] ? parseInt(stopsMatch[2], 10) : 0;

      offers.push({
        kind: site.kind,
        from: route ? route.from : '',
        to: route ? route.to : '',
        place: site.kind === 'hotel' ? place : '',
        label: site.kind === 'hotel' ? firstLine(content) : '',
        carrier: wantsTimes ? carrierFrom(content) : '',
        departure: times[0] || '',
        arrival: times[1] || '',
        duration: durationMatch ? durationMatch[0] : '',
        stops: stops,
        price: priceMatch[0],
        perNight: site.kind === 'hotel',
        source: site.id,
        sourceUrl: url,
      });
    });
    return offers;
  }

  // "32,000 miles" / "45,500 points" / "32k pts". A points price is not money:
  // if it were captured as a cash amount it would land in the trip total as
  // tens of thousands of euros. It is recorded in the detail instead, and the
  // offer is left with no price unless a cash figure is also on the card.
  var POINTS_RE = /(\d[\d,.]*)\s?(?:k\s)?(?:miles|points|pts)\b/i;

  function pointsIn(content) {
    var m = content.match(POINTS_RE);
    return m ? m[0].replace(/\s+/g, ' ').trim() : '';
  }

  // The portals render a cash price with a currency marker; a bare number next
  // to "miles" is not one. PRICE_RE already requires a marker, so this only has
  // to reject the case where the marker belongs to a points redemption fee.
  function cashPriceIn(content) {
    var m = content.match(PRICE_RE);
    if (!m) return '';
    // "$5.60 in taxes" alongside a points fare is a fee, not the fare.
    if (/\b(tax|taxes|fees?)\b/i.test(content) && POINTS_RE.test(content) && parseFloat(m[0].replace(/[^\d.]/g, '')) < 100) return '';
    return m[0];
  }

  function firstLine(content) {
    return content.split(/\s[·|]\s|\s{2,}/)[0].slice(0, 80).trim();
  }

  // Carrier names sit next to the times in rendered text; take the longest
  // run of letters that is not a time, a price or a stop count.
  function carrierFrom(content) {
    var stripped = content
      .replace(TIME_RE, ' ')
      .replace(PRICE_RE, ' ')
      .replace(STOPS_RE, ' ')
      .replace(DURATION_RE, ' ');
    var words = stripped.match(/[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?/g) || [];
    words.sort(function (a, b) { return b.length - a.length; });
    return words.length ? words[0].slice(0, 40) : '';
  }

  // ---- Strategy 0: bank travel portals -----------------------------------
  // Same conservative shape as the generic heuristic, but it knows the card's
  // currency, and it separates a points fare from a cash one.
  function fromBankPortal(doc, site, url) {
    var route = routeFromUrl(url);
    var offers = [];
    var seen = Object.create(null);

    candidateNodes(doc, site).forEach(function (node) {
      var content = text(node);
      if (content.length < 12 || content.length > 600) return;
      var times = content.match(TIME_RE) || [];
      var points = pointsIn(content);
      var cash = cashPriceIn(content);
      // A card has to show a schedule and *some* kind of price to be a result.
      if (times.length < 2 || (!cash && !points)) return;

      var key = content.slice(0, 160);
      if (seen[key]) return;
      seen[key] = true;

      var stopsMatch = content.match(STOPS_RE);
      var durationMatch = content.match(DURATION_RE);
      var detail = [];
      if (points) detail.push(points + ' (points — not counted as cash)');

      offers.push({
        kind: 'flight',
        from: route ? route.from : '',
        to: route ? route.to : '',
        carrier: carrierFrom(content),
        departure: times[0] || '',
        arrival: times[1] || '',
        duration: durationMatch ? durationMatch[0] : '',
        stops: stopsMatch ? (stopsMatch[2] ? parseInt(stopsMatch[2], 10) : 0) : null,
        // Currency is stated rather than inferred: these portals quote in the
        // card's currency, and a bare "320" read as euros would be wrong by
        // roughly the exchange rate.
        price: cash ? (/[€$£₺]|\b(?:EUR|USD|GBP|TRY|CHF)\b/i.test(cash) ? cash : site.currency + ' ' + cash) : null,
        detail: detail.join(' · '),
        source: site.id,
        sourceUrl: url,
      });
    });
    return offers;
  }

  // ---- Entry point -------------------------------------------------------
  function scrape(doc, url, overrides) {
    var site = detectSite(url);
    var offers = fromJsonLd(doc);
    if (BANK_PORTALS.indexOf(site.id) !== -1) {
      // Portals are authenticated app shells and publish no useful JSON-LD,
      // so the portal pass is authoritative here.
      offers = fromBankPortal(doc, site, url);
    } else if (offers.length < 2) {
      offers = offers.concat(fromHeuristic(doc, site, url));
    }
    var o = overrides || {};
    return offers.map(function (offer) {
      return Object.assign({}, offer, {
        kind: offer.kind || site.kind,
        // A manual override in the popup always wins: the user looking at
        // the page knows the route better than a URL pattern does.
        from: o.from || offer.from || '',
        to: o.to || offer.to || '',
        window: o.window || '',
        source: offer.source || site.id,
        sourceUrl: offer.sourceUrl || url,
        capturedAt: new Date().toISOString(),
      });
    });
  }

  return {
    scrape: scrape, detectSite: detectSite, routeFromUrl: routeFromUrl,
    placeFromUrl: placeFromUrl, pointsIn: pointsIn, cashPriceIn: cashPriceIn,
    BANK_PORTALS: BANK_PORTALS,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TripAgentScrapers;
else if (typeof globalThis !== 'undefined') globalThis.TripAgentScrapers = TripAgentScrapers;
