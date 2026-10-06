// Screenshot -> trip-notes lines, via Claude's vision.
//
// The answer to "my card portal only shows prices to me, logged in": no
// server can see that page, but a screenshot of it can be read. This turns
// one or more screenshots into the planner's own FLIGHT:/HOTEL:/... shorthand,
// which then goes through offersFromNotesText() into staging like any other
// capture — the model only transcribes; parsing and validation stay ours.
//
// Shared by the browser (TripAgentPanel, with the user's own key) and the
// Node CLI (scripts/extract-screenshot.mjs). The SDK is imported lazily so it
// is only downloaded in the browser when someone actually reads a screenshot.

export const SCREENSHOT_MODEL = 'claude-opus-5-5';

// The model reads images up to this long edge; anything larger is downscaled
// by the API anyway, so the browser resizes first and uploads less.
export const MAX_IMAGE_EDGE = 2576;

export const SUPPORTED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const FORMAT_SPEC = `Read this screenshot of a travel search-results page (or a photo of a handwritten travel note) and transcribe every priced option you can see into plain-text lines using this exact shorthand — one line per option, nothing else in your reply.

Line shapes (tag at the start of the line, colon, then the body):
  FLIGHT: <origin> to <destination>, <HH:MM>-<HH:MM>, <PRICE>, <airline or note>
  TRAIN: <origin> to <destination>, <HH:MM>-<HH:MM>, <PRICE>, <note>
  HOTEL: <place> - <short description>, <PRICE>/night x<nights>, <note>
  ACTIVITY: <name>, <PRICE>
  NOTE: <anything worth remembering that isn't a priced option>

Other tags that work the same way if they fit better: BUS, CAR, FERRY (travel), STAY, AIRBNB, APARTMENT (stay), TOUR, TICKET, VISIT, ATTRACTION (activity).

PRICE format: a currency symbol or 3-letter code immediately before the number — "EUR2100", "€2100", "USD612", "TRY116000" are all fine. Ranges: "EUR250-350". Free items: write "free". A points or miles price is not money: put it in the note (e.g. "45,000 points") and give the cash price only if one is shown. Never invent a price you can't actually read — write "price unclear" as the note instead and omit the currency+number.

Only transcribe what's visibly in the image — do not guess prices, times, or airline names that aren't shown. If nothing in the image matches this shape (e.g. it's not a travel screenshot at all), reply with exactly: NOTE: (nothing recognizable extracted)

Reply with ONLY the lines, no headers, no markdown code fences, no commentary.`;

// Tag a block of lines with a date window, the same way a WINDOW: line in
// the notes does, so two rounds of research never get mixed in combinations.
export function withWindow(lines, windowLabel) {
  const label = String(windowLabel || '').trim();
  if (!label) return lines;
  return `WINDOW: ${label}\n${lines}\nWINDOW:`;
}

// The prompt asks for bare lines, but a stray code fence costs nothing to strip.
export function cleanModelText(text) {
  return String(text || '').trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
}

export function buildScreenshotRequest(images, { model } = {}) {
  return {
    model: model || SCREENSHOT_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    // Refusal fallback: if the model declines, the API re-runs the request on
    // a fallback model instead of returning nothing.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: [
        ...images.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        })),
        { type: 'text', text: FORMAT_SPEC },
      ],
    }],
  };
}

// images: [{ mediaType, data }] with data as bare base64 (no data: prefix).
// Pass `browser: true` from the web app (the key is the user's own, typed into
// their own browser); omit apiKey in Node to let the SDK find credentials.
// `client` is for tests. Returns { notes, truncated, model }.
export async function extractNotesFromImages(images, { apiKey, model, browser = false, client } = {}) {
  if (!Array.isArray(images) || !images.length) throw new Error('No screenshots to read.');
  images.forEach((img, i) => {
    if (!img || !SUPPORTED_MEDIA_TYPES.includes(img.mediaType)) {
      throw new Error(`Screenshot ${i + 1} is not a supported image type (png, jpeg, webp, gif).`);
    }
    if (!img.data) throw new Error(`Screenshot ${i + 1} is empty.`);
  });

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = client || new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(browser ? { dangerouslyAllowBrowser: true } : {}),
  });

  let response;
  try {
    response = await anthropic.beta.messages.create(buildScreenshotRequest(images, { model }));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('That API key was rejected — check it at console.anthropic.com.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('That API key is not allowed to use this model.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the API — wait a minute and try again.');
    if (err instanceof Anthropic.BadRequestError) throw new Error(`The API rejected the request: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach api.anthropic.com — check your connection.');
    if (err instanceof Anthropic.APIError) throw new Error(`API error ${err.status}: ${err.message}`);
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details && response.stop_details.category;
    throw new Error(`The model declined to read this image${category ? ` (${category})` : ''}.`);
  }
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const notes = cleanModelText(text);
  if (!notes) throw new Error('The model returned no text for this screenshot.');
  return { notes, truncated: response.stop_reason === 'max_tokens', model: response.model };
}
