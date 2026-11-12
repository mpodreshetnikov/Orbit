import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct MedicationActivityLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MedicationAttributes.self) { context in
            lockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "pill")
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.medicationName)
                            .font(.headline)
                        Text(context.state.amountLabel)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let prefix = context.state.personPrefix, !prefix.isEmpty {
                            Text(prefix)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.dueAt, style: .relative)
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if #available(iOS 17.0, *) {
                        HStack {
                            Button(intent: MarkDoseTakenIntent(doseEventIds: context.attributes.doseEventIds)) {
                                Text("Taken")
                            }
                            Button(
                                intent: SnoozeDoseIntent(
                                    doseEventIds: context.attributes.doseEventIds,
                                    snoozeMinutes: context.state.snoozeMinutes
                                )
                            ) {
                                Text("Snooze \(context.state.snoozeMinutes)m")
                            }
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "pill")
            } compactTrailing: {
                Text(context.state.amountLabel)
                    .font(.caption2)
            } minimal: {
                Image(systemName: "pill")
            }
        }
    }

    @ViewBuilder
    private func lockScreenView(context: ActivityViewContext<MedicationAttributes>) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "pill")
                .font(.title2)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.state.medicationName)
                    .font(.headline)
                Text(context.state.amountLabel)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let prefix = context.state.personPrefix, !prefix.isEmpty {
                    Text(prefix)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(context.state.dueAt, style: .relative)
                .font(.caption)
            if #available(iOS 17.0, *) {
                VStack(spacing: 6) {
                    Button(intent: MarkDoseTakenIntent(doseEventIds: context.attributes.doseEventIds)) {
                        Text("Taken")
                    }
                    .buttonStyle(.borderedProminent)
                    Button(
                        intent: SnoozeDoseIntent(
                            doseEventIds: context.attributes.doseEventIds,
                            snoozeMinutes: context.state.snoozeMinutes
                        )
                    ) {
                        Text("Snooze")
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .padding()
    }
}
