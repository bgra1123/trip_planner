# Record prices by sharing a screenshot with Claude

Share a screenshot of your card portal's results with Claude in the Claude
app — on your phone or anywhere — and say *"add these to my trip planner"*.
Claude reads the screenshot and records each option through an MCP
connector. Open the planner and they're waiting in the **TripAgent capture**
panel for you to review and add.

No Anthropic API key is involved: Claude reads the image as part of your
normal Claude chat. The connector is a small server you run on Cloudflare's
free tier. It exists because the planner keeps your trip in your browser's
own storage, which nothing outside that browser can write to — the
connector is the shared place both Claude and the planner can reach.

## One-time setup (about 15 minutes)

You need a free Cloudflare account and Node 18+ on a computer.

```bash
cd mcp-server
npm install
npx wrangler login                       # opens a browser to sign in to Cloudflare

npx wrangler kv namespace create TRIPS   # prints an id — paste it into wrangler.toml
                                         # (replace REPLACE_WITH_YOUR_KV_NAMESPACE_ID)

# Make a long random token. It is the only credential — keep it private.
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

npx wrangler secret put TRIP_TOKEN       # paste the token when asked
npx wrangler deploy                      # prints https://trip-planner-mcp.<you>.workers.dev
```

Your **connector URL** is the deployed address plus `/mcp/` plus your token:

```
https://trip-planner-mcp.<you>.workers.dev/mcp/<your-token>
```

Use that same URL in two places:

1. **Claude** — on claude.ai, open Settings → Connectors → *Add custom
   connector*, and paste the URL. Connectors you add there are also
   available in the Claude app on your phone. (Menu names may shift as the
   product changes; custom connectors may also depend on your Claude plan —
   if you don't see the option, check Claude's help center.)
2. **The planner** — open the **TripAgent capture** panel, paste it into
   **Claude connector URL**, and tap **Connect**.

## Using it

1. Search on your card portal and take a screenshot of the results.
2. In the Claude app, attach the screenshot and say something like
   *"Add these options to my trip planner for 21-24 Oct."* Claude may ask
   once for permission to use the connector's tool.
3. Claude replies with what it recorded — check the prices against the
   screenshot.
4. Open the planner (or switch back to it). It checks for new options when
   it opens and whenever you return to it. They appear in the review list;
   tap **Add** on the ones you want, or ✕ to drop them.

Ask Claude *"what's waiting in my trip planner?"* to see what has been
recorded but not yet reviewed.

## How it behaves

- **Nothing reaches your plan on its own.** Options wait in the review list
  until you tap Add, exactly like an extension capture.
- **Nothing is guessed.** A price without a currency is refused rather than
  assumed to be dollars or euros; a points or miles price is kept as a note,
  never counted as cash; every option is validated by the planner's own code.
- **Nothing is lost on a reload.** Options stay on the connector until you
  add or dismiss them in the planner, so reloading the page just shows them
  again.
- **Hotels compare by city.** Claude records each hotel's city, so hotels in
  the same city line up as alternatives for one stay rather than as separate
  stops.

## Security

The URL is the credential: anyone who has it can add options to your review
list and see what's waiting there (routes and prices). They can't touch your
plan itself. Keep it private; to rotate it, run `npx wrangler secret put
TRIP_TOKEN` with a new token and update both places.

The connector only accepts planner requests from the GitHub Pages site and
localhost. If you host the planner elsewhere, set `ALLOWED_ORIGINS` in
`wrangler.toml`.

## Cost

Within Cloudflare's free tier for personal use — each recorded batch and each
add/dismiss is one storage write, and the free tier allows a daily budget far
above what one person planning trips uses. Claude's reading of the screenshot
is part of your normal Claude usage.

## Testing it

```bash
cd mcp-server
npm test                                  # handler tests + official MCP client against the worker in workerd
node test/planner-e2e.test.mjs            # full loop in a real browser (needs `npm start` running in the repo root)
```

The tests run the worker locally with `wrangler dev` — no Cloudflare account
needed. The one thing they can't check is your actual deployment and Claude
reading a real screenshot; your first real try does that.
