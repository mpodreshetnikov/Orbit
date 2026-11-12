import ActivityKit
import Capacitor
import Foundation

/**
 Capacitor bridge for ActivityKit push-to-start tokens (T-0023).
 Registers as JS name `LiveActivity`. Without a signed Push entitlement the token stream
 never yields; the web hook treats that as a quiet no-op so Web Push stays the path.
 */
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "watchPushToStartToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startDebugActivity", returnType: CAPPluginReturnPromise),
    ]

    private static let bundleId = Bundle.main.bundleIdentifier ?? "com.podreshetnikov.orbit"

    @objc func watchPushToStartToken(_ call: CAPPluginCall) {
        guard #available(iOS 17.2, *) else {
            call.reject("Live Activities require iOS 17.2+")
            return
        }

        #if targetEnvironment(simulator)
        // Simulator cannot obtain a real push-to-start token; resolve empty so the web layer no-ops.
        call.resolve([
            "token": "",
            "apnsEnvironment": Self.apnsEnvironment(),
            "bundleId": Self.bundleId,
        ])
        return
        #else
        Task {
            for await tokenData in Activity<MedicationAttributes>.pushToStartTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                call.resolve([
                    "token": token,
                    "apnsEnvironment": Self.apnsEnvironment(),
                    "bundleId": Self.bundleId,
                ])
                return
            }
            call.reject("pushToStartTokenUpdates ended without a token")
        }
        #endif
    }

    @objc func startDebugActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("ActivityKit unavailable")
            return
        }

        let name = call.getString("medicationName") ?? "Aspirin"
        let amount = call.getString("amountLabel") ?? "1 tablet"
        let attributes = MedicationAttributes(doseEventIds: ["debug-dose"])
        let state = MedicationAttributes.ContentState(
            medicationName: name,
            amountLabel: amount,
            personPrefix: nil,
            dueAt: Date().addingTimeInterval(60),
            snoozeMinutes: 60
        )

        do {
            _ = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil),
                pushType: .token
            )
            call.resolve(["started": true])
        } catch {
            call.reject("Activity.request failed: \(error.localizedDescription)")
        }
    }

    private static func apnsEnvironment() -> String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}
