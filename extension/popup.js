/* global chrome, document, navigator, TripCapture */
// Popup for both capture paths. All state lives in the service worker — the
// popup is closed and rebuilt constantly, so it never holds anything itself.
//
//   Selected prices — text the user right-clicked. Reviewed and corrected
//                     here, then copied as trip-notes lines or pushed
//                     straight to an open planner tab.
//   Scraped offers  — structured rows from a supported site, with manual
//                     route/window overrides for what a URL doesn't say.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var OVERRIDE_FIELDS = ['from', 'to', 'window', 'travelers'];

  var captures = [];
  var offers = [];

  function send(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (reply) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(reply || { ok: false, error: 'No reply from the extension.' });
      });
    });
  }

  function showStatus(text, isError) {
    var el = $('status');
    el.textContent = text;
    el.className = 'status' + (isError ? ' -error' : '');
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 3500);
  }

  function overrides() {
    return {
      from: $('from').value.trim().toUpperCase(),
      to: $('to').value.trim().toUpperCase(),
      window: $('window').value.trim(),
      travelers: $('travelers').value.trim(),
      perTraveler: $('per-traveler').checked,
    };
  }

  function saveCaptures() {
    send({ type: 'SET_CAPTURES', captures: captures });
  }

  // ---- selection captures ------------------------------------------------

  function renderCaptures() {
    var listEl = $('capture-list');
    listEl.textContent = '';
    $('empty-state').hidden = captures.length > 0;

    captures.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'capture-item';

      var row = document.createElement('div');
      row.className = 'capture-row';

      var select = document.createElement('select');
      Object.keys(TripCapture.CATEGORY_TAG).forEach(function (cat) {
        var opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = TripCapture.CATEGORY_TAG[cat];
        if (cat === item.category) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', function () {
        item.category = select.value;
        saveCaptures();
      });

      var textarea = document.createElement('textarea');
      textarea.value = item.text;
      textarea.rows = 2;

      var meta = document.createElement('p');
      meta.className = 'meta';
      var noPriceFlag = document.createElement('span');
      noPriceFlag.className = 'no-price-flag';
      noPriceFlag.textContent = 'no price detected — edit before copying';

      function refreshPriceFlag() {
        var priced = TripCapture.hasPrice(textarea.value);
        textarea.classList.toggle('no-price', !priced);
        noPriceFlag.hidden = priced;
      }

      textarea.addEventListener('input', function () {
        item.text = textarea.value;
        refreshPriceFlag();
        saveCaptures();
      });

      var removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', function () {
        captures = captures.filter(function (c) { return c.id !== item.id; });
        saveCaptures();
        renderCaptures();
      });

      row.appendChild(select);
      row.appendChild(textarea);
      row.appendChild(removeBtn);
      li.appendChild(row);

      var host = TripCapture.hostnameOf(item.sourceUrl);
      meta.textContent = host ? ('from ' + host + '  ·  ') : '';
      meta.appendChild(noPriceFlag);
      li.appendChild(meta);

      refreshPriceFlag();
      listEl.appendChild(li);
    });
  }

  function notesText() {
    return captures.map(function (c) {
      return TripCapture.formatLine(c.category, c.text);
    }).join('\n');
  }

  // ---- scraped offers ----------------------------------------------------

  function describeOffer(offer) {
    var route = offer.place || [offer.from, offer.to].filter(Boolean).join(' → ') || 'unknown route';
    var times = [offer.departure, offer.arrival].filter(Boolean).join('–');
    var price = (offer.price && typeof offer.price === 'object')
      ? String((offer.price.currency || '') + ' ' + (offer.price.amount !== undefined ? offer.price.amount : '')).trim()
      : (offer.price || 'no price');
    return { route: route, detail: [offer.carrier, times, price].filter(Boolean).join(' · ') };
  }

  function renderOffers() {
    var listEl = $('offer-list');
    listEl.textContent = '';
    $('offers-empty').hidden = offers.length > 0;

    offers.slice(0, 25).forEach(function (offer) {
      var described = describeOffer(offer);
      var li = document.createElement('li');
      li.className = 'offer-item';
      var strong = document.createElement('b');
      strong.textContent = described.route;
      var span = document.createElement('span');
      span.textContent = described.detail ? (' — ' + described.detail) : '';
      li.appendChild(strong);
      li.appendChild(span);
      listEl.appendChild(li);
    });
  }

  // ---- shared ------------------------------------------------------------

  function renderAll(state) {
    var waiting = captures.length + offers.length;
    var tabs = state && state.plannerTabs ? state.plannerTabs : 0;
    $('subtitle').textContent = waiting
      ? waiting + ' item' + (waiting === 1 ? '' : 's') + ' waiting · ' + tabs + ' planner tab' + (tabs === 1 ? '' : 's') + ' open'
      : 'Works on whatever page you have open \u2014 right-click a price, or hit Capture below.';
    renderCaptures();
    renderOffers();
  }

  // ---- TripAgent ----------------------------------------------------------

  function renderServer(url) {
    $('server-on').hidden = !url;
    $('server-off').hidden = !!url;
    if (url) {
      try { $('server-on-text').textContent = 'Connected to ' + new URL(url).host + '. Captures go to the trip open in your planner.'; } catch (err) { /* keep default text */ }
    }
  }

  // What happened to a capture, in one sentence. TripAgent first; otherwise the
  // old planner-tab path, where "delivered" counts open planner tabs.
  function whereItWent(reply, count, noun) {
    var server = reply.server;
    if (server && server.ok) {
      return 'Sent ' + count + ' ' + noun + (count === 1 ? '' : 's') + ' to \u201c' + (server.title || 'your trip') + '\u201d on TripAgent \u2014 review them in the planner.';
    }
    var why = server && !server.notConfigured ? server.error + ' ' : '';
    if (reply.delivered) return why + 'Sent ' + count + ' ' + noun + (count === 1 ? '' : 's') + ' to ' + reply.delivered + ' planner tab' + (reply.delivered === 1 ? '' : 's') + '.';
    return why + (server && server.notConfigured ? 'No planner tab is open \u2014 set up TripAgent above, or start the app.' : 'Nothing was delivered.');
  }

  $('server-save-btn').addEventListener('click', async function () {
    var url = $('server-url').value.trim();
    if (!url) { showStatus('Paste your TripAgent URL first.', true); return; }
    var origin;
    try { origin = new URL(url).origin + '/*'; } catch (err) { showStatus('That is not a URL.', true); return; }
    // The manifest covers workers.dev; a custom domain needs the user's OK once.
    if (origin.indexOf('https://') === 0) {
      var has = await chrome.permissions.contains({ origins: [origin] });
      if (!has) {
        var granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) { showStatus('The extension needs permission to reach that address.', true); return; }
      }
    }
    var reply = await send({ type: 'SET_CONNECTOR', url: url });
    if (!reply.ok) { showStatus(reply.error, true); return; }
    showStatus('TripAgent connected.');
    refresh();
  });

  $('server-change-btn').addEventListener('click', async function () {
    await send({ type: 'SET_CONNECTOR', url: '' });
    refresh();
  });

  async function refresh() {
    var state = await send({ type: 'GET_STATE' });
    if (!state.ok) { showStatus(state.error, true); return; }
    captures = state.captures || [];
    offers = state.offers || [];
    renderServer(state.connectorUrl || '');
    OVERRIDE_FIELDS.forEach(function (f) {
      $(f).value = (state.options && state.options[f]) || '';
    });
    $('per-traveler').checked = !!(state.options && state.options.perTraveler);
    renderAll(state);
  }

  OVERRIDE_FIELDS.forEach(function (f) {
    $(f).addEventListener('change', function () { send({ type: 'SET_OPTIONS', options: overrides() }); });
  });

  $('per-traveler').addEventListener('change', function () { send({ type: 'SET_OPTIONS', options: overrides() }); });

  $('copy-btn').addEventListener('click', function () {
    if (!captures.length) { showStatus('Nothing to copy yet.', true); return; }
    navigator.clipboard.writeText(notesText()).then(function () {
      showStatus('Copied ' + captures.length + ' line(s) — paste into your trip notes.');
    }, function () {
      showStatus('Copy failed — select and copy manually.', true);
    });
  });

  $('send-notes-btn').addEventListener('click', async function () {
    if (!captures.length) { showStatus('Nothing to send yet.', true); return; }
    var reply = await send({ type: 'SEND_NOTES_TO_PLANNER', notes: notesText() });
    if (!reply.ok) { showStatus(reply.error, true); return; }
    showStatus(whereItWent(reply, captures.length, 'line'), !((reply.server && reply.server.ok) || reply.delivered));
  });

  $('clear-btn').addEventListener('click', async function () {
    await send({ type: 'CLEAR_CAPTURES' });
    showStatus('Cleared selected prices.');
    refresh();
  });

  $('capture-btn').addEventListener('click', async function () {
    showStatus('Capturing…');
    await send({ type: 'SET_OPTIONS', options: overrides() });
    var reply = await send({ type: 'CAPTURE_ACTIVE_TAB', overrides: overrides() });
    if (!reply.ok) { showStatus(reply.error, true); return; }
    if (!reply.captured) {
      showStatus('Nothing recognizable here \u2014 scroll the results into view, or right-click a price instead.', true);
    } else if (reply.server && reply.server.ok) {
      showStatus('Found ' + reply.captured + ' \u2014 sent to \u201c' + (reply.server.title || 'your trip') + '\u201d on TripAgent. Review them in the planner.');
    } else {
      showStatus('Found ' + reply.captured + ', ' + reply.added + ' new.' + (reply.server && !reply.server.notConfigured ? ' ' + reply.server.error : ''), !reply.added);
    }
    refresh();
  });

  $('send-offers-btn').addEventListener('click', async function () {
    var reply = await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    if (!reply.ok) { showStatus(reply.error, true); return; }
    if (!reply.count) { showStatus('Nothing scraped to send.', true); return; }
    showStatus(whereItWent(reply, reply.count, 'offer'), !((reply.server && reply.server.ok) || reply.delivered));
  });

  $('clear-offers-btn').addEventListener('click', async function () {
    await send({ type: 'CLEAR_OFFERS' });
    showStatus('Cleared scraped offers.');
    refresh();
  });

  refresh();
})();
