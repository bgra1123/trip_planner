# TripAgent: one server for Claude and your planner

TripAgent is the single MCP server that connects Claude to your trips. Claude
(in the Claude app, on your phone or anywhere) and the planner both use it, so
they share the same trips:

- **Share a screenshot** of your card portal's results and say *"add these to
  my Paris trip"*. Claude reads it and records each option.
- **Say it out loud.** *"Add a flight, New York to Paris, leaves 6:30 pm,
  lands 7:45 am, Air France, $612 for both of us."* Claude records it the same
  way. (Use voice input in the Claude app; there is nothing extra to set up.)
- **Correct it by voice.** *"The Air France one is actually $640"* or
  *"drop the hotel"*. Claude changes or removes what it recorded.
- **Search public options.** *"Find flights from New York to Paris on Oct 21
  and add the good ones to my Paris trip."* Claude uses whatever travel search
  connectors you have in the Claude app (for example Expedia, Kiwi.com,
  Booking.com, Tripadvisor), then records the results through TripAgent for you
  to review. TripAgent doesn't search anything itself; it's where the results
  are kept, compared and ranked.
- **Ask about your trip.** *"What's my cheapest way to do this trip?"* Claude
  reads the planner's own plan and ranks the combinations the way the
  planner does.

Everything Claude records waits in the planner's **TripAgent capture** panel
until you tap **Add**. Claude never edits your plan. Trips themselves need no
approval: Claude can start an empty trip when you ask, and it shows up in
your planner.

No Anthropic API key is involved; Claude reads the image or your voice as part
of your normal Claude chat. TripAgent is a small server on Cloudflare's free
tier. It exists because the planner keeps your trip in your browser's own
storage, which nothing outside that browser can reach.

> **One TripAgent only.** If you previously added a different "TripAgent"
> connector to Claude, remove it (Claude → Settings → Connectors → TripAgent →
> Disconnect) and add this one. Two servers of the same name means Claude
> sometimes talks to the one that isn't connected to your planner.

## One-time setup (about 15 minutes)

You need a free Cloudflare account and Node 18+ on a computer.

```bash
cd mcp-server
npm install
npx wrangler login                       # opens a browser to sign in to Cloudflare

npx wrangler kv namespace create TRIPS   # prints an id: paste it into wrangler.toml
                                         # (replace REPLACE_WITH_YOUR_KV_NAMESPACE_ID)

# Make a long random token. It is the only credential, keep it private.
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

npx wrangler secret put TRIP_TOKEN       # paste the token when asked
npx wrangler deploy                      # prints https://tripagent.<you>.workers.dev
```

Your **connector URL** is the deployed address plus `/mcp/` plus your token:

```
https://tripagent.<you>.workers.dev/mcp/<your-token>
```

Use that same URL in two places:

1. **Claude**: on claude.ai, open Settings → Connectors → *Add custom
   connector*, and paste the URL. Connectors you add there are also
   available in the Claude app on your phone. (Menu names may shift as the
   product changes; custom connectors may also depend on your Claude plan.
   If you don't see the option, check Claude's help center.)
2. **The planner**: open the **TripAgent capture** panel, paste it into
   **TripAgent connector URL**, and tap **Connect**.

Upgrading from the earlier version of this server (named `trip-planner-mcp`)?
`wrangler deploy` now publishes a worker named `tripagent`, so you get a new
URL host. Reuse the same KV namespace id and token if you like, update both
places above, and delete the old worker in the Cloudflare dashboard.

## Using it

1. Connect the planner once (above). Your trips are saved to TripAgent a moment
   after each change, and checked again whenever you come back to the planner.
2. In the Claude app, share a screenshot or speak. Say which trip if you have
   more than one; Claude asks when it isn't clear.
3. Claude replies with what it recorded and each option's id. Check the prices.
4. Open the planner (or switch back to it) and open the trip. The options are in
   the review list; tap **Add** on the ones you want, or ✕ to drop them.

**Capturing from Chrome.** The browser extension (`extension/`) sends what it
captures straight to TripAgent, into the trip that is open in your planner, so
the planner tab doesn't need to be open at the time and the options show up on
your phone as well. There's nothing to configure: when the planner is connected
and the extension is installed, the planner tells the extension where TripAgent
is. (You can also paste the URL into the extension popup.) If TripAgent isn't
set up or can't be reached, the extension falls back to pushing into an open
planner tab, as before. Captures from Chrome and from Claude land in the same
review list and de-duplicate against each other.

