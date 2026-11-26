import Foundation
import React

/// Lets native code send analytics through the same JS `track()` path as
/// the rest of the app (opt-out, development mode, provider).
///
/// `PegueiAnalytics.track(...)` is safe from any thread, the camera and
/// encoder queues included: it only hops onto a low-priority serial queue
/// and returns. Events wait there until JS is listening (cold start,
/// reload), capped at `maxPending`.
@objc(PegueiAnalytics)
final class PegueiAnalytics: RCTEventEmitter {
    static let eventName = "PegueiAnalyticsEvent"
    private static let queue = DispatchQueue(label: "com.felipenunes.pegueiapp.analytics", qos: .utility)
    private static let maxPending = 100
    // Only touched on `queue`.
    private static var pending: [[String: Any]] = []
    private static weak var listening: PegueiAnalytics?

    override static func moduleName() -> String! {
        return "PegueiAnalytics"
    }

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    override func supportedEvents() -> [String]! {
        return [PegueiAnalytics.eventName]
    }

    override func constantsToExport() -> [AnyHashable: Any]! {
        let info = Bundle.main.infoDictionary ?? [:]
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return [
            "appVersion": info["CFBundleShortVersionString"] as? String ?? "unknown",
            "buildNumber": info["CFBundleVersion"] as? String ?? "unknown",
            "deviceModel": PegueiAnalytics.hardwareModel(),
            "osVersion": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
        ]
    }

    override func startObserving() {
        PegueiAnalytics.queue.async { [weak self] in
            PegueiAnalytics.listening = self
            PegueiAnalytics.flush()
        }
    }

    override func stopObserving() {
        PegueiAnalytics.queue.async { [weak self] in
            if PegueiAnalytics.listening === self {
                PegueiAnalytics.listening = nil
            }
        }
    }

    override func invalidate() {
        stopObserving()
        super.invalidate()
    }

    /// Queue an event. `name` must be one of `src/analytics/events.ts`; JS
    /// drops unknown names. Values must be String, number or Bool.
    @objc static func track(_ name: String, props: [String: Any] = [:]) {
        queue.async {
            pending.append(["name": name, "props": props])
            if pending.count > maxPending {
                pending.removeFirst(pending.count - maxPending)
            }
            flush()
        }
    }

    // Runs on `queue`.
    private static func flush() {
        guard let emitter = listening, !pending.isEmpty else { return }
        let batch = pending
        pending.removeAll()
        for event in batch {
            emitter.sendEvent(withName: eventName, body: event)
        }
    }

    /// e.g. "iPhone16,1". On the simulator, the simulated model's identifier.
    private static func hardwareModel() -> String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulated
        }
        var systemInfo = utsname()
        uname(&systemInfo)
        let mirror = Mirror(reflecting: systemInfo.machine)
        return mirror.children.reduce(into: "") { result, element in
            if let value = element.value as? Int8, value != 0 {
                result.append(Character(UnicodeScalar(UInt8(value))))
            }
        }
    }
}
