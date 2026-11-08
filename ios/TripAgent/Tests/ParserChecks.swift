import Foundation

// Checks against replies the live server actually sent (captured 2026-11-08),
// so the parsers are pinned to the real formats, not to what they were meant
// to be. Run by XCTest in Xcode and by LinuxMain on a plain Swift toolchain.
enum ParserChecks {
    static let listTripsReply = """
    2 trips, newest first:
    - t2r6f274r2i4l4n6k3p: Istanbul in December — 0 in plan, 1 waiting for review [current]
    - t6r3v510l366v4k5f3h: Paris, Oct 23 – Nov 5 (Untitled p615g4x5 → Untitled p615g4x5) — 1 in plan, 0 waiting for review
    """

    static let showTripReply = """
    "Paris, Oct 23 – Nov 5" — Untitled p615g4x5 → Untitled p615g4x5 (trip id t6r3v510l366v4k5f3h; totals in USD)
    Date windows: Oct 29 - Nov 5. Showing: Oct 29 - Nov 5.
    1. Travel Untitled p615g4x5
       ✓ [p615g4x5] Delta Airlines, $1,338 {Oct 29 - Nov 5} — 2 travelers · USD 669 per traveler × 2 · via Capital One Travel · priced 25d ago — recheck
    Total of the picked options: $1,338
    """

    // A fuller plan in the same format: alternatives, a stay, activities, waiting count.
    static let richShowTripReply = """
    “Rome in May” — NYC → ROM (trip id tabc123456; totals in USD)
    Date windows: 2-9 May, 10-17 May. Showing: 2-9 May.
    1. Travel NYC → ROM
       ✓ [itm00001] ITA Airways 18:30–07:45, $1,224 {2-9 May} — USD 612 per traveler × 2 · via Capital One Travel · priced 2h ago
         [itm00002] Delta 22:10–11:30, $1,096 {2-9 May} — via Amex Travel · priced 2h ago
    2. Stay Rome
       ✓ [itm00003] Hotel Tiber, $280/night x3 {2-9 May} — Amex FHR · via Amex Travel · priced 1d ago — recheck
    Activities included: [itm00004] Colosseum tour $90; [itm00005] Food walk no cash price
    Total of the picked options: $2,154
    3 options waiting for review.
    """

    static let pendingReply = """
    {"tripId":"t2r6f274r2i4l4n6k3p","options":[{"kind":"flight","category":"travel","group":"JFK → IST","carrier":"Turkish Airlines","departure":"","arrival":"","duration":"","stops":0,"price":{"low":1177.39,"high":1177.39,"currency":"USD"},"perNight":false,"nights":1,"window":"2-9 Dec","label":"Turkish Airlines nonstop JFK-IST round trip","detail":"Round trip, Dec 2 out, Dec 9 return; total price","source":"Amex Travel","sourceUrl":"","capturedAt":"2026-11-07T16:05:09.783Z","id":"ta_109udv1"}]}
    """

    // Returns the failures; empty means all passed.
    static func run() -> [String] {
        var failures: [String] = []
        func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String = "") { if !ok { failures.append(name + (detail().isEmpty ? "" : " — " + detail())) } }

        let trips = TextParsers.trips(from: listTripsReply)
        check("two trips", trips.count == 2, "\(trips.count)")
        check("first trip id", trips.first?.id == "t2r6f274r2i4l4n6k3p")
        check("first trip title", trips.first?.title == "Istanbul in December", trips.first?.title ?? "")
        check("first trip counts", trips.first?.inPlan == 0 && trips.first?.waiting == 1)
        check("first trip is current", trips.first?.isCurrent == true)
        check("second trip title keeps its comma and dash", trips.last?.title == "Paris, Oct 23 – Nov 5", trips.last?.title ?? "")
        check("second trip route", trips.last?.route == "Untitled p615g4x5 → Untitled p615g4x5", trips.last?.route ?? "")
        check("second trip counts", trips.last?.inPlan == 1 && trips.last?.waiting == 0)
        check("second trip not current", trips.last?.isCurrent == false)
        check("no trips yet parses to nothing", TextParsers.trips(from: "No trips yet. Ask the user whether to start one.").isEmpty)