**Adding by card (no Claude needed).** The planner's **TripAgent capture** panel
opens on guided input cards: Flight, Train, Hotel, Activity. Fill a few clearly
labelled fields, or use **Say it or type it in one go**: type or dictate a
sentence ("flight from New York to Paris, leaves 6:30 pm, lands 7:45 am, Air
France, 612 dollars each for two travelers") and **Fill the card** puts what it
heard into the fields for you to check. On iPhone and Android, the keyboard's
microphone button dictates into any field, and browsers with speech recognition
also get a **Speak** button. The card refuses what would make a wrong number: a
price needs a currency you chose, a flight or train price needs "per traveler or
total" (and a count), and a per-night hotel price needs the nights. It never
decides those for you, even from a sentence ("for two travelers" alone doesn't
say whether $612 is each or total). What you add lands in the review list; nothing
reaches your plan until you tap Add there.

**Adding from a card portal (Capital One, Amex, …).** These show prices only
when you're logged in, so Claude can't look them up for you. Three ways in, best
first:

0. **Paste it into the planner (free).** Select all on the results page, copy,
   and paste into the planner's **Paste the results page's text** box. It reads
   the flights right there with no AI: no tokens, no API key, nothing to pay.
   Answer "per traveler or total?" first, as with every route. It tells you how
   many results it read and how many were cut off and skipped. If it can't read
   the text it says so, and you can use any route below.
1. **Copy the page text.** On the results page, select all, copy, and paste it
   into the Claude chat with *"add these to my Paris trip"*. Text is more
   reliable than a picture, works on iPhone, and Claude ignores the menus and
   filters around the results.
2. **Share a screenshot.** Quicker to take, but small print can be misread, so
   glance at the prices Claude repeats back.
3. **The Chrome extension** (desktop): one click on the results page, no Claude
   needed.

Legs are recorded between cities, not airports: results from Newark, JFK and
LaGuardia to Orly or Charles de Gaulle all become alternatives for one
New York → Paris leg, with the exact airports in the option's note. (The
Chrome extension does the same.) The same goes for the phone layout and the
desktop layout, which order a result's parts differently.

**Nothing guesses what a price covers.** A portal's flight price may be per
traveler or for everyone, and the page rarely says. Every route asks you:
- **Claude** asks (per traveler or total, how many people, round trip or one
  way) before it records a priced option. The server refuses priced options
  without your answer (`price_basis`), and does the multiplying itself, noting
  "$1,062 per traveler × 2". It reuses your answer for the rest of that
  conversation.
- **The Chrome extension** holds Capital One and Amex flights until you answer
  in the popup ("Confirm prices"), then sends them, totalled. It shows your
  answer back with a **Change** button, so it's never a hidden setting.
- **Read screenshot** in the planner won't run until you pick *Per traveler*
  (with a count) or *Total for everyone*.

Claude records the cash price in the card's currency (usually USD), puts any
miles/points price in the note, never counts points as cash, and notes the
program for hotels (for example Amex Fine Hotels + Resorts). Each option keeps a
link back to the page it came from when Claude knows it, and the review list
shows how old each price is, flagging anything over a day: portal fares move, so
recheck before you rely on an old one.

**Searching public options.** Add the travel connectors you want in Claude's
Settings → Connectors, then ask in plain words. Claude searches, records the
results with the search's name as the source, and tells you they're waiting in
your planner. Search results are live quotes: fares and rooms can change, and
nothing is booked. Ask Claude to re-search if a result gets old. A card portal
(Capital One, Amex) has no public search, so those still come in through a
screenshot or the browser extension.

**Several trips.** The bar at the top of the planner switches between trips and
creates, renames and deletes them. Deleting a trip also deletes it from
TripAgent, so Claude no longer sees it.

**Tools Claude has:** `list_trips`, `create_trip`, `add_trip_options`,
`update_trip_option`, `remove_trip_option`, `list_pending_options`,
`get_trip_path`, `optimize_trip`. You don't call these yourself; just ask.

**Who can change what.** Claude can only change options that are still waiting
for your review. Once you add one to the plan it is yours; Claude can read it
(and rank it) but not edit it. If you change an option's price in the planner's
table, tell Claude, since it works from the last sync.

## How it behaves

- **Nothing reaches your plan on its own.** Options wait in the review list
  until you tap Add, exactly like an extension capture.
- **Nothing is guessed.** A price without a currency is refused rather than
  assumed to be dollars or euros; a points or miles price is kept as a note,
  never counted as cash; every option is validated by the planner's own code.
  Prices are totals for everyone travelling, so Claude multiplies a per-person
  price by the number of travelers (and asks if it doesn't know).
- **Rankings match the planner.** `optimize_trip` uses the planner's own cost
  and window rules, including leaving out currencies you haven't set a rate
  for. It never mixes options from different date windows.
- **Nothing is lost on a reload.** Options stay on TripAgent until you add or
  dismiss them, so reloading just shows them again. A correction or removal by
  Claude replaces the old copy in your review list the next time the planner
  checks.
- **Trips follow the planner.** The planner owns each trip's contents. If you
  edit the same trip on two devices, the later edit wins.
- **Hotels compare by city.** Claude records each hotel's city, so hotels in
  the same city line up as alternatives for one stay rather than as separate
  stops.

## Security

The URL is the credential: anyone who has it can read your trips (routes and
prices) and add options to your review lists. They can't touch the copy of your
plan stored in your browser. Keep it private; to rotate it, run `npx wrangler
secret put TRIP_TOKEN` with a new token and update both places.

TripAgent only accepts planner requests from the GitHub Pages site and
localhost. If you host the planner elsewhere, set `ALLOWED_ORIGINS` in
`wrangler.toml`.

## Cost

Within Cloudflare's free tier for personal use. Each saved edit, recorded batch
and add/dismiss is one storage write, and the free tier allows a daily budget
far above what one person planning trips uses. Claude's reading of the
screenshot is part of your normal Claude usage.

## Testing it

```bash
cd mcp-server
npm test                                  # handler tests + official MCP client against the server in workerd
node test/planner-e2e.test.mjs            # full loop in a real browser (needs `npm start` running in the repo root)
```

The tests run the server locally with `wrangler dev`, no Cloudflare account
needed. The one thing they can't check is your actual deployment and Claude
reading a real screenshot or your voice; your first real try does that.
