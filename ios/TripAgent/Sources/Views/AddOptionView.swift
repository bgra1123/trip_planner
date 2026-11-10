import SwiftUI

// The input card, as in the planner: pick what you're adding, fill the few
// fields that kind needs, and it goes to the trip's review list. The server
// refuses what would make a wrong number — a price with no currency, a
// flight price with no "per traveler or total" answer — so the form asks for
// those before it lets you send.

struct AddOptionView: View {
    @EnvironmentObject var store: TripStore
    @Environment(\.dismiss) private var dismiss
    let tripId: String

    @State private var kind = "flight"
    @State private var from = ""
    @State private var to = ""
    @State private var departure = ""
    @State private var arrival = ""
    @State private var carrier = ""
    @State private var fare = ""
    @State private var cabin = ""
    @State private var stops = -1
    @State private var place = ""
    @State private var name = ""
    @State private var perNight = true
    @State private var nights = 1
    @State private var price = ""
    @State private var currency = "USD"
    @State private var basis = ""
    @State private var travelers = 2
    @State private var source = ""
    @State private var window = ""
    @State private var note = ""
    @State private var url = ""
    @State private var reply: String?
    @State private var sending = false

    private let kinds = ["flight", "train", "hotel", "activity"]
    private let currencies = ["USD", "EUR", "GBP", "TRY", "CHF"]
    private let sources = ["Capital One Travel", "Amex Travel", "Google Flights", "Expedia", "Kiwi.com", "Booking.com", "dictated"]

    private var isTravel: Bool { kind == "flight" || kind == "train" }
    private var priceValue: Double? { Double(price.replacingOccurrences(of: ",", with: "")) }
    private var hasPrice: Bool { !price.trimmingCharacters(in: .whitespaces).isEmpty }

    private var problem: String? {
        if isTravel {
            if from.trimmingCharacters(in: .whitespaces).isEmpty { return "Where from?" }
            if to.trimmingCharacters(in: .whitespaces).isEmpty { return "Where to?" }
        } else if kind == "hotel", place.trimmingCharacters(in: .whitespaces).isEmpty {
            return "Which city is the hotel in?"
        } else if kind == "activity", name.trimmingCharacters(in: .whitespaces).isEmpty {
            return "What is the activity?"
        }
        if hasPrice {
            guard let v = priceValue, v > 0 else { return "Enter the price as a number, like 612." }
            if isTravel && basis.isEmpty { return "Is that price per traveler, or the total for everyone?" }
        }
        if source.trimmingCharacters(in: .whitespaces).isEmpty { return "Where did this option come from?" }
        return nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Adding", selection: $kind) { ForEach(kinds, id: \.self) { Text($0.capitalized) } }.pickerStyle(.segmented)

                if isTravel {
                    Section("Route") {
                        TextField("From — New York or NYC", text: $from).textInputAutocapitalization(.words)
                        TextField("To — Paris or PAR", text: $to).textInputAutocapitalization(.words)
                        TextField("Departs, e.g. 18:30", text: $departure)
                        TextField("Arrives, e.g. 07:45", text: $arrival)
                        TextField(kind == "train" ? "Operator" : "Airline", text: $carrier)
                        TextField("Fare as shown — Main Basic, Eco Fly…", text: $fare)
                        Picker("Cabin", selection: $cabin) {
                            Text("From the fare name").tag(""); Text("Economy").tag("economy"); Text("Premium economy").tag("premium_economy"); Text("Business").tag("business"); Text("First").tag("first")
                        }
                        Picker("Stops", selection: $stops) {
                            Text("Not stated").tag(-1); Text("Nonstop").tag(0); Text("1 stop").tag(1); Text("2 stops").tag(2)
                        }
                    }
                } else if kind == "hotel" {
                    Section("Hotel") {
                        TextField("City", text: $place).textInputAutocapitalization(.words)
                        TextField("Hotel name", text: $name).textInputAutocapitalization(.words)
                        Toggle("Price is per night", isOn: $perNight)
                        if perNight { Stepper("Nights: \(nights)", value: $nights, in: 1...60) }
                    }
                } else {
                    Section("Activity") {
                        TextField("Activity", text: $name)
                        TextField("City (optional)", text: $place).textInputAutocapitalization(.words)
                    }
                }

                Section("Price") {
                    HStack {
                        TextField(kind == "activity" ? "Price for everyone" : "Price as shown", text: $price).keyboardType(.decimalPad)
                        Picker("", selection: $currency) { ForEach(currencies, id: \.self) { Text($0) } }.labelsHidden()
                    }
                    if isTravel && hasPrice {
                        Picker("That price is", selection: $basis) {
                            Text("Choose…").tag(""); Text("Per traveler").tag("per_traveler"); Text("Total for everyone").tag("total")
                        }
                        if basis == "per_traveler" { Stepper("Travelers: \(travelers)", value: $travelers, in: 1...20) }
                    }
                }

                Section("Where it came from") {
                    TextField("Platform, e.g. Capital One Travel", text: $source)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack { ForEach(sources, id: \.self) { s in Button(s) { source = s }.buttonStyle(.bordered).controlSize(.mini) } }
                    }
                    TextField("Date window, e.g. 28-31 Oct", text: $window)
                    TextField("Link to the result (optional)", text: $url).keyboardType(.URL).textInputAutocapitalization(.never)
                    TextField("Note — fare name, points price, anything worth keeping", text: $note, axis: .vertical)
                }

                if let problem { Section { Text(problem).foregroundStyle(.orange).font(.footnote) } }
                if let reply { Section("TripAgent says") { Text(reply).font(.footnote).textSelection(.enabled) } }
            }
            .navigationTitle("Add an option")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "Sending…" : "Send for review") { Task { await send() } }.disabled(problem != nil || sending)
                }
            }
        }
    }

    private func send() async {
        sending = true
        defer { sending = false }
        var option: [String: Any] = ["kind": kind]
        func put(_ key: String, _ value: String) { let v = value.trimmingCharacters(in: .whitespaces); if !v.isEmpty { option[key] = v } }
        if isTravel {
            put("from", from); put("to", to); put("departure", departure); put("arrival", arrival); put("carrier", carrier)
            put("fare", fare); put("cabin", cabin)
            if stops >= 0 { option["stops"] = stops }
        } else if kind == "hotel" {
            put("place", place); put("name", name)
            option["per_night"] = perNight
            if perNight { option["nights"] = nights }
        } else {
            put("name", name); put("place", place)
        }
        if hasPrice, let v = priceValue { option["price"] = v; option["currency"] = currency }
        put("note", note); put("url", url)
        let text = await store.addOption(option, source: source.trimmingCharacters(in: .whitespaces), window: window.trimmingCharacters(in: .whitespaces),
                                         basis: hasPrice && isTravel ? basis : (hasPrice ? "total" : nil),
                                         travelers: hasPrice && isTravel && basis == "per_traveler" ? travelers : nil, in: tripId)
        reply = text ?? store.error
        if let text, text.hasPrefix("Recorded") { dismiss() }
    }
}
