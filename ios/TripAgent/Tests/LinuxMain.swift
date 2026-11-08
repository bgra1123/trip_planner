// Plain-toolchain runner (no XCTest):
//   swiftc -parse-as-library Sources/Model/*.swift Sources/MCP/MCPClient.swift Tests/ParserChecks.swift Tests/LinuxMain.swift -o /tmp/checks && /tmp/checks
import Foundation
@main
struct LinuxMain {
    static func main() {
        let failures = ParserChecks.run()
        if failures.isEmpty { print("✓ parser checks passed"); exit(0) }
        for f in failures { print("✗ " + f) }
        exit(1)
    }
}
