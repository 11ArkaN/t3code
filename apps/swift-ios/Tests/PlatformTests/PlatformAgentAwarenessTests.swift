import Foundation
import Testing
@testable import T3Code

@Suite("Agent awareness projection")
struct PlatformAgentAwarenessTests {
    @Test
    func settingsDefaultToSystemAppearanceAndRoundTripLightMode() throws {
        #expect(FeatureSettings().appearance == .system)

        var settings = FeatureSettings()
        settings.appearance = .light
        let roundTrip = try JSONDecoder.t3.decode(
            FeatureSettings.self,
            from: JSONEncoder.t3.encode(settings)
        )

        #expect(roundTrip.appearance == .light)
    }

    @Test
    func legacySettingsEnableLiveActivitiesWithoutResettingOtherPreferences() throws {
        let legacy = Data(
            #"{"appearance":"system","hapticsEnabled":false,"notificationsEnabled":false,"autoSettleOnMerge":false,"autoSettleAfterDays":14}"#.utf8
        )
        let decoded = try JSONDecoder.t3.decode(FeatureSettings.self, from: legacy)

        #expect(decoded.appearance == .system)
        #expect(!decoded.hapticsEnabled)
        #expect(!decoded.notificationsEnabled)
        #expect(decoded.liveActivitiesEnabled)

        var disabled = decoded
        disabled.liveActivitiesEnabled = false
        let encoded = try JSONEncoder.t3.encode(disabled)
        let roundTrip = try JSONDecoder.t3.decode(FeatureSettings.self, from: encoded)
        #expect(!roundTrip.liveActivitiesEnabled)
        let encodedSettings = try #require(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        #expect(encodedSettings["autoSettleOnMerge"] == nil)
        #expect(encodedSettings["autoSettleAfterDays"] == nil)
    }

