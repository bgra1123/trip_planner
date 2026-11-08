# TripAgent iOS — Linux compile check

Date: 2026-11-08
Toolchain: Swift version 6.1 (swift-6.1-RELEASE), target x86_64-unknown-linux-gnu
(official tarball swift-6.1-RELEASE-ubuntu24.04.tar.gz from download.swift.org,
installed outside the repo; no extra apt packages were needed on Ubuntu 24.04)

Command, run from `ios/TripAgent`:

```
swiftc -parse-as-library Sources/Model/Models.swift Sources/Model/TextParsers.swift \
  Sources/MCP/MCPClient.swift Tests/ParserChecks.swift Tests/LinuxMain.swift \
  -o /tmp/checks && /tmp/checks
```

Result: **PASS** (`✓ parser checks passed`, exit 0)

Notes:
- All five files compiled with no errors and no warnings on the first attempt,
  so none of the expected Substring/String, optional or FoundationNetworking
  slips were present.
- The first run had one runtime failure:
  `✗ rich: activity price — PlanOption(id: "itm00004", picked: false,
  label: "Colosseum tour $90", price: "", window: "", detail: "")`
  The inline Activities list (`Activities included: [id] Colosseum tour $90;
  [id] Food walk no cash price`) has no comma before the price, and
  `planOption(fromLine:)` only split label/price on `", "`.

Files changed:
- `ios/TripAgent/Sources/Model/TextParsers.swift` — in `planOption(fromLine:)`,
  when no comma-separated price was found, split off a trailing token that
  starts with a currency symbol (`$ € £ ₺`) as the price, or a trailing
  "no cash price". Comma-formatted lines are unchanged; a label whose last
  token is a time or other number (e.g. `Delta 22:10–11:30`) is not split.
- `ios/COMPILE-CHECK.md` — this report.

Not covered by this check (need Apple frameworks): `Sources/MCP/Keychain.swift`,
`Sources/Store/TripStore.swift`, `Sources/Views/*`, `Sources/TripAgentApp.swift`,
`Tests/TripAgentTests.swift` (XCTest).
