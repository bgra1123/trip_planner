import Foundation

// The server answers list_trips and show_trip as text — the same text Claude
// reads. These parsers lift the parts the app needs out of it and keep the
// rest verbatim, so a line the parser doesn't recognize is still shown rather
// than lost. The formats are the server's own; the tests pin real replies.

enum TextParsers {
    // "- t2r6f...: Istanbul in December — 0 in plan, 1 waiting for review [current]"
    // "- t6r3v...: Paris, Oct 23 – Nov 5 (NYC → PAR) — 1 in plan, 0 waiting for review"
    static func trips(from text: String) -> [TripSummary] {
        var out: [TripSummary] = []
        for rawLine in text.split(separator: "\n") {
            let line = String(rawLine)
            guard line.hasPrefix("- "), let colon = line.firstIndex(of: ":") else { continue }
            let id = String(line[line.index(line.startIndex, offsetBy: 2)..<colon]).trimmingCharacters(in: .whitespaces)
            guard isTripId(id) else { continue }
            var rest = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            let isCurrent = rest.hasSuffix("[current]") || rest.contains("[open in the planner now]")
            rest = rest.replacingOccurrences(of: " [current]", with: "").replacingOccurrences(of: " [open in the planner now]", with: "")
            // "Title (route) — N in plan, M waiting for review"
            var title = rest, route = "", inPlan = 0, waiting = 0
            if let dash = rest.range(of: " — ", options: .backwards) {
                title = String(rest[..<dash.lowerBound])
                let counts = String(rest[dash.upperBound...])
                inPlan = firstInt(in: counts, before: " in plan") ?? 0
                waiting = firstInt(in: counts, before: " waiting") ?? 0
            }
            if title.hasSuffix(")"), let open = title.range(of: " (", options: .backwards) {
                route = String(title[open.upperBound..<title.index(before: title.endIndex)])
                title = String(title[..<open.lowerBound])
            }
            out.append(TripSummary(id: id, title: title, route: route, inPlan: inPlan, waiting: waiting, isCurrent: isCurrent))
        }
        return out
    }