    @Test
    func ranksAttentionThenFailuresThenWorkAndDropsOldTerminalRows() throws {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let project = FeatureProject(
            id: "project",
            wireID: "project-wire",
            environmentID: "environment",
            name: "t3code",
            path: "/repo"
        )
        let snapshot = FeatureSnapshot(
            projects: [project],
            threads: [
                Self.thread(
                    id: "working",
                    state: .working,
                    updatedAt: now.addingTimeInterval(-10)
                ),
                Self.thread(
                    id: "approval",
                    state: .waitingForApproval,
                    updatedAt: now.addingTimeInterval(-5)
                ),
                Self.thread(
                    id: "failure",
                    state: .failed,
                    updatedAt: now.addingTimeInterval(-20)
                ),
                Self.thread(
                    id: "old-complete",
                    state: .completed,
                    updatedAt: now.addingTimeInterval(-3_600)
                ),
            ],
            providersByEnvironment: [
                "environment": [
                    FeatureProvider(
                        id: "claude",
                        name: "Claude",
                        models: [FeatureModel(id: "claude-opus-5", name: "Opus 5")]
                    ),
                ],
            ]
        )

        let aggregate = PlatformAgentAwarenessProjection.aggregate(
            snapshot: snapshot,
            now: now
        )

        #expect(aggregate.activeCount == 2)
        #expect(aggregate.subtitle == "1 task needs attention")
        #expect(aggregate.activities.map(\.threadId) == ["approval", "failure", "working"])
        #expect(aggregate.activities.first?.modelTitle == "Opus 5")
        #expect(
            aggregate.activities.first?.nativeDeepLinkURL?.scheme
                == PlatformRoute.nativeScheme
        )
    }

    @Test
    func widgetSnapshotUsesTheSameBoundedRowsAsTheLiveActivity() {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let project = FeatureProject(
            id: "project",
            environmentID: "environment",
            name: "t3code",
            path: "/repo"
        )
        let threads = (0..<8).map { index in
            Self.thread(
                id: "thread-\(index)",
                state: .working,
                updatedAt: now.addingTimeInterval(TimeInterval(-index))
            )
        }
        let snapshot = FeatureSnapshot(projects: [project], threads: threads)

        let aggregate = PlatformAgentAwarenessProjection.aggregate(
            snapshot: snapshot,
            now: now
        )
        let widget = PlatformAgentAwarenessProjection.widgetSnapshot(
            snapshot: snapshot,
            now: now
        )

        #expect(aggregate.activities.count == PlatformAgentAwarenessProjection.maximumRows)
        #expect(widget.tasks == aggregate.activities)
        #expect(widget.updatedAt == aggregate.updatedAt)
    }

    @Test(arguments: [
        FeatureThreadState.queued, .working, .monitoring, .waitingForApproval,
        .waitingForInput, .completed, .failed, .idle,
    ])
    func subagentsDoNotAppearInActivityRowsCountsOrWidgetSnapshots(
        state: FeatureThreadState
    ) {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let project = FeatureProject(
            id: "project", environmentID: "environment", name: "t3code", path: "/repo"
        )
        var child = Self.thread(id: "child", state: state, updatedAt: now.addingTimeInterval(-60))
        child.relationshipToParent = "subagent"
        var handoff = Self.thread(id: "handoff", state: .waitingForApproval, updatedAt: now)
        handoff.relationshipToParent = "handoff"
        let finished = Self.thread(id: "finished", state: .completed, updatedAt: now)
        let snapshot = FeatureSnapshot(projects: [project], threads: [
            child, handoff, finished, Self.thread(id: "parent", state: .working, updatedAt: now),
        ])

        let aggregate = PlatformAgentAwarenessProjection.aggregate(snapshot: snapshot, now: now)
        #expect(aggregate.activities.map(\.threadId) == ["handoff", "parent", "finished"])
        #expect(aggregate.activeCount == 2)
        #expect(aggregate.subtitle == "1 task needs attention")
        #expect(PlatformAgentAwarenessProjection.widgetSnapshot(snapshot: snapshot, now: now).tasks
            == aggregate.activities)
        #expect(PlatformAgentAwarenessProjection.nextTerminalExpiry(snapshot: snapshot, now: now)
            == now.addingTimeInterval(PlatformAgentAwarenessProjection.terminalVisibilityWindow))

        let childOnly = FeatureSnapshot(projects: [project], threads: [child])
        let empty = PlatformAgentAwarenessProjection.aggregate(snapshot: childOnly, now: now)
        #expect(empty.activities.isEmpty)
        #expect(empty.activeCount == 0)
        #expect(empty.subtitle == "Ready for a task")
        #expect(PlatformAgentAwarenessProjection.nextTerminalExpiry(snapshot: childOnly, now: now) == nil)
    }

    @Test
    func widgetRejectsUnfilteredSnapshotsFromEarlierBuilds() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("task-widget-snapshot.json")
        let legacy = Data(#"{"updatedAt":"2026-10-25T12:00:00Z","tasks":[{"environmentId":"environment","threadId":"child","projectTitle":"t3code","threadTitle":"Subagent","modelTitle":"Model","phase":"running","status":"Working","updatedAt":"2026-10-25T12:00:00Z","deepLink":"/"}]}"#.utf8)
        try legacy.write(to: file)
        #expect(T3TaskWidgetSnapshotStore.load(from: file) == .empty)

        let project = FeatureProject(
            id: "project", environmentID: "environment", name: "t3code", path: "/repo"
        )
        let snapshot = PlatformAgentAwarenessProjection.widgetSnapshot(snapshot: .init(
            projects: [project], threads: [Self.thread(id: "parent", state: .monitoring, updatedAt: .now)]
        ))
        try JSONEncoder().encode(snapshot).write(to: file)
        #expect(T3TaskWidgetSnapshotStore.load(from: file).tasks.map(\.threadId) == ["parent"])
    }

    @Test
    func pendingBackgroundWorkKeepsOnlyItsParentInActivitiesAndWidgets() throws {
        let raw = try #require(V2Fixture.load("v2-shell-snapshot")["threads"]?.v2Array?.first)
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let project = FeatureProject(
            id: "project", environmentID: "environment", name: "t3code", path: "/repo"
        )
        for (kind, expectedState) in [
            ("subagent", FeatureThreadState.working), ("monitor", .monitoring),
            ("background_task", .working), ("command", .completed),
        ] {
            let source = try OrchestrationV2ThreadShell(json: V2Fixture.patch(raw, [
                "status": .string("completed"), "activityRunStatus": .null,
                "activeRunId": .null, "pendingRuntimeRequest": .null,
                "pendingBackgroundTasks": .array([.object(["taskId": .string("task"), "kind": .string(kind)])]),
            ]))
            let shell = OrchestrationV2Presentation.shellThread(source)
            let state = NativeFeatureClient.resolveThreadState(
                latestTurn: shell.latestTurn, session: shell.session,
                hasApprovals: shell.hasPendingApprovals, hasUserInput: shell.hasPendingUserInput,
                backgroundLiveness: shell.backgroundLiveness, v2Lifecycle: shell.v2Lifecycle
            )
            #expect(state == expectedState)
            let parent = Self.thread(id: "parent", state: state, updatedAt: now.addingTimeInterval(-3_600))
            var child = Self.thread(id: "child", state: .working, updatedAt: now)
            child.relationshipToParent = "subagent"
            let snapshot = FeatureSnapshot(projects: [project], threads: [parent, child])
            let aggregate = PlatformAgentAwarenessProjection.aggregate(snapshot: snapshot, now: now)
            #expect(aggregate.activities.map(\.threadId) == (kind == "command" ? [] : ["parent"]))
            #expect(aggregate.activeCount == (kind == "command" ? 0 : 1))
            #expect(PlatformAgentAwarenessProjection.widgetSnapshot(snapshot: snapshot, now: now).tasks
                == aggregate.activities)
            if kind == "monitor" { #expect(aggregate.activities.first?.status == "Monitoring") }
        }
    }

    @Test
    func terminalRowsExposeTheirExpiryAndDisappearAtTheBoundary() throws {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let updatedAt = now.addingTimeInterval(-60)
        let expiry = updatedAt.addingTimeInterval(
            PlatformAgentAwarenessProjection.terminalVisibilityWindow
        )
        let project = FeatureProject(
            id: "project",
            environmentID: "environment",
            name: "t3code",
            path: "/repo"
        )
        let snapshot = FeatureSnapshot(
            projects: [project],
            threads: [Self.thread(id: "done", state: .completed, updatedAt: updatedAt)]
        )

        #expect(
            PlatformAgentAwarenessProjection.nextTerminalExpiry(
                snapshot: snapshot,
                now: now
            ) == expiry
        )
        #expect(
            PlatformAgentAwarenessProjection.aggregate(
                snapshot: snapshot,
                now: expiry.addingTimeInterval(-0.001)
            ).activities.count == 1
        )
        #expect(
            PlatformAgentAwarenessProjection.aggregate(
                snapshot: snapshot,
                now: expiry
            ).activities.isEmpty
        )
    }

    @Test
    @MainActor
    func failedWidgetWriteRetriesEvenAfterTheLiveActivitySucceeds() async {
        let recorder = PlatformAgentAwarenessOperationRecorder()
        let coordinator = PlatformAgentAwarenessCoordinator(
            updateLiveActivity: { _, _, _ in recorder.recordUpdate() },
            endLiveActivities: {},
            saveWidgetSnapshot: { _, _ in
                recorder.recordWidgetWrite()
                return recorder.widgetWriteCount > 1
            }
        )
        coordinator.synchronize(snapshot: .init(), liveActivitiesEnabled: true)
        await recorder.waitForWidgetWriteCount(1)
        await recorder.waitForUpdateCount(1)
        coordinator.synchronize(snapshot: .init(), liveActivitiesEnabled: true)
        await recorder.waitForWidgetWriteCount(2)
        #expect(recorder.updateCount == 1)
    }

    @Test
    @MainActor
    func signOutEndsActivitiesWithoutRepublishingTheCachedProjection() async {
        let recorder = PlatformAgentAwarenessOperationRecorder()
        let coordinator = PlatformAgentAwarenessCoordinator(
            updateLiveActivity: { _, _, _ in
                recorder.recordUpdate()
            },
            endLiveActivities: {
                recorder.recordEnd()
            }
        )

        coordinator.synchronize(snapshot: FeatureSnapshot(), liveActivitiesEnabled: true)
        await recorder.waitForUpdateCount(1)

        coordinator.resetAndResynchronizeLiveActivity()
        await recorder.waitForEndCount(1)
        await Task.yield()

        #expect(recorder.updateCount == 1)
        #expect(recorder.endCount == 1)
    }

    @Test
    @MainActor
    func latestSnapshotCancelsAnInFlightReversionToOlderState() async {
        let recorder = GatedPlatformAgentAwarenessRecorder()
        let coordinator = PlatformAgentAwarenessCoordinator(
            updateLiveActivity: { _, _, _ in
                await recorder.recordUpdate()
            },
            endLiveActivities: {}
        )
        let ready = FeatureSnapshot()
        let project = FeatureProject(
            id: "project",
            environmentID: "environment",
            name: "t3code",
            path: "/repo"
        )
        let working = FeatureSnapshot(
            projects: [project],
            threads: [Self.thread(id: "working", state: .working, updatedAt: .now)]
        )

        coordinator.synchronize(snapshot: ready, liveActivitiesEnabled: true)
        await recorder.waitForUpdateCount(1)
        await Task.yield()

        coordinator.synchronize(snapshot: working, liveActivitiesEnabled: true)
        await recorder.waitForUpdateCount(2)
        coordinator.synchronize(snapshot: ready, liveActivitiesEnabled: true)
        recorder.releaseSecondUpdate()
        await Task.yield()
        await Task.yield()

        coordinator.synchronize(snapshot: ready, liveActivitiesEnabled: true)
        await Task.yield()
        #expect(recorder.updateCount == 2)
    }

    private static func thread(
        id: String,
        state: FeatureThreadState,
        updatedAt: Date
    ) -> FeatureThread {
        FeatureThread(
            id: id,
            wireID: id,
            projectID: "project",
            environmentID: "environment",
            title: "Task \(id)",
            updatedAt: updatedAt,
            state: state,
            providerID: "claude",
            modelID: "claude-opus-5"
        )
    }
}

