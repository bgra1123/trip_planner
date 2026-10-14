import React, { useState } from 'react';
import { KINDS, CURRENCIES, emptyCard, buildOfferFromCard } from '../utils/entryCard.js';
import { parseSpokenEntry } from '../utils/spokenEntry.js';

// Guided input cards: pick what you're adding, fill a few clearly labelled
// fields (or say / type one sentence and let it fill the card), check it, add
// it to the review list. The logic and the refusals live in utils/entryCard.js;
// this is only the form.
//
// Nothing is assumed: a price needs a currency you chose, and a flight or train
// price needs your answer to "per traveler or total?". The review list is the
// last check before anything reaches the plan.

const KIND_LABEL = { flight: 'Flight', train: 'Train', hotel: 'Hotel', activity: 'Activity' };

const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

const inputClass = (bad) => `w-full text-xs px-2 py-1.5 rounded border focus:outline-none normal-case ${bad ? 'border-red-400 bg-red-50' : 'border-slate-300 focus:border-blue-400'}`;

export default function EntryCards({ onStage, defaultWindow = '', existingLegs = [] }) {
  const [kind, setKind] = useState('flight');
  const [cards, setCards] = useState(() => {
    const c = {};
    KINDS.forEach((k) => { c[k] = { ...emptyCard(k), window: defaultWindow }; });
    return c;
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [speech, setSpeech] = useState('');
  const [listening, setListening] = useState(false);
  const [filled, setFilled] = useState('');

  const v = cards[kind];
  const set = (field, value) => {
    setCards((c) => ({ ...c, [kind]: { ...c[kind], [field]: value } }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const legPoints = Array.from(new Set(existingLegs.flatMap((l) => String(l).split(' → ')).filter(Boolean)));

  function fillFromSpeech(text) {
    const { fields, found } = parseSpokenEntry(text, kind);
    if (!found.length) {
      setFilled("Couldn't pick anything out of that. Try the fields below, or say it again with the cities, times and price.");
      return;
    }
    setCards((c) => ({ ...c, [kind]: { ...c[kind], ...fields } }));
    setErrors({});
    setFilled(`Filled in: ${found.join(', ')}. Check each one, then answer anything still empty.`);
  }

  function listen() {
    if (!SpeechRecognition) return;
    try {
      const rec = new SpeechRecognition();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.onresult = (e) => {
        const heard = e.results[0][0].transcript;
        setSpeech(heard);
        fillFromSpeech(heard);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const { errors: found, raw, travelers } = buildOfferFromCard(kind, v);
    if (found.length) {
      const byField = {};
      found.forEach((x) => { byField[x.field] = x.message; });
      setErrors(byField);
      setMessage(null);
      return;
    }
    const count = onStage([raw], 'card', raw.window, travelers);
    if (!count) {
      setErrors({});
      setMessage({ error: true, text: "That card didn't have enough to add: it needs a route or place, or a price." });
      return;
    }
    setErrors({});
    setFilled('');
    setSpeech('');
    setMessage({ error: false, text: `Added the ${KIND_LABEL[kind].toLowerCase()} to the review list below. Check it, then tap Add there.` });
    // Ready for the next one: keep what usually repeats (route, currency,
    // your per-traveler answer, window), clear what changes.
    setCards((c) => {
      const keep = c[kind];
      const next = { ...emptyCard(kind), window: keep.window, currency: keep.currency };
      if (kind === 'flight' || kind === 'train') Object.assign(next, { from: keep.from, to: keep.to, basis: keep.basis, travelers: keep.travelers });
      if (kind === 'hotel') Object.assign(next, { place: keep.place, priceKind: keep.priceKind, nights: keep.nights });
      return { ...c, [kind]: next };
    });
  }

  function field(label, name, props = {}) {
    const bad = errors[name];
    return (
      <label className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
        <span className="block mb-1">{label}</span>
        <input
          type={props.type || 'text'}
          value={v[name] || ''}
          onChange={(e) => set(name, e.target.value)}
          aria-label={`Card: ${label}`}
          placeholder={props.placeholder}
          list={props.list}
          min={props.min}
          max={props.max}
          inputMode={props.inputMode}
          className={inputClass(bad)}
        />
        {bad && <span className="block normal-case text-red-600 mt-0.5">{bad}</span>}
      </label>
    );
  }

  function select(label, name, options, props = {}) {
    const bad = errors[name];
    return (
      <label className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
        <span className="block mb-1">{label}</span>
        <select value={v[name] || ''} onChange={(e) => set(name, e.target.value)} aria-label={`Card: ${label}`} className={`${inputClass(bad)} bg-white`}>
          <option value="">{props.placeholder || 'Choose…'}</option>
          {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        {bad && <span className="block normal-case text-red-600 mt-0.5">{bad}</span>}
      </label>
    );
  }

  const isTravel = kind === 'flight' || kind === 'train';
  const hasPrice = String(v.price || '').trim() !== '';

  return (
    <div className="mb-3 pb-3 border-b border-slate-100" data-testid="entry-cards">
      <div role="tablist" aria-label="What are you adding?" className="flex flex-wrap gap-2 mb-3">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => { setKind(k); setErrors({}); setMessage(null); setFilled(''); }}
            className={`text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border ${kind === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-500'}`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {/* Say it, or type it: one sentence fills the card; you check it. */}
      <div className="mb-3">
        <label className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
          <span className="block mb-1">Say it or type it in one go</span>
          <textarea
            value={speech}
            onChange={(e) => setSpeech(e.target.value)}
            rows={2}
            aria-label="Card: describe it in a sentence"
            placeholder={
              isTravel ? 'e.g. flight from New York to Paris, leaves 6:30 pm, lands 7:45 am, Air France, 612 dollars each for two travelers'
                : kind === 'hotel' ? 'e.g. Hotel Le Marais in Paris, 280 euros a night for 3 nights'
                  : 'e.g. Louvre late opening, 25 euros'
            }
            className="w-full text-xs px-2 py-1.5 rounded border border-slate-300 focus:border-blue-400 focus:outline-none normal-case"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => fillFromSpeech(speech)}
            disabled={!speech.trim()}
            className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500 disabled:text-slate-300"
          >
            Fill the card
          </button>
          {SpeechRecognition ? (
            <button
              type="button"
              onClick={listen}
              disabled={listening}
              className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-blue-500 disabled:text-slate-400"
            >
              {listening ? 'Listening…' : '🎤 Speak'}
            </button>
          ) : (
            <span className="text-xs text-slate-500">To speak, use your keyboard's microphone button (iPhone and Android) in any box here.</span>
          )}
        </div>
        {filled && <p className="text-xs text-slate-600 mt-1">{filled}</p>}
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {isTravel && (
          <>
            <datalist id="entry-card-places">{legPoints.map((p) => <option key={p} value={p} />)}</datalist>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {field('From', 'from', { list: 'entry-card-places', placeholder: 'New York or NYC' })}
              {field('To', 'to', { list: 'entry-card-places', placeholder: 'Paris or PAR' })}
              {field('Departs', 'depart', { placeholder: '6:30 pm' })}
              {field('Arrives', 'arrive', { placeholder: '7:45 am' })}
              {field(kind === 'train' ? 'Operator' : 'Airline', 'carrier', { placeholder: kind === 'train' ? 'Trenitalia' : 'Air France' })}
              {field('Fare or class', 'fare', { placeholder: 'Main Basic' })}
              {select('Stops', 'stops', [['0', 'Nonstop / direct'], ['1', '1 stop'], ['2', '2 stops']], { placeholder: 'Not stated' })}
              {field('Window', 'window', { placeholder: '28-31 Oct' })}
            </div>
          </>
        )}

        {kind === 'hotel' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            {field('City', 'place', { placeholder: 'Paris' })}
            {field('Hotel name', 'name', { placeholder: 'Le Marais Boutique' })}
            {select('Price is', 'priceKind', [['per_night', 'Per night'], ['stay', 'For the whole stay']], { placeholder: hasPrice ? 'Choose…' : 'If you give a price' })}
            {v.priceKind === 'per_night' && field('Nights', 'nights', { type: 'number', min: 1, max: 60, placeholder: '3', inputMode: 'numeric' })}
            {field('Window', 'window', { placeholder: '28-31 Oct' })}
          </div>
        )}

        {kind === 'activity' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            {field('Activity', 'name', { placeholder: 'Louvre late opening' })}
            {field('City', 'place', { placeholder: 'Paris' })}
            {field('Window', 'window', { placeholder: '28-31 Oct' })}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          {field(kind === 'activity' ? 'Price for everyone' : 'Price', 'price', { type: 'text', inputMode: 'decimal', placeholder: '612' })}
          {select('Currency', 'currency', CURRENCIES.map((c) => [c, c]), { placeholder: hasPrice ? 'Choose…' : 'If you give a price' })}
          {isTravel && select('Price is', 'basis', [['per_traveler', 'Per traveler'], ['total', 'Total for everyone']], { placeholder: hasPrice ? 'Choose…' : 'If you give a price' })}
          {isTravel && v.basis === 'per_traveler' && field('Travelers', 'travelers', { type: 'number', min: 1, max: 20, placeholder: '2', inputMode: 'numeric' })}
        </div>

        <div className="mb-2">{field('Notes', 'note', { placeholder: kind === 'hotel' ? 'Amex FHR, breakfast included…' : 'points price, baggage, anything worth keeping' })}</div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Add {KIND_LABEL[kind].toLowerCase()} to review list
          </button>
          <span className="text-xs text-slate-500">
            Prices are kept exactly as you enter them{isTravel ? '; per-traveler prices are multiplied for you' : ''}. Nothing reaches your plan until you tap Add in the list.
          </span>
        </div>
        {Object.values(errors).some(Boolean) && <p className="text-xs text-red-600 mt-2">Fix the highlighted fields, then add it again.</p>}
        {message && <p className={`text-xs mt-2 ${message.error ? 'text-red-600' : 'text-green-700'}`}>{message.text}</p>}
      </form>
    </div>
  );
}
