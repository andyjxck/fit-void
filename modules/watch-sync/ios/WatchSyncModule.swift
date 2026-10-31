import ExpoModulesCore
import WatchConnectivity

/// Phone side of the WatchConnectivity pipe. Pushes a JSON snapshot to the
/// watch via applicationContext and forwards watch commands to JS as events.
/// A separate NSObject handles WCSessionDelegate because Module subclasses
/// can't adopt ObjC protocols cleanly.
final class WatchSessionBridge: NSObject, WCSessionDelegate {
  var onCommand: (([String: Any]) -> Void)?

  func activate() {
    guard WCSession.isSupported() else { return }
    let s = WCSession.default
    s.delegate = self
    s.activate()
  }

  func pushContext(_ json: String) {
    guard WCSession.isSupported(),
          let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    // applicationContext must be a property list - NSNull is not a valid
    // plist value, so any "key": null makes the whole update throw. Strip
    // nulls recursively; absent keys decode as nil on the watch.
    guard let clean = Self.stripNulls(obj) as? [String: Any] else { return }
    do {
      try WCSession.default.updateApplicationContext(clean)
    } catch {
      print("[WatchSync] updateApplicationContext failed: \(error)")
    }
    // applicationContext delivery is flaky on sim pairs and lazy on device -
    // also sendMessage when reachable so the watch sees state immediately.
    let s = WCSession.default
    if s.isReachable {
      s.sendMessage(["snapshot": json], replyHandler: nil) { error in
        print("[WatchSync] sendMessage failed: \(error)")
      }
    }
  }

  private static func stripNulls(_ value: Any) -> Any? {
    if value is NSNull { return nil }
    if let dict = value as? [String: Any] {
      var out: [String: Any] = [:]
      for (k, v) in dict {
        if let c = stripNulls(v) { out[k] = c }
      }
      return out
    }
    if let arr = value as? [Any] {
      return arr.compactMap { stripNulls($0) }
    }
    return value
  }

  /// Arbitrary result payload to the watch (e.g. barcode lookup results).
  /// sendMessage when reachable, transferUserInfo as the queued fallback.
  func sendToWatch(_ json: String) {
    guard WCSession.isSupported(),
          let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    let s = WCSession.default
    if s.isReachable {
      s.sendMessage(obj, replyHandler: nil) { error in
        print("[WatchSync] sendToWatch failed: \(error)")
      }
    } else {
      s.transferUserInfo(obj)
    }
  }

  var isReachable: Bool {
    WCSession.isSupported() && WCSession.default.isReachable
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {}

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    onCommand?(message)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    onCommand?(userInfo)
  }
}

public class WatchSyncModule: Module {
  private let bridge = WatchSessionBridge()

  public func definition() -> ModuleDefinition {
    Name("WatchSync")

    OnCreate {
      bridge.onCommand = { [weak self] message in
        guard let self,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let json = String(data: data, encoding: .utf8)
        else { return }
        self.sendEvent("onCommand", ["json": json])
      }
      bridge.activate()
    }

    Function("pushContext") { (json: String) in
      bridge.pushContext(json)
    }

    Function("sendToWatch") { (json: String) in
      bridge.sendToWatch(json)
    }

    Function("isReachable") { () -> Bool in
      bridge.isReachable
    }

    Events("onCommand")
  }
}
