import SwiftUI

@main
struct TripAgentApp: App {
    @StateObject private var store = TripStore()

    var body: some Scene {
        WindowGroup {
            TripsListView()
                .environmentObject(store)
        }
    }
}
