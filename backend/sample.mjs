// Deterministic sample offers, used when no flight-API credentials are
// configured. They are clearly flagged (`live: false` in the response, and
// a banner in the app) so sample prices can never be mistaken for real
// quotes — the point is only that the whole pipeline is testable end to
// end without an API key.

const CARRIERS = [
  { name: 'Turkish Airlines', depart: '06:45', arrive: '11:30', stops: 0, duration: '3h 45m', factor: 1.0 },
  { name: 'Lufthansa', depart: '09:15', arrive: '11:05', stops: 0, duration: '3h 50m', factor: 1.18 },
  { name: 'Pegasus', depart: '14:20', arrive: '20:40', stops: 1, duration: '7h 20m', factor: 0.72 },
  { name: 'Austrian', depart: '18:05', arrive: '22:35', stops: 1, duration: '5h 30m', factor: 0.94 },
];

// Same query in, same prices out — so a screenshot or a test run stays
// reproducible.
function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function sampleFlights(query) {
  const seed = seedFrom(`${query.from}|${query.to}|${query.date}|${query.adults || 1}`);
  const base = 120 + (seed % 260);
  const adults = Math.max(1, Number(query.adults) || 1);
  return CARRIERS.map((carrier) => ({
    kind: 'flight',
    from: query.from,
    to: query.to,
    departure: carrier.depart,
    arrival: carrier.arrive,
    duration: carrier.duration,
    stops: carrier.stops,
    carrier: carrier.name,
    price: {
      amount: Math.round(base * carrier.factor * adults),
      currency: query.currency || 'EUR',
    },
    detail: 'sample data — not a real quote',
    source: 'sample',
  }));
}
