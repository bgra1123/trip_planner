import Foundation
import SwiftUI

// One object the views share: the connector, the trips, the open trip's plan
// and waiting options, and every action. Each action is one tool call — the
// same tools Claude uses — followed by a reload, so what the app shows is
// always what the server holds, never a local guess.

@MainActor
final class TripStore: ObservableObject {
    @Published var connectorURL: String = Keychain.read()
    @Published var trips: [TripSummary] = []
    @Published var detail: TripDetail?
    @Published var pending: [PendingOption] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var notice: String?

    private var client: MCPClient?

    var isConfigured: Bool { MCPClient.validate(connectorURL) != nil }

    func setConnector(_ url: String) {
        connectorURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        Keychain.write(connectorURL)
        client = nil
        trips = []; detail = nil; pending = []; error = nil
    }

    private func mcp() throws -> MCPClient {
        if let client { return client }
        guard let url = MCPClient.validate(connectorURL) else { throw MCPError.notConfigured }
        let c = MCPClient(endpoint: url)
        client = c
        return c
    }

    // Runs one tool call with the loading flag and error reporting handled.
    @discardableResult
    private func call(_ name: String, _ args: [String: Any] = [:], quiet: Bool = false) async -> ToolResult? {
        if !quiet { isLoading = true }
        defer { if !quiet { isLoading = false } }
        do {
            let result = try await mcp().callTool(name, arguments: args)
            if result.isError { error = result.text; return nil }
            error = nil
            return result
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func refreshTrips() async {
        guard let r = await call("list_trips") else { return }
        trips = TextParsers.trips(from: r.text)
    }

    func load(trip id: String) async {
        isLoading = true
        defer { isLoading = false }
        async let shown = call("show_trip", ["tripId": id], quiet: true)
        async let waiting = call("list_pending_options", ["tripId": id], quiet: true)
        if let s = await shown { detail = TextParsers.tripDetail(from: s.text, tripIdHint: id) }
        if let w = await waiting {
            if let data = w.text.data(using: .utf8), let reply = try? JSONDecoder().decode(PendingReply.self, from: data) {
                pending = reply.options
            } else {
                pending = []   // "Nothing is waiting for review…" comes as text
            }
        }
    }

    private func reload(_ id: String) async {
        await load(trip: id)
        await refreshTrips()
    }

    func approve(_ ids: [String], in trip: String) async {
        if let r = await call("approve_options", ["tripId": trip, "optionIds": ids]) { notice = r.text }
        await reload(trip)
    }

    func dismiss(_ ids: [String], in trip: String) async {
        if let r = await call("dismiss_options", ["tripId": trip, "optionIds": ids]) { notice = r.text }
        await reload(trip)
    }

    func pick(_ itemId: String, in trip: String) async {
        if let r = await call("pick_option", ["tripId": trip, "itemId": itemId]) { notice = r.text }
        await reload(trip)
    }

    func removeFromPlan(_ itemIds: [String], in trip: String) async {
        if let r = await call("remove_from_plan", ["tripId": trip, "itemIds": itemIds]) { notice = r.text }
        await reload(trip)
    }

    // Returns the server's reply text (what it recorded, or why not).
    func addOption(_ option: [String: Any], source: String, window: String, basis: String?, travelers: Int?, in trip: String) async -> String? {
        var args: [String: Any] = ["tripId": trip, "source": source, "options": [option]]
        if !window.isEmpty { args["window"] = window }
        if let basis { args["price_basis"] = basis }
        if let travelers { args["travelers"] = travelers }
        let r = await call("add_trip_options", args)
        await reload(trip)
        return r?.text
    }

    func setCurrent(_ id: String) async {
        _ = await call("set_current_trip", ["tripId": id])
        await refreshTrips()
    }

    func createTrip(title: String) async -> String? {
        guard let r = await call("create_trip", ["title": title]) else { return nil }
        await refreshTrips()
        // "Created trip t2r6f… ("Paris")…" — the first word that looks like a trip id.
        return r.text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "(" })
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:\"")) }
            .first(where: { $0.hasPrefix("t") && $0.count >= 10 && TextParsers.isTripId($0) })
    }

    func deleteTrip(_ id: String) async {
        _ = await call("delete_trip", ["tripId": id])
        if detail?.tripId == id { detail = nil; pending = [] }
        await refreshTrips()
    }

    func optimize(_ id: String) async -> String? {
        await call("optimize_trip", ["tripId": id, "limit": 10])?.text
    }
}
