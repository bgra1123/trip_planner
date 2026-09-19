// Amadeus Self-Service flight-offers client.
//
// Dependency-free: Node 18+ ships fetch. The access token is cached in
// memory with its own expiry, because Amadeus rate-limits token issuance
// far more aggressively than searches.

const HOSTS = {
  test: 'https://test.api.amadeus.com',
  production: 'https://api.amadeus.com',
};

let cachedToken = null; // { value, expiresAt }

export function isConfigured(env = process.env) {
  return !!(env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET);
}

function hostFor(env) {
  return HOSTS[env.AMADEUS_HOSTNAME === 'production' ? 'production' : 'test'];
}

async function accessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.AMADEUS_CLIENT_ID,
    client_secret: env.AMADEUS_CLIENT_SECRET,
  });
  const response = await fetch(`${hostFor(env)}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = json && (json.error_description || json.error) ? (json.error_description || json.error) : response.status;
    throw new Error(`Amadeus auth failed: ${detail}`);
  }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in || 1799) * 1000 };
  return cachedToken.value;
}

// "PT4H45M" -> "4h 45m"
export function humanDuration(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return '';
  const days = m[1] ? parseInt(m[1], 10) : 0;
  const hours = (m[2] ? parseInt(m[2], 10) : 0) + days * 24;
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  if (!hours && !minutes) return '';
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : ''].filter(Boolean).join(' ');
}

// "2026-08-14T06:45:00" -> "06:45"
function clockTime(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

// Amadeus flight-offer -> the raw offer shape the app normalizes.
// Exported so the shape can be tested without hitting the network.
export function toOffers(payload) {
  const data = payload && Array.isArray(payload.data) ? payload.data : [];
  const carriers = (payload && payload.dictionaries && payload.dictionaries.carriers) || {};
  const offers = [];
  data.forEach((entry) => {
    const itineraries = Array.isArray(entry.itineraries) ? entry.itineraries : [];
    itineraries.forEach((itinerary, index) => {
      const segments = Array.isArray(itinerary.segments) ? itinerary.segments : [];
      if (!segments.length) return;
      const first = segments[0];
      const last = segments[segments.length - 1];
      const carrierCode = entry.validatingAirlineCodes && entry.validatingAirlineCodes[0]
        ? entry.validatingAirlineCodes[0]
        : first.carrierCode;
      offers.push({
        kind: 'flight',
        from: first.departure && first.departure.iataCode ? first.departure.iataCode : '',
        to: last.arrival && last.arrival.iataCode ? last.arrival.iataCode : '',
        departure: clockTime(first.departure && first.departure.at),
        arrival: clockTime(last.arrival && last.arrival.at),
        duration: humanDuration(itinerary.duration),
        stops: Math.max(segments.length - 1, 0),
        carrier: carriers[carrierCode] ? titleCase(carriers[carrierCode]) : (carrierCode || ''),
        // Amadeus quotes one price for the whole offer; attributing it to
        // the outbound leg and marking the return keeps the planner's
        // per-leg totals from double-counting a round trip.
        price: index === 0 && entry.price
          ? { amount: Number(entry.price.total), currency: entry.price.currency || 'EUR' }
          : null,
        detail: itineraries.length > 1 ? (index === 0 ? 'outbound' : 'return (priced with outbound)') : '',
        source: 'amadeus',
      });
    });
  });
  return offers;
}

function titleCase(text) {
  return String(text).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function searchFlights(query, env = process.env) {
  const token = await accessToken(env);
  const params = new URLSearchParams({
    originLocationCode: query.from,
    destinationLocationCode: query.to,
    departureDate: query.date,
    adults: String(query.adults || 1),
    currencyCode: query.currency || 'EUR',
    max: String(query.max || 10),
  });
  if (query.returnDate) params.set('returnDate', query.returnDate);

  const response = await fetch(`${hostFor(env)}/v2/shopping/flight-offers?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = json && json.errors && json.errors[0]
      ? (json.errors[0].detail || json.errors[0].title)
      : `${response.status} ${response.statusText}`;
    throw new Error(`Amadeus search failed: ${detail}`);
  }
  return toOffers(json);
}
