# Getting started: plan a trip from your own portal offers

A walkthrough for the actual task this app is for: capture what your card's
travel portal (or any booking site) is quoting you, pull it into one place,
and let the planner rank every combination of flight × stay by cost — with
a stay's bundled card-program benefits shown alongside its price, not folded
into it.

Two things worth knowing before you start, so nothing here surprises you:

- **Nothing is hosted yet.** You run this on your own machine. There is no
  public URL — `npm start` opens it at `http://localhost:3000`.
- **The Capital One / Amex portal scrapers are unverified against a real
  account.** They were built and self-tested, but never confirmed against a
  live, logged-in session — no test account was available while building
  them. If *Capture this page* comes back empty on those two sites
  specifically, that's the known gap, not something you did wrong.
  Right-click-a-price works on every page, always, and is the fallback that
  never breaks — use it if automatic capture doesn't.

## 0. One-time setup

```bash
npm install
npm start                 # the planner, at http://localhost:3000 — leave this running
```

Load the extension, in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the `extension/` folder

Keep the planner tab open in the background from here on — captures push
into it automatically.

*(Optional, for live flight search instead of the manual capture below:
`npm run backend` in a second terminal, and set `AMADEUS_CLIENT_ID` /
`AMADEUS_CLIENT_SECRET` for real prices — see `backend/README.md`. Without
those it runs on sample data, clearly labelled as such.)*

## 1. Capture your portal's offers

Open your card's travel portal in a normal tab — Capital One Travel, Amex
Travel, or any flight/hotel site — log in, and search your route and dates.

- **If it's on the automatic list** (Capital One, Amex, Google Flights,
  Kayak, Skyscanner, Booking.com, Trainline, DB): results are picked up as
  they render, no click needed.
- **Otherwise, or if nothing showed up:** click the extension's toolbar icon
  → **Capture this page**. This works on *any* page, not just the sites
  above — it reads whatever tab you're looking at.
- **If a bank portal still comes back empty:** select the price with your
  mouse, right-click → **Add "…" to Trip Planner**. This never fails,
  because there's nothing to scrape — you're handing it the text directly.
- **On iPhone, or without the extension at all:** screenshot the results
  page, then in the planner's **TripAgent capture** panel pick it under
  **Screenshot** and tap **Read screenshot**. Claude reads the screenshot
  into staged options. The first time, paste your Anthropic API key
  (console.anthropic.com → API keys; create a dedicated key with a spend
  limit) and tap **Remember key** — it stays in that browser only and is
  sent only to api.anthropic.com. A screenshot costs a few cents to read.
  Points/miles prices are noted but never counted as cash, and a price the
  model can't make out is marked "price unclear" rather than guessed.

Repeat for each option you want to compare — a few flight times, a few
hotels, both through the portal and through a direct site if you want the
comparison.

## 2. Bring captures into your plan

Switch to the extension popup. You'll see items under **Scraped offers**
(or **Selected prices**, if you right-clicked). Click **Send to planner** —
if the planner tab is already open, this happens automatically as you
capture.

In the planner tab, open the **TripAgent capture** panel (click its header
to expand — it stays visible even with the rest of the notes editor
collapsed). Captured offers are staged here first, never applied straight to
your plan: check the route, time and price, then either **Add** a single one
or **Add all N to table**.

This staging step exists on purpose — a misread page costs you a glance
here, never a silently wrong itinerary.

## 3. Tag a hotel with its card program

If a captured or typed hotel option is booked through Amex Fine Hotels +
Resorts or Amex Hotel Collection, add `CARD:FHR` or `CARD:HC` anywhere in
that row's **Detail** column (edit the cell directly in the table, or add it
in the notes text as part of the `HOTEL:` line).

That option's card in the **Trip Path** view below now shows the program's
actual bundled benefits — a credit, a guaranteed checkout, an upgrade
chance — as a separate labelled list under the price. It is never folded
into the price or turned into a single "worth X% more" score; the point is
to let you see the real trade-off and decide for yourself. Only two
programs are wired up right now (see `src/utils/hotelCardBenefits.js` for
exactly what each includes, and when the terms were last checked) — an
untagged stay, or one on a program not yet in that file, behaves exactly as
before.

## 4. Let it rank the combinations

Once you have two or more options in any travel or stay group, the
**Time-Window Cost Analysis** table appears lower on the page: every valid
combination of your captured flights and hotels, ranked cheapest first.
Click any row to apply that combination to your plan immediately.

If you captured the same route across two different date ranges, tag each
capture's `Window` field before adding it (`14-19 Aug` vs `13-18 Aug`, say)
— the ranking will never mix options from different windows together.

## 5. Add non-euro prices

A captured price in a currency the app doesn't have a rate for shows up in
the table, but stays **out of your totals** rather than being guessed at
1:1. Add a `RATE: TRY 0.0181` line (EUR per unit) under *Edit trip data* — or
edit the Exchange Rates panel directly — and it folds in.

## 6. Add what you actually want to do

Below the price form in the **TripAgent capture** panel: paste a link (a
reel, a blog post, anything) into **Link**, type a short note about what you
liked in **What you liked**, and click **Save as activity**. It's added
straight to the table as an activity — no staging step here, since typing
the note already is the review. The link is kept, folded into the row's
detail, so it's never lost.

## 7. Export

Once you're happy with the picks, use **Export JSON** or **Export
Markdown** near the bottom of the page for a finished, shareable plan.

## If something doesn't show up

- **A bank portal captured nothing:** the known, unverified gap — see the
  note at the top. Right-click the price instead.
- **A captured price has no cost shown:** either the currency isn't one the
  app recognises yet (`€`/`$`/`£`/`₺`/CHF), or it's a points fare, which is
  never counted as cash. Either way it's kept — check the row's Detail
  column for the real number, and enter it by hand if you want it totalled.
- **A card program's benefits aren't showing:** only Fine Hotels + Resorts
  (`CARD:FHR`) and Hotel Collection (`CARD:HC`) are wired up today. Anything
  else needs adding to `src/utils/hotelCardBenefits.js` first.
