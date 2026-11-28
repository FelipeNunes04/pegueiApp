import Foundation
import Network
import React
import UIKit

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
    static let connectionEventName = "PegueiConnectionChanged"
    private static let queue = DispatchQueue(label: "com.felipenunes.pegueiapp.analytics", qos: .utility)
    private static let maxPending = 100
    // Only touched on `queue`.
    private static var pending: [[String: Any]] = []
    private static weak var listening: PegueiAnalytics?
    // Network path, watched on `queue` (never the camera queues). Only touched on `queue`.
    private static var pathMonitor: NWPathMonitor?
    private static var connection = "unknown"

    override static func moduleName() -> String! {
        return "PegueiAnalytics"
    }

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    override func supportedEvents() -> [String]! {
        return [PegueiAnalytics.eventName, PegueiAnalytics.connectionEventName]
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
            PegueiAnalytics.startPathMonitor()
            PegueiAnalytics.sendConnection()
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

    // MARK: Connection (common param `connection`)

    // Runs on `queue`.
    private static func startPathMonitor() {
        guard pathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { path in
            // NWPathMonitor calls back on `queue` (passed to start below).
            let next: String
            if path.status != .satisfied {
                next = "offline"
            } else if path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet) {
                next = "wifi"
            } else if path.usesInterfaceType(.cellular) {
                next = "cell"
            } else {
                next = "unknown"
            }
            guard next != connection else { return }
            connection = next
            sendConnection()
        }
        pathMonitor = monitor
        monitor.start(queue: queue)
    }

    // Runs on `queue`.
    private static func sendConnection() {
        listening?.sendEvent(withName: connectionEventName, body: ["connection": connection])
    }

    // MARK: Device status (battery, temperature, storage, memory, frames)

    /// Called from JS on session start, every 5 min at most and on session
    /// end. Runs on this module's own queue; only the battery level is read
    /// on the main thread (a UIDevice rule), asynchronously.
    @objc(getDeviceStatus:rejecter:)
    func getDeviceStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let thermal = PegueiAnalytics.thermalName(ProcessInfo.processInfo.thermalState)
        let storage = PegueiAnalytics.freeStorageGb()
        let memory = PegueiAnalytics.memoryFootprintMb()
        let frames = EncodedFrameStats.value()
        DispatchQueue.main.async {
            let device = UIDevice.current
            if !device.isBatteryMonitoringEnabled {
                device.isBatteryMonitoringEnabled = true
            }
            let level = device.batteryLevel // -1 when unknown (simulator)
            let state = device.batteryState
            resolve([
                "batteryPct": level < 0 ? -1 : Double(level * 100),
                "charging": state == .charging || state == .full,
                "thermalState": thermal,
                "storageFreeGb": storage,
                "memoryMb": memory,
                "encodedFrames": Double(frames),
            ])
        }
    }

    private static func thermalName(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    /// Free space for the app's files, in GB. Disk space is a "required
    /// reason" API: declared in PrivacyInfo.xcprivacy with reason E174.1
    /// (check there is room to write files). JS uses it on the phone only and
    /// never sends it on iOS (src/analytics/deviceStatus.ts).
    private static func freeStorageGb() -> Double {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        guard
            let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
            let bytes = values.volumeAvailableCapacityForImportantUsage
        else {
            return -1
        }
        return Double(bytes) / 1_000_000_000
    }

    /// The app's memory footprint (what jetsam counts), in MB.
    private static func memoryFootprintMb() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return -1 }
        return Double(info.phys_footprint) / 1_048_576
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
