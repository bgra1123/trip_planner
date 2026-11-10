import Foundation

// What the app shows. Trips and the plan come from the server's text replies
// (parsed in TextParsers.swift); waiting options come as JSON.

struct TripSummary: Identifiable, Equatable {
    var id: String
    var title: String
    var route: String
    var inPlan: Int
    var waiting: Int
    var isCurrent: Bool
}

// One option already in the plan, as show_trip lists it under a leg or stay.
struct PlanOption: Identifiable, Equatable {
    var id: String          // the [itemId] the server prints; what pick_option takes
    var picked: Bool
    var label: String       // "Delta Airlines"
    var price: String       // "$1,338" or "" when none
    var window: String      // "Oct 29 - Nov 5" or ""
    var detail: String      // "2 travelers · USD 669 per traveler × 2 · via Capital One Travel · priced 25d ago — recheck"
    var stale: Bool { detail.contains("recheck") }
}

struct PlanSection: Identifiable, Equatable {
    enum Kind: String { case travel = "Travel", stay = "Stay", activities = "Activities" }
    var id: String { "\(kind.rawValue):\(key)" }
    var kind: Kind
    var key: String         // "NYC → PAR", "Paris"
    var options: [PlanOption]
}

struct TripDetail: Equatable {
    var tripId: String
    var title: String
    var route: String
    var currency: String
    var windows: [String]
    var showingWindow: String
    var sections: [PlanSection]
    var total: String
    var waitingCount: Int
    var raw: String         // the whole reply, for anything the parser didn't place
    var isEmpty: Bool { sections.isEmpty }
}

// An option waiting for review — the server's own offer shape.
struct PendingOption: Identifiable, Codable, Equatable {
    struct Price: Codable, Equatable { var low: Double; var high: Double; var currency: String }
    var id: String
    var kind: String
    var category: String?
    var group: String?
    var carrier: String?
    var fare: String?
    var cabin: String?
    var departure: String?
    var arrival: String?
    var duration: String?
    var stops: Int?
    var price: Price?
    var perNight: Bool?
    var nights: Int?
    var window: String?
    var label: String?
    var detail: String?
    var source: String?
    var sourceUrl: String?
    var capturedAt: String?

    var title: String {
        if let label, !label.isEmpty { return label }
        var parts: [String] = []
        if let carrier, !carrier.isEmpty { parts.append(carrier) }
        if let departure, !departure.isEmpty { parts.append("\(departure) departure") }
        if parts.isEmpty, let group, !group.isEmpty { parts.append(group) }
        return parts.isEmpty ? "Captured option" : parts.joined(separator: " ")
    }

    var priceText: String {
        guard let price else { return "no cash price" }
        let symbol: String
        switch price.currency { case "USD": symbol = "$"; case "EUR": symbol = "€"; case "GBP": symbol = "£"; case "TRY": symbol = "₺"; default: symbol = price.currency + " " }
        func fmt(_ n: Double) -> String {
            let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 2
            return f.string(from: NSNumber(value: n)) ?? String(n)
        }
        let range = price.low == price.high ? fmt(price.low) : "\(fmt(price.low))–\(fmt(price.high))"
        let night = (perNight ?? false) ? "/night × \(nights ?? 1)" : ""
        return symbol + range + night
    }

    var cabinLabel: String {
        switch cabin ?? "" {
        case "economy": return "Economy"; case "premium_economy": return "Premium economy"
        case "business": return "Business"; case "first": return "First"; default: return ""
        }
    }
    var fareText: String { [fare ?? "", cabinLabel].filter { !$0.isEmpty }.joined(separator: " · ") }

    var when: String {
        let dep = departure ?? "", arr = arrival ?? ""
        if dep.isEmpty && arr.isEmpty { return "" }
        return "\(dep.isEmpty ? "–" : dep)–\(arr.isEmpty ? "–" : arr)"
    }
}

struct PendingReply: Codable {
    var tripId: String
    var options: [PendingOption]
}