    // The reply to show_trip. See Models.swift for the shape it fills.
    static func tripDetail(from text: String, tripIdHint: String) -> TripDetail {
        var detail = TripDetail(tripId: tripIdHint, title: "", route: "", currency: "", windows: [], showingWindow: "", sections: [], total: "", waitingCount: 0, raw: text)
        var current: PlanSection?
        func close() { if let s = current { detail.sections.append(s) }; current = nil }

        for (index, rawLine) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let line = String(rawLine)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if index == 0 {
                // "“Title” — route (trip id X; totals in USD)"  (title in straight or curly quotes)
                var head = trimmed
                if let open = head.range(of: " (trip id "), let close = head.range(of: ")", options: .backwards), close.lowerBound > open.upperBound {
                    let meta = String(head[open.upperBound..<close.lowerBound])
                    let bits = meta.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
                    if let id = bits.first, isTripId(id) { detail.tripId = id }
                    if let cur = bits.dropFirst().first(where: { $0.hasPrefix("totals in ") }) { detail.currency = String(cur.dropFirst("totals in ".count)) }
                    head = String(head[..<open.lowerBound])
                }
                let quotes: [Character] = ["\"", "\u{201C}", "\u{201D}"]
                if let q0 = head.firstIndex(where: { quotes.contains($0) }), let q1 = head.lastIndex(where: { quotes.contains($0) }), q1 > q0 {
                    detail.title = String(head[head.index(after: q0)..<q1])
                    let after = String(head[head.index(after: q1)...])
                    if let dash = after.range(of: " — ") { detail.route = String(after[dash.upperBound...]).trimmingCharacters(in: .whitespaces) }
                } else {
                    detail.title = head
                }
                continue
            }
            if trimmed.hasPrefix("Date windows:") {
                // "Date windows: A, B. Showing: A."
                var body = String(trimmed.dropFirst("Date windows:".count))
                if let show = body.range(of: "Showing:") {
                    detail.showingWindow = String(body[show.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: " ."))
                    body = String(body[..<show.lowerBound])
                }
                detail.windows = body.trimmingCharacters(in: CharacterSet(charactersIn: " .")).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                continue
            }
            if trimmed.hasPrefix("Total of the picked options:") {
                detail.total = String(trimmed.dropFirst("Total of the picked options:".count)).trimmingCharacters(in: .whitespaces)
                continue
            }
            if let n = firstInt(in: trimmed, before: " option"), trimmed.contains("waiting for review") {
                detail.waitingCount = n
                continue
            }
            // "1. Travel NYC → PAR"  /  "2. Stay Paris"
            if let dot = trimmed.firstIndex(of: "."), Int(trimmed[..<dot]) != nil {
                let after = trimmed[trimmed.index(after: dot)...].trimmingCharacters(in: .whitespaces)
                for kind in [PlanSection.Kind.travel, .stay] where after.hasPrefix(kind.rawValue + " ") {
                    close()
                    current = PlanSection(kind: kind, key: String(after.dropFirst(kind.rawValue.count + 1)), options: [])
                }
                if current?.key == String(after.dropFirst((current?.kind.rawValue.count ?? 0) + 1)) { continue }
            }
            if trimmed.hasPrefix("Activities") {
                close()
                current = PlanSection(kind: .activities, key: "", options: [])
                // Activities may be listed inline: "Activities included: A $10; B $20" — kept raw below.
                if let colon = trimmed.firstIndex(of: ":") {
                    let list = trimmed[trimmed.index(after: colon)...].split(separator: ";")
                    for item in list {
                        let t = item.trimmingCharacters(in: .whitespaces)
                        if let opt = planOption(fromLine: t) { current?.options.append(opt) } else if !t.isEmpty { current?.options.append(PlanOption(id: "", picked: true, label: t, price: "", window: "", detail: "")) }
                    }
                }
                continue
            }
            if let opt = planOption(fromLine: trimmed), current != nil {
                current?.options.append(opt)
                continue
            }
        }
        close()
        return detail
    }

    // "✓ [p615g4x5] Delta Airlines, $1,338 {Oct 29 - Nov 5} — 2 travelers · via Capital One Travel"
    // "  [abc12345] Air France, $612"
    static func planOption(fromLine lineIn: String) -> PlanOption? {
        var line = lineIn
        var picked = false
        if line.hasPrefix("✓") { picked = true; line = String(line.dropFirst()).trimmingCharacters(in: .whitespaces) }
        guard line.hasPrefix("["), let close = line.firstIndex(of: "]") else { return nil }
        let id = String(line[line.index(after: line.startIndex)..<close])
        guard !id.isEmpty, !id.contains(" ") else { return nil }
        var rest = String(line[line.index(after: close)...]).trimmingCharacters(in: .whitespaces)
        var detail = ""
        if let dash = rest.range(of: " — ") { detail = String(rest[dash.upperBound...]); rest = String(rest[..<dash.lowerBound]) }
        var window = ""
        if let open = rest.range(of: " {"), rest.hasSuffix("}") {
            window = String(rest[open.upperBound..<rest.index(before: rest.endIndex)])
            rest = String(rest[..<open.lowerBound])
        }
        var label = rest, price = ""
        if let comma = rest.range(of: ", ", options: .backwards) {
            let tail = String(rest[comma.upperBound...])
            if tail.first.map({ "$€£₺0123456789".contains($0) }) == true || tail.hasPrefix("no cash price") || tail.range(of: #"^[A-Z]{3} "#, options: .regularExpression) != nil {
                price = tail
                label = String(rest[..<comma.lowerBound])
            }
        }
        return PlanOption(id: id, picked: picked, label: label, price: price, window: window, detail: detail)
    }

    // "Recorded 3 options in "Paris" for review:" / "Updated." etc. — the ids a reply mentions.
    static func ids(in text: String) -> [String] {
        var out: [String] = []
        var rest = Substring(text)
        while let open = rest.firstIndex(of: "["), let close = rest[open...].firstIndex(of: "]") {
            let id = String(rest[rest.index(after: open)..<close])
            if !id.isEmpty, !id.contains(" "), id != "current" { out.append(id) }
            rest = rest[rest.index(after: close)...]
        }
        return out
    }

    static func isTripId(_ s: String) -> Bool {
        s.count >= 6 && s.count <= 40 && s.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
    }

    static func firstInt(in text: String, before marker: String) -> Int? {
        guard let r = text.range(of: marker) else { return nil }
        let head = text[..<r.lowerBound]
        let digits = head.reversed().prefix { $0.isNumber }
        return Int(String(digits.reversed()))
    }
}
