/* global chrome, document */
// Popup: manual capture, route/window overrides, and a look at what is
// staged. Every action goes through the service worker so the popup itself
// holds no state — it is closed and rebuilt constantly.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fields = ['from', 'to', 'window'];

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (reply) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(reply || { ok: false, error: 'No reply from the extension.' });
      });
    });
  }

  function setStatus(text, kind) {
    const el = $('status');
    el.textContent = text || '';
    el.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function overrides() {
    return {
      from: $('from').value.trim().toUpperCase(),
      to: $('to').value.trim().toUpperCase(),
      window: $('window').value.trim(),
    };
  }

  function describe(offer) {
    const route = offer.place || [offer.from, offer.to].filter(Boolean).join(' → ') || 'unknown route';
    const times = [offer.departure, offer.arrival].filter(Boolean).join('–');
    const price = typeof offer.price === 'object' && offer.price
      ? `${offer.price.currency || ''} ${offer.price.amount !== undefined ? offer.price.amount : ''}`.trim()
      : (offer.price || 'no price');
    return { route, detail: [offer.carrier, times, price].filter(Boolean).join(' · ') };
  }

  function render(state) {
    const count = state.offers ? state.offers.length : 0;
    $('subtitle').textContent = count
      ? `${count} offer${count === 1 ? '' : 's'} staged · ${state.plannerTabs || 0} planner tab${state.plannerTabs === 1 ? '' : 's'} open`
      : 'Nothing captured yet. Open a flight or hotel search and capture it.';
    $('send').disabled = !count;
    $('clear').disabled = !count;

    const list = $('offers');
    list.textContent = '';
    (state.offers || []).slice(0, 25).forEach((offer) => {
      const { route, detail } = describe(offer);
      const li = document.createElement('li');
      li.className = 'row';
      const strong = document.createElement('b');
      strong.textContent = route;
      const span = document.createElement('span');
      span.textContent = detail ? ` — ${detail}` : '';
      li.append(strong, span);
      list.append(li);
    });
  }

  async function refresh() {
    const state = await send({ type: 'GET_STATE' });
    if (!state.ok) { setStatus(state.error, 'error'); return; }
    fields.forEach((f) => { $(f).value = (state.options && state.options[f]) || ''; });
    render(state);
  }

  fields.forEach((f) => {
    $(f).addEventListener('change', () => { send({ type: 'SET_OPTIONS', options: overrides() }); });
  });

  $('capture').addEventListener('click', async () => {
    setStatus('Capturing…');
    await send({ type: 'SET_OPTIONS', options: overrides() });
    const reply = await send({ type: 'CAPTURE_ACTIVE_TAB', overrides: overrides() });
    if (!reply.ok) { setStatus(reply.error, 'error'); return; }
    setStatus(
      reply.captured
        ? `Found ${reply.captured}, ${reply.added} new.`
        : 'Nothing recognizable on this page — try scrolling the results into view first.',
      reply.added ? 'ok' : null
    );
    refresh();
  });

  $('send').addEventListener('click', async () => {
    const reply = await send({ type: 'SEND_TO_PLANNER' });
    if (!reply.ok) { setStatus(reply.error, 'error'); return; }
    setStatus(
      reply.delivered
        ? `Sent ${reply.count} to ${reply.delivered} planner tab${reply.delivered === 1 ? '' : 's'}.`
        : 'No planner tab is open — start the app and try again.',
      reply.delivered ? 'ok' : 'error'
    );
  });

  $('clear').addEventListener('click', async () => {
    await send({ type: 'CLEAR' });
    setStatus('Cleared.', 'ok');
    refresh();
  });

  refresh();
})();