        let d = TextParsers.tripDetail(from: showTripReply, tripIdHint: "x")
        check("trip id from header", d.tripId == "t6r3v510l366v4k5f3h", d.tripId)
        check("title from header", d.title == "Paris, Oct 23 – Nov 5", d.title)
        check("route from header", d.route == "Untitled p615g4x5 → Untitled p615g4x5", d.route)
        check("currency", d.currency == "USD", d.currency)
        check("windows", d.windows == ["Oct 29 - Nov 5"] && d.showingWindow == "Oct 29 - Nov 5", "\(d.windows) / \(d.showingWindow)")
        check("one travel section", d.sections.count == 1 && d.sections.first?.kind == .travel && d.sections.first?.key == "Untitled p615g4x5", "\(d.sections.map(\.key))")
        let o = d.sections.first?.options.first
        check("the option id", o?.id == "p615g4x5", o?.id ?? "")
        check("the option is picked", o?.picked == true)
        check("the option label", o?.label == "Delta Airlines", o?.label ?? "")
        check("the option price", o?.price == "$1,338", o?.price ?? "")
        check("the option window", o?.window == "Oct 29 - Nov 5", o?.window ?? "")
        check("the option detail", o?.detail.hasPrefix("2 travelers · USD 669 per traveler × 2") == true, o?.detail ?? "")
        check("a stale price is flagged", o?.stale == true)
        check("total", d.total == "$1,338", d.total)
        check("raw kept", d.raw == showTripReply)

        let r = TextParsers.tripDetail(from: richShowTripReply, tripIdHint: "x")
        check("rich: id", r.tripId == "tabc123456", r.tripId)
        check("rich: curly-quoted title", r.title == "Rome in May", r.title)
        check("rich: route", r.route == "NYC → ROM", r.route)
        check("rich: two windows", r.windows == ["2-9 May", "10-17 May"] && r.showingWindow == "2-9 May", "\(r.windows)")
        check("rich: three sections", r.sections.map(\.kind) == [.travel, .stay, .activities], "\(r.sections.map(\.kind))")
        check("rich: travel has two options", r.sections[0].options.count == 2, "\(r.sections[0].options.count)")
        check("rich: alternative not picked", r.sections[0].options[1].picked == false && r.sections[0].options[1].id == "itm00002")
        check("rich: label with times", r.sections[0].options[1].label == "Delta 22:10–11:30", r.sections[0].options[1].label)
        check("rich: alternative price", r.sections[0].options[1].price == "$1,096", r.sections[0].options[1].price)
        check("rich: stay option", r.sections[1].key == "Rome" && r.sections[1].options.first?.label == "Hotel Tiber" && r.sections[1].options.first?.price == "$280/night x3", "\(r.sections[1])")
        check("rich: activities", r.sections[2].options.map(\.id) == ["itm00004", "itm00005"], "\(r.sections[2].options.map(\.id))")
        check("rich: activity price", r.sections[2].options[0].price == "$90" && r.sections[2].options[0].label == "Colosseum tour", "\(r.sections[2].options[0])")
        check("rich: total", r.total == "$2,154", r.total)
        check("rich: waiting count", r.waitingCount == 3, "\(r.waitingCount)")

        check("an empty plan parses to no sections", TextParsers.tripDetail(from: "\"T\" has nothing in its plan yet.", tripIdHint: "t1").isEmpty)

        if let data = pendingReply.data(using: .utf8), let p = try? JSONDecoder().decode(PendingReply.self, from: data) {
            check("pending: one option", p.options.count == 1)
            let w = p.options[0]
            check("pending: id", w.id == "ta_109udv1")
            check("pending: price text", w.priceText == "$1,177.39", w.priceText)
            check("pending: title", w.title == "Turkish Airlines nonstop JFK-IST round trip", w.title)
            check("pending: nonstop", w.stops == 0)
            check("pending: empty times give no when", w.when.isEmpty, w.when)
        } else {
            check("pending reply decodes", false)
        }
        let noPriceJSON = pendingReply.replacingOccurrences(of: "\"price\":{\"low\":1177.39,\"high\":1177.39,\"currency\":\"USD\"}", with: "\"price\":null")
        let noPrice = (try? JSONDecoder().decode(PendingReply.self, from: Data(noPriceJSON.utf8)))?.options.first
        check("pending: a points-only fare has no cash price", noPrice?.priceText == "no cash price", noPrice?.priceText ?? "nil")

        check("ids in a reply", TextParsers.ids(in: "Recorded 2: [ta_1] x [ta_2] y — [current]") == ["ta_1", "ta_2"])
        check("connector URL accepted", MCPClient.validate("https://tripagent.me.workers.dev/mcp/abcdefghijklmnopqrstuvwx") != nil)
        check("connector URL with a short token refused", MCPClient.validate("https://tripagent.me.workers.dev/mcp/short") == nil)
        check("plain http to a real host refused", MCPClient.validate("http://evil.example/mcp/abcdefghijklmnopqrstuvwx") == nil)
        check("localhost allowed for a dev server", MCPClient.validate("http://localhost:8787/mcp/abcdefghijklmnopqrstuvwx") != nil)
        check("a non-connector path refused", MCPClient.validate("https://tripagent.me.workers.dev/api/abcdefghijklmnopqrstuvwx/trips") == nil)
        check("SSE body: last data line", String(decoding: MCPClient.lastEventData(from: Data("event: message\ndata: {\"a\":1}\n\ndata: {\"b\":2}\n".utf8)), as: UTF8.self) == "{\"b\":2}")
        return failures
    }
}
