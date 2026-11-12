import AppIntents
import Foundation

/// Taken / Snooze App Intents for the Live Activity card (T-0023 M3).
/// Credentials and RPC calls land when Keychain Sharing is wired and APNs keys exist;
/// these stubs compile for simulator / unsigned builds without secrets.

@available(iOS 17.0, *)
struct MarkDoseTakenIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Taken"
    static var description = IntentDescription("Mark the pending medication dose as taken.")

    @Parameter(title: "Dose Event IDs")
    var doseEventIds: [String]

    init() {
        self.doseEventIds = []
    }

    init(doseEventIds: [String]) {
        self.doseEventIds = doseEventIds
    }

    func perform() async throws -> some IntentResult {
        // Post-key: read shared Keychain session, call mark_dose_taken RPC with apikey + bearer.
        return .result()
    }
}

@available(iOS 17.0, *)
struct SnoozeDoseIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Snooze"
    static var description = IntentDescription("Snooze the pending medication dose.")

    @Parameter(title: "Dose Event IDs")
    var doseEventIds: [String]

    @Parameter(title: "Snooze Minutes")
    var snoozeMinutes: Int

    init() {
        self.doseEventIds = []
        self.snoozeMinutes = 60
    }

    init(doseEventIds: [String], snoozeMinutes: Int) {
        self.doseEventIds = doseEventIds
        self.snoozeMinutes = snoozeMinutes
    }

    func perform() async throws -> some IntentResult {
        // Post-key: call snooze_dose RPC with ContentState.snoozeMinutes.
        return .result()
    }
}
