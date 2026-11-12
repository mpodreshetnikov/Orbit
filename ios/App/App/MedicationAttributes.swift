import ActivityKit
import Foundation

/// Shared ActivityKit attributes for a pending medication dose (T-0023).
/// Content strings are localized on the server so Swift does not duplicate plural tables.
struct MedicationAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var medicationName: String
        var amountLabel: String
        var personPrefix: String?
        var dueAt: Date
        var snoozeMinutes: Int
    }

    var doseEventIds: [String]
}