@MainActor
private final class GatedPlatformAgentAwarenessRecorder {
    private(set) var updateCount = 0
    private var secondUpdateContinuation: CheckedContinuation<Void, Never>?
    private var updateWaiters: [(Int, CheckedContinuation<Void, Never>)] = []

    func recordUpdate() async {
        updateCount += 1
        let ready = updateWaiters.filter { updateCount >= $0.0 }
        updateWaiters.removeAll { updateCount >= $0.0 }
        ready.forEach { $0.1.resume() }
        if updateCount == 2 {
            await withCheckedContinuation { continuation in
                secondUpdateContinuation = continuation
            }
        }
    }

    func waitForUpdateCount(_ count: Int) async {
        guard updateCount < count else { return }
        await withCheckedContinuation { continuation in
            updateWaiters.append((count, continuation))
        }
    }

    func releaseSecondUpdate() {
        secondUpdateContinuation?.resume()
        secondUpdateContinuation = nil
    }
}

@MainActor
private final class PlatformAgentAwarenessOperationRecorder {
    private(set) var updateCount = 0
    private(set) var endCount = 0
    private(set) var widgetWriteCount = 0
    private var updateWaiters: [(Int, CheckedContinuation<Void, Never>)] = []
    private var endWaiters: [(Int, CheckedContinuation<Void, Never>)] = []
    private var widgetWriteWaiters: [(Int, CheckedContinuation<Void, Never>)] = []

