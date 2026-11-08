import SwiftUI

struct TripsListView: View {
    @EnvironmentObject var store: TripStore
    @State private var showSettings = false
    @State private var newTitle = ""
    @State private var askingNewTrip = false

    var body: some View {
        NavigationStack {
            Group {
                if !store.isConfigured {
                    ContentUnavailableView {
                        Label("Connect TripAgent", systemImage: "link")
                    } description: {
                        Text("Paste the same connector URL you gave Claude. Your trips, the options waiting for review and the plan all live there.")
                    } actions: {
                        Button("Open Settings") { showSettings = true }.buttonStyle(.borderedProminent)
                    }
                } else if store.trips.isEmpty && !store.isLoading && store.error == nil {
                    ContentUnavailableView("No trips yet", systemImage: "airplane", description: Text("Start one here, or ask Claude: “use TripAgent to start a Paris trip”."))
                } else {
                    List {
                        if let error = store.error { Text(error).foregroundStyle(.red).font(.footnote) }
                        ForEach(store.trips) { trip in
                            NavigationLink(value: trip.id) {
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack {
                                        Text(trip.title).font(.headline)
                                        if trip.isCurrent { Text("current").font(.caption2).padding(.horizontal, 6).padding(.vertical, 2).background(.green.opacity(0.15)).clipShape(Capsule()) }
                                    }
                                    if !trip.route.isEmpty { Text(trip.route).font(.subheadline).foregroundStyle(.secondary) }
                                    HStack(spacing: 12) {
                                        Label("\(trip.inPlan) in plan", systemImage: "checkmark.circle")
                                        if trip.waiting > 0 { Label("\(trip.waiting) to review", systemImage: "tray.full").foregroundStyle(.orange) }
                                    }.font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .swipeActions(edge: .leading) {
                                if !trip.isCurrent { Button("Make current") { Task { await store.setCurrent(trip.id) } }.tint(.green) }
                            }
                        }
                    }
                    .refreshable { await store.refreshTrips() }
                }
            }
            .navigationTitle("Trips")
            .navigationDestination(for: String.self) { id in TripDetailView(tripId: id) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button { showSettings = true } label: { Image(systemName: "gear") } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { askingNewTrip = true } label: { Image(systemName: "plus") }.disabled(!store.isConfigured)
                }
            }
            .overlay { if store.isLoading && store.trips.isEmpty { ProgressView() } }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .alert("New trip", isPresented: $askingNewTrip) {
                TextField("Name, e.g. Paris in October", text: $newTitle)
                Button("Create") { let t = newTitle; newTitle = ""; Task { _ = await store.createTrip(title: t) } }
                Button("Cancel", role: .cancel) { newTitle = "" }
            } message: { Text("Claude and the planner will see it too.") }
            .task { if store.isConfigured { await store.refreshTrips() } }
            .onChange(of: store.connectorURL) { if store.isConfigured { Task { await store.refreshTrips() } } }
        }
    }
}
