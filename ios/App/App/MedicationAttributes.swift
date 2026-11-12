import ActivityKit
import Foundation

/// Shared ActivityKit attributes for a pending medication dose (T-0023).
/// Content strings are localized on the server so Swift does not duplicate plural tables.
/// `dueAt` in APNs content-state is Unix seconds since 1970 (ActivityKit Date decode).
@available(iOS 16.2, *)
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