    func recordWidgetWrite() {
        widgetWriteCount += 1
        resumeReadyWaiters(&widgetWriteWaiters, count: widgetWriteCount)
    }

    func waitForWidgetWriteCount(_ count: Int) async {
        guard widgetWriteCount < count else { return }
        await withCheckedContinuation { widgetWriteWaiters.append((count, $0)) }
    }

    func recordUpdate() {
        updateCount += 1
        resumeReadyWaiters(&updateWaiters, count: updateCount)
    }

    func recordEnd() {
        endCount += 1
        resumeReadyWaiters(&endWaiters, count: endCount)
    }

    func waitForUpdateCount(_ count: Int) async {
        guard updateCount < count else { return }
        await withCheckedContinuation { continuation in
            updateWaiters.append((count, continuation))
        }
    }

    func waitForEndCount(_ count: Int) async {
        guard endCount < count else { return }
        await withCheckedContinuation { continuation in
            endWaiters.append((count, continuation))
        }
    }

    private func resumeReadyWaiters(
        _ waiters: inout [(Int, CheckedContinuation<Void, Never>)],
        count: Int
    ) {
        let ready = waiters.filter { count >= $0.0 }
        waiters.removeAll { count >= $0.0 }
        ready.forEach { $0.1.resume() }
    }
}
