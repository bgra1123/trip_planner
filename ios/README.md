# TripAgent for iPhone

A native SwiftUI app that shows your trips, the options waiting for your review
and the plan, straight from your TripAgent server — the same server Claude and
the web planner use. Approve, dismiss and pick options; add one by card.

It talks to the server the way Claude does (MCP over HTTPS), so it works with
the server you have deployed, whatever version it is, as long as the tool names
match. What you see is what the server holds; the app keeps nothing of its own
except the connector URL, in the Keychain.

## Build (on a Mac with Xcode 16+)

```bash
brew install xcodegen          # once
cd ios/TripAgent
xcodegen generate
open TripAgent.xcodeproj
```

In Xcode: pick your team under *Signing & Capabilities* (automatic signing),
choose your iPhone, press Run. The first time, allow the developer certificate
on the phone (Settings → General → VPN & Device Management).

Run the tests with ⌘U: they check the parsers against real server replies.

## Use

Settings (gear) → paste the connector URL you gave Claude → Connect. Trips
appear; pull to refresh. Open a trip:

- **Waiting for your review**: what Claude or the extension recorded. Approve
  puts it in the plan, Dismiss drops it.
- **Travel / Stay sections**: the plan. The ticked option is the one in the
  total; tap the circle (or swipe) to pick another. Swipe left to remove.
- Waiting options show their fare and cabin when recorded.
- **+** adds an option by card, including the fare name and cabin. Like everywhere else, a price needs a currency,
  a flight price needs "per traveler or total" (and a count), and the platform
  it came from is required — the server refuses otherwise.
- **Rank combinations by cost** is the planner's optimizer.
- **Show what Claude sees** is the server's own text, in case the app's view
  missed something.

## Known limits

- Built without a Mac: the parsers are tested, the screens are not. The first
  Xcode build may need a fix; paste any error here.
- The server answers `show_trip` and `list_trips` as text; the app parses that
  text. A server change to those formats shows up as a missing field in the
  app, never as wrong data — the raw text is always one tap away.
- No offline mode and no notifications.
