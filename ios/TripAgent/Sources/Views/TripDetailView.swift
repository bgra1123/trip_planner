import SwiftUI

struct TripDetailView: View {
    @EnvironmentObject var store: TripStore
    let tripId: String
    @State private var showAdd = false
    @State private var showRaw = false
    @State private var ranking: String?
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            if let error = store.error { Section { Text(error).foregroundStyle(.red).font(.footnote) } }

            if !store.pending.isEmpty {
                Section {
                    ForEach(store.pending) { option in PendingRow(option: option, tripId: tripId) }
                } header: {
                    Text("\(store.pending.count) waiting for your review")
                } footer: {
                    Text("Approve puts an option in the plan; dismiss drops it. Nothing reaches the plan until you say so.")
                }
            }

            if let d = store.detail {
                if d.isEmpty {
                    Section { Text("Nothing in the plan yet. Add an option below, or approve a waiting one.").foregroundStyle(.secondary) }
                } else {
                    if d.windows.count > 1 {
                        Section("Date windows") { Text("Showing \(d.showingWindow). Also: \(d.windows.filter { $0 != d.showingWindow }.joined(separator: ", "))").font(.footnote) }
                    }
                    ForEach(d.sections) { section in
                        Section(sectionTitle(section)) {
                            ForEach(section.options) { option in
                                PlanRow(option: option, tripId: tripId, pickable: section.kind != .activities)
                            }
                        }
                    }
                    if !d.total.isEmpty {
                        Section { LabeledContent("Total of the picked options", value: d.total).font(.headline) }
                    }
                }
            }

            Section {
                Button { Task { ranking = await store.optimize(tripId) } } label: { Label("Rank combinations by cost", systemImage: "list.number") }
                    .disabled(store.detail?.isEmpty ?? true)
                Button { showRaw.toggle() } label: { Label(showRaw ? "Hide what Claude sees" : "Show what Claude sees", systemImage: "text.alignleft") }
                if showRaw, let raw = store.detail?.raw { Text(raw).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
            }

            Section {
                Button(role: .destructive) { confirmDelete = true } label: { Label("Delete this trip", systemImage: "trash") }
            }
        }
        .navigationTitle(store.detail?.title ?? "Trip")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { showAdd = true } label: { Image(systemName: "plus.circle") } } }
        .overlay { if store.isLoading && store.detail == nil { ProgressView() } }
        .refreshable { await store.load(trip: tripId) }
        .task(id: tripId) { await store.load(trip: tripId) }
        .sheet(isPresented: $showAdd) { AddOptionView(tripId: tripId) }
        .sheet(item: Binding(get: { ranking.map { RankingText(text: $0) } }, set: { _ in ranking = nil })) { r in
            NavigationStack {
                ScrollView { Text(r.text).font(.system(.callout, design: .monospaced)).padding().textSelection(.enabled) }
                    .navigationTitle("Cheapest first").navigationBarTitleDisplayMode(.inline)
            }
        }
        .alert("Delete this trip?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { Task { await store.deleteTrip(tripId); dismiss() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Its plan and waiting options go too, for Claude and the planner as well. This cannot be undone.") }
        .alert("TripAgent", isPresented: Binding(get: { store.notice != nil }, set: { if !$0 { store.notice = nil } })) {
            Button("OK") { store.notice = nil }
        } message: { Text(store.notice ?? "") }
    }

    private func sectionTitle(_ s: PlanSection) -> String {
        switch s.kind {
        case .travel: return "Travel · \(s.key)"
        case .stay: return "Stay · \(s.key)"
        case .activities: return "Activities"
        }
    }
}

private struct RankingText: Identifiable { let id = UUID(); let text: String }

struct PlanRow: View {
    @EnvironmentObject var store: TripStore
    let option: PlanOption
    let tripId: String
    let pickable: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: option.picked ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(option.picked ? .green : .secondary)
                .font(.title3)
                .onTapGesture { if pickable, !option.picked, !option.id.isEmpty { Task { await store.pick(option.id, in: tripId) } } }
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(option.label).font(option.picked ? .body.bold() : .body)
                    Spacer()
                    Text(option.price).font(.body.monospacedDigit())
                }
                if !option.window.isEmpty { Text(option.window).font(.caption).foregroundStyle(.secondary) }
                if !option.detail.isEmpty {
                    Text(option.detail).font(.caption).foregroundStyle(option.stale ? .orange : .secondary)
                }
            }
        }
        .swipeActions(edge: .trailing) {
            if !option.id.isEmpty {
                Button(role: .destructive) { Task { await store.removeFromPlan([option.id], in: tripId) } } label: { Label("Remove", systemImage: "trash") }
            }
        }
        .swipeActions(edge: .leading) {
            if pickable, !option.picked, !option.id.isEmpty {
                Button { Task { await store.pick(option.id, in: tripId) } } label: { Label("Pick", systemImage: "checkmark") }.tint(.green)
            }
        }
    }
}

struct PendingRow: View {
    @EnvironmentObject var store: TripStore
    let option: PendingOption
    let tripId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(option.group ?? option.label ?? option.kind).font(.headline)
                Spacer()
                Text(option.priceText).font(.body.monospacedDigit())
            }
            HStack(spacing: 8) {
                Text(option.title)
                if !option.when.isEmpty { Text(option.when).foregroundStyle(.secondary) }
                if let stops = option.stops { Text(stops == 0 ? "nonstop" : "\(stops) stop\(stops == 1 ? "" : "s")").foregroundStyle(.secondary) }
            }.font(.subheadline)
            if !option.fareText.isEmpty { Text(option.fareText).font(.caption).foregroundStyle(.secondary) }
            HStack(spacing: 8) {
                if let w = option.window, !w.isEmpty { Text(w) }
                if let s = option.source, !s.isEmpty { Text("via \(s)") }
            }.font(.caption).foregroundStyle(.secondary)
            if let d = option.detail, !d.isEmpty { Text(d).font(.caption).foregroundStyle(.secondary) }
            if let u = option.sourceUrl, let url = URL(string: u), ["https", "http"].contains(url.scheme ?? "") {
                Link("Open the result", destination: url).font(.caption)
            }
            HStack {
                Button("Approve") { Task { await store.approve([option.id], in: tripId) } }.buttonStyle(.borderedProminent).controlSize(.small)
                Button("Dismiss", role: .destructive) { Task { await store.dismiss([option.id], in: tripId) } }.buttonStyle(.bordered).controlSize(.small)
            }.padding(.top, 2)
        }
    }
}
