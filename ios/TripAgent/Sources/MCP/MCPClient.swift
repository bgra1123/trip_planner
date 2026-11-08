import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// A small MCP client over Streamable HTTP, enough to talk to the TripAgent
// server: `initialize`, then `tools/call`. The server answers plain JSON
// (stateless), but a `text/event-stream` reply is read too, in case a later
// server version streams.
//
// Every tool result is either text (what Claude sees) or, for some tools,
// JSON inside that text. `ToolResult` keeps both the raw text and `isError`,
// and the parsers in Model/ turn the text into rows.

struct ToolResult: Equatable {
    var text: String
    var isError: Bool
}

enum MCPError: LocalizedError, Equatable {
    case notConfigured
    case badURL
    case http(Int)
    case transport(String)
    case rpc(code: Int, message: String)
    case malformed(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Add your TripAgent connector URL in Settings first."
        case .badURL: return "That is not a connector URL — it should look like https://…/mcp/<token>."
        case .http(404): return "TripAgent did not recognize that URL — check it matches the one added in Claude."
        case .http(let code): return "TripAgent answered \(code)."
        case .transport(let why): return "Could not reach TripAgent — \(why)"
        case .rpc(_, let message): return message
        case .malformed(let what): return "TripAgent sent something unexpected: \(what)"
        }
    }
}

final class MCPClient {
    let endpoint: URL
    private let session: URLSession
    private var nextId = 1
    private var initialized = false

    init(endpoint: URL, session: URLSession = .shared) {
        self.endpoint = endpoint
        self.session = session
    }

    // "https://host/mcp/TOKEN" is accepted; anything else is refused up front
    // so a typo never becomes a request to a random host.
    static func validate(_ text: String) -> URL? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host, !host.isEmpty else { return nil }
        let isLocal = host == "localhost" || host == "127.0.0.1"
        guard url.scheme == "https" || (url.scheme == "http" && isLocal) else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count == 2, parts[0] == "mcp", parts[1].count >= 16 else { return nil }
        return url
    }

    func callTool(_ name: String, arguments: [String: Any] = [:]) async throws -> ToolResult {
        try await ensureInitialized()
        let reply = try await rpc(method: "tools/call", params: ["name": name, "arguments": arguments])
        guard let result = reply["result"] as? [String: Any] else {
            if let err = reply["error"] as? [String: Any] {
                throw MCPError.rpc(code: err["code"] as? Int ?? 0, message: err["message"] as? String ?? "unknown error")
            }
            throw MCPError.malformed("no result in tools/call reply")
        }
        let content = result["content"] as? [[String: Any]] ?? []
        let text = content.compactMap { $0["type"] as? String == "text" ? $0["text"] as? String : nil }.joined(separator: "\n")
        return ToolResult(text: text, isError: result["isError"] as? Bool ?? false)
    }

    private func ensureInitialized() async throws {
        if initialized { return }
        let reply = try await rpc(method: "initialize", params: [
            "protocolVersion": "2025-06-18",
            "capabilities": [String: Any](),
            "clientInfo": ["name": "tripagent-ios", "version": "1.0.0"],
        ])
        guard reply["result"] != nil else { throw MCPError.malformed("initialize failed") }
        // The server is stateless, so the initialized notification is a courtesy.
        _ = try? await post(body: ["jsonrpc": "2.0", "method": "notifications/initialized"])
        initialized = true
    }

    private func rpc(method: String, params: [String: Any]) async throws -> [String: Any] {
        let id = nextId
        nextId += 1
        let data = try await post(body: ["jsonrpc": "2.0", "id": id, "method": method, "params": params])
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw MCPError.malformed("reply is not a JSON object")
        }
        if let err = object["error"] as? [String: Any] {
            throw MCPError.rpc(code: err["code"] as? Int ?? 0, message: err["message"] as? String ?? "unknown error")
        }
        return object
    }

    private func post(body: [String: Any]) async throws -> Data {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 20
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw MCPError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw MCPError.transport("no HTTP response") }
        if http.statusCode == 202 { return Data("{}".utf8) }
        guard (200..<300).contains(http.statusCode) else { throw MCPError.http(http.statusCode) }
        let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        if type.contains("text/event-stream") { return Self.lastEventData(from: data) }
        return data
    }

    // The last `data:` payload of an SSE body — the response to our request.
    static func lastEventData(from data: Data) -> Data {
        let text = String(decoding: data, as: UTF8.self)
        var last = ""
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("data:") { last = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces) }
        }
        return Data(last.utf8)
    }
}
