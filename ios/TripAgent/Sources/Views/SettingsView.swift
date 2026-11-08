import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var store: TripStore
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var status: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://tripagent.<you>.workers.dev/mcp/<token>", text: $draft)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .font(.system(.footnote, design: .monospaced))
                } header: { Text("TripAgent connector URL") } footer: {
                    Text("The same URL you added to Claude (Settings → Connectors). It is the credential: it stays in this phone's Keychain and is sent only to that server.")
                }
                Section {
                    Button("Connect") { connect() }.disabled(MCPClient.validate(draft) == nil)
                    if store.isConfigured { Button("Disconnect", role: .destructive) { store.setConnector(""); draft = ""; status = "Disconnected." } }
                    if let status { Text(status).font(.footnote).foregroundStyle(.secondary) }
                }
                Section("How it fits") {
                    Text("Claude records options you describe, paste or screenshot; this app shows them for your review and lets you approve, dismiss and pick. The web planner shares the same trips.").font(.footnote)
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { draft = store.connectorURL }
        }
    }

    private func connect() {
        store.setConnector(draft)
        status = "Connecting…"
        Task {
            await store.refreshTrips()
            status = store.error.map { "Could not connect: \($0)" } ?? "Connected. \(store.trips.count) trip\(store.trips.count == 1 ? "" : "s")."
        }
    }
}
