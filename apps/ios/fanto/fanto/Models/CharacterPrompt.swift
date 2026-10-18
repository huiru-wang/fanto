import Foundation

nonisolated struct CharacterPrompt: Codable, Equatable, Sendable {
    var character = ""
    var scenario = ""
    var instructions = ""
    var exampleDialogues = ""

    var exceedsLimit: Bool {
        // Server validates JavaScript string length (UTF-16 code units).
        [character, scenario, instructions, exampleDialogues].contains { $0.utf16.count > 16_000 }
    }
}
