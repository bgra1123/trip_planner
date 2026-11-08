import XCTest
@testable import TripAgent

final class TripAgentTests: XCTestCase {
    func testParsersAgainstRealReplies() {
        let failures = ParserChecks.run()
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }
}
