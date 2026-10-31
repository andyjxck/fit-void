import CoreLocation
import Foundation
import HealthKit
import WatchConnectivity
import WatchKit

/// Snapshot pushed from the phone via applicationContext. Keep in sync with
/// `WatchSnapshot` in src/lib/watchSync.ts.
struct WatchSnapshot: Codable {
  struct Today: Codable {
    var waterMl: Int
    var waterTargetMl: Int
    var kcal: Int
    var kcalTarget: Int
    var steps: Int
    var stepsTarget: Int
  }
  struct RoutineItem: Codable, Identifiable {
    var id: String
    var name: String
  }
  struct PRItem: Codable, Identifiable {
    var id: String
    var exercise: String
    var label: String
    var when: String
  }
  struct StatItem: Codable, Identifiable {
    var id: String { label }
    var label: String
    var value: String
  }
  struct LastWorkout: Codable {
    var title: String
    var when: String
    var detail: String
  }
  struct SetItem: Codable, Identifiable {
    var id: String
    var blockKey: String
    var exercise: String
    var img: String?
    var tt: String
    var label: String
    var w: Double?
    var reps: Int?
    var dur: Int?
    var dist: Double?
    var done: Bool
  }
  struct ExerciseItem: Codable, Identifiable {
    var id: String
    var name: String
    var muscle: String
    var tt: String
    var img: String?
  }
  struct Workout: Codable {
    var active: Bool
    var title: String
    var startedAtMs: Double?
    var pausedAtMs: Double?
    var pausedAccumMs: Double?
    var restEndsAt: Double? // epoch ms
    var restLabel: String?
    var restDurationSec: Int?
    var restRemainingMs: Double? // frozen remainder while paused
    var sets: [SetItem]
  }
  /// One day in a week chart (`d` = single-letter weekday, oldest→newest).
  struct DayVal: Codable { var d: String; var v: Double }
  /// Ring-tap detail payload - optional so older phone builds still decode.
  struct Detail: Codable {
    struct Hydration: Codable {
      var targetMl: Int
      var week: [DayVal]
      var entries: [Entry]
      struct Entry: Codable { var name: String; var ml: Int }
    }
    struct Nutrition: Codable {
      var protein: Int
      var carbs: Int
      var fat: Int
      var week: [DayVal]
      var entries: [Entry]
      struct Entry: Codable { var name: String; var kcal: Int }
    }
    struct Activity: Codable {
      var distM: Double
      var activeKcal: Int
      var exerciseMin: Int
      var week: [DayVal]
    }
    var hydration: Hydration?
    var nutrition: Nutrition?
    var activity: Activity?
  }
  var v: Int
  var today: Today
  var unit: String // "kg" | "lbs"
  var routines: [RoutineItem]
  var exercises: [ExerciseItem]
  var recentPRs: [PRItem]
  var stats: [StatItem]
  var lastWorkout: LastWorkout?
  var workout: Workout?
  var detail: Detail?
}

/// Product pushed back after a `lookupBarcode` command - shown as a confirm
/// card before `logScanned` writes it.
struct BarcodeResult: Codable, Identifiable {
  var id: String { barcode }
  var ok: Bool
  var kind: String // "drink" | "food"
  var barcode: String
  var name: String?
  var brand: String?
  var serving: String?
  var kcal: Double?
  var protein: Double?
  var carbs: Double?
  var fat: Double?
  var isDrink: Bool?
}

/// Data captured at the moment Finish is tapped, so the celebration survives
/// the snapshot clearing the workout. Volume/sets are computed watch-side
/// from display-unit values in the snapshot.
struct WorkoutCelebration: Identifiable {
  let id = UUID()
  var title: String
  var durationSec: Int
  var volume: Double
  var unit: String
  var setCount: Int
  var exerciseCount: Int
  var exerciseNames: [String]
}

/// Live heart rate from the watch's own sensor - they're wearing a watch.
/// An anchored-object query keeps publishing new samples while the app runs.
final class HeartRateManager: ObservableObject {
  @Published var bpm: Int?

  func start() {
    guard HKHealthStore.isHealthDataAvailable() else { return }
    let type = HKQuantityType(.heartRate)
    HKHealthStore().requestAuthorization(toShare: [], read: [type]) { ok, _ in
      guard ok else { return }
      DispatchQueue.main.async { self.run(type) }
    }
  }

  private func run(_ type: HKQuantityType) {
    let bpmUnit = HKUnit.count().unitDivided(by: .minute())
    let publish: ([HKSample]?) -> Void = { [weak self] samples in
      guard let last = (samples as? [HKQuantitySample])?.last else { return }
      let v = Int(last.quantity.doubleValue(for: bpmUnit))
      DispatchQueue.main.async { self?.bpm = v }
    }
    let q = HKAnchoredObjectQuery(type: type, predicate: nil, anchor: nil,
                                  limit: HKObjectQueryNoLimit) { _, s, _, _, _ in publish(s) }
    q.updateHandler = { _, s, _, _, _ in publish(s) }
    HKHealthStore().execute(q)
  }
}

/// Live cardio session on the wrist: elapsed clock, HR via HealthKit, and
/// GPS distance via CoreLocation when the watch can see satellites (indoor
/// kit stays 0 - the confirm screen keeps distance editable either way).
final class CardioSessionManager: NSObject, ObservableObject, CLLocationManagerDelegate {
  @Published var active = false
  @Published var startedAt: Date?
  @Published var pausedAt: Date?
  @Published var pausedAccumMs: Double = 0
  @Published var distanceM: Double = 0
  @Published var bpm: Int?
  @Published var avgHr: Int?

  private let loc = CLLocationManager()
  private var lastLoc: CLLocation?
  private var hrSum = 0
  private var hrCount = 0

  var paused: Bool { pausedAt != nil }

  var elapsedSec: Int {
    guard let startedAt else { return 0 }
    let end = pausedAt ?? Date()
    return max(0, Int((end.timeIntervalSince(startedAt) * 1000 - pausedAccumMs) / 1000))
  }

  func start() {
    startedAt = Date()
    pausedAt = nil
    pausedAccumMs = 0
    distanceM = 0
    bpm = nil
    avgHr = nil
    hrSum = 0
    hrCount = 0
    lastLoc = nil
    active = true

    loc.delegate = self
    loc.desiredAccuracy = kCLLocationAccuracyBest
    loc.requestWhenInUseAuthorization()
    loc.startUpdatingLocation()
    startHR()
  }

  func togglePause() {
    let now = Date()
    if let pausedAt {
      pausedAccumMs += now.timeIntervalSince(pausedAt) * 1000
      self.pausedAt = nil
      loc.startUpdatingLocation()
    } else {
      pausedAt = now
      loc.stopUpdatingLocation()
      lastLoc = nil
    }
  }

  /// Ends the session; caller reads elapsedSec/avgHr/distanceM for the
  /// confirm screen, then discards the manager.
  func stop() {
    if let pausedAt { pausedAccumMs += Date().timeIntervalSince(pausedAt) * 1000 }
    pausedAt = nil
    active = false
    loc.stopUpdatingLocation()
  }

  private func startHR() {
    guard HKHealthStore.isHealthDataAvailable() else { return }
    let type = HKQuantityType(.heartRate)
    HKHealthStore().requestAuthorization(toShare: [], read: [type]) { ok, _ in
      guard ok else { return }
      DispatchQueue.main.async { self.runHR(type) }
    }
  }

  private func runHR(_ type: HKQuantityType) {
    let bpmUnit = HKUnit.count().unitDivided(by: .minute())
    let publish: ([HKSample]?) -> Void = { [weak self] samples in
      guard let self, let last = (samples as? [HKQuantitySample])?.last else { return }
      let v = Int(last.quantity.doubleValue(for: bpmUnit))
      DispatchQueue.main.async {
        self.bpm = v
        self.hrSum += v
        self.hrCount += 1
        self.avgHr = self.hrSum / self.hrCount
      }
    }
    let q = HKAnchoredObjectQuery(type: type, predicate: nil, anchor: nil,
                                  limit: HKObjectQueryNoLimit) { _, s, _, _, _ in publish(s) }
    q.updateHandler = { _, s, _, _, _ in publish(s) }
    HKHealthStore().execute(q)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard !paused, let new = locations.last else { return }
    // Filter junk fixes (indoor drift) - >50m accuracy isn't real movement.
    if let last = lastLoc, new.horizontalAccuracy <= 50 {
      distanceM += new.distance(from: last)
    }
    lastLoc = new
  }
}

/// Watch side of the WatchConnectivity pipe. The phone owns the database;
/// the watch renders snapshots and sends commands back.
final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
  static let shared = WatchSessionManager()

  @Published var snapshot: WatchSnapshot?
  @Published var reachable = false
  @Published var lastError: String?
  @Published var celebration: WorkoutCelebration?
  @Published var barcodeResult: BarcodeResult?

  private override init() {
    super.init()
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  /// Fire-and-forget command to the phone (`sendMessage` when reachable,
  /// `transferUserInfo` as the background fallback).
  func send(_ command: [String: Any]) {
    let session = WCSession.default
    if session.isReachable {
      session.sendMessage(command, replyHandler: nil) { [weak self] error in
        DispatchQueue.main.async { self?.lastError = error.localizedDescription }
      }
    } else {
      session.transferUserInfo(command)
    }
  }

  func logWater(ml: Int) {
    send(["cmd": "logWater", "ml": ml])
    WKInterfaceDevice.current().play(.click)
    // Optimistic bump - the confirming snapshot arrives shortly after.
    if var s = snapshot {
      s.today.waterMl += ml
      DispatchQueue.main.async { self.snapshot = s }
    }
  }

  func completeSet(_ id: String, done: Bool) {
    send(["cmd": done ? "completeSet" : "uncompleteSet", "setId": id])
  }

  func skipRest() { send(["cmd": "skipRest"]) }

  /// Pause/resume the whole workout. Mirrors the phone's togglePause so the
  /// UI flips immediately; the confirming snapshot lands right after.
  func togglePause() {
    send(["cmd": "togglePause"])
    WKInterfaceDevice.current().play(.click)
    guard var s = snapshot, var w = s.workout else { return }
    let now = Date().timeIntervalSince1970 * 1000
    if let pausedAt = w.pausedAtMs {
      w.pausedAccumMs = (w.pausedAccumMs ?? 0) + (now - pausedAt)
      w.pausedAtMs = nil
      if let remaining = w.restRemainingMs {
        w.restEndsAt = now + remaining
        w.restRemainingMs = nil
      }
    } else {
      w.pausedAtMs = now
      if let endsAt = w.restEndsAt {
        w.restRemainingMs = max(0, endsAt - now)
      }
    }
    s.workout = w
    DispatchQueue.main.async { self.snapshot = s }
  }
  func startWorkout() { send(["cmd": "startWorkout"]) }
  func startRoutine(_ id: String) { send(["cmd": "startRoutine", "routineId": id]) }
  /// Captures a local summary for the celebration screen before the phone's
  /// confirming snapshot wipes the workout out from under the UI.
  func finishWorkout() {
    send(["cmd": "finishWorkout"])
    WKInterfaceDevice.current().play(.success)
    if let s = snapshot, let w = s.workout, w.active {
      let done = w.sets.filter { $0.done }
      let now = Date().timeIntervalSince1970 * 1000
      let pausedMs = (w.pausedAccumMs ?? 0) + (w.pausedAtMs.map { now - $0 } ?? 0)
      let elapsedMs = max(0, (w.startedAtMs.map { now - $0 } ?? 0) - pausedMs)
      var names: [String] = []
      for set in done where !names.contains(set.exercise) { names.append(set.exercise) }
      celebration = WorkoutCelebration(
        title: w.title,
        durationSec: Int(elapsedMs / 1000),
        volume: done.reduce(0) { $0 + ($1.w ?? 0) * Double($1.reps ?? 0) },
        unit: s.unit,
        setCount: done.count,
        exerciseCount: names.count,
        exerciseNames: names
      )
    }
  }
  func discardWorkout() { send(["cmd": "discardWorkout"]) }
  func addExercise(_ id: String) { send(["cmd": "addExercise", "exerciseId": id]) }
  func addSet(after setId: String) { send(["cmd": "addSet", "setId": setId]) }
  /// Drops a cardio block into the live workout - its sets get edited like
  /// any other (time/distance steppers on the set sheet).
  func addCardioExercise(_ activity: String) {
    send(["cmd": "addCardioExercise", "activity": activity])
    WKInterfaceDevice.current().play(.click)
  }
  /// Finished cardio session -> phone writes cardio_sessions standalone or
  /// a cardio block when a workout is live. dist is in display units.
  func logCardio(activity: String, durationSec: Int, dist: Double, avgHr: Int?) {
    send(["cmd": "logCardio", "activity": activity,
          "durationSec": durationSec, "dist": dist, "avgHr": avgHr ?? 0])
    WKInterfaceDevice.current().play(.success)
  }
  /// Typed-barcode lookup; the product arrives back as `barcodeResult`.
  func lookupBarcode(_ code: String, kind: String) {
    barcodeResult = nil
    send(["cmd": "lookupBarcode", "code": code, "kind": kind])
    WKInterfaceDevice.current().play(.click)
  }
  /// Confirmed a scanned product - the phone writes the nutrition row (and
  /// the liquid shadow for drinks).
  func logScanned(_ r: BarcodeResult) {
    send(["cmd": "logScanned", "name": r.name ?? "Scanned item",
          "kcal": r.kcal ?? 0, "protein": r.protein ?? 0, "carbs": r.carbs ?? 0,
          "fat": r.fat ?? 0, "isDrink": r.isDrink ?? false,
          "serving": r.serving ?? "", "barcode": r.barcode])
    barcodeResult = nil
    WKInterfaceDevice.current().play(.success)
  }

  /// Delta is in display units (lbs or kg, mi or km, seconds, reps).
  func updateSet(_ setId: String, field: String, delta: Double) {
    send(["cmd": "updateSet", "setId": setId, "field": field, "delta": delta])
    WKInterfaceDevice.current().play(.click)
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async {
      self.reachable = session.isReachable
      self.lastError = error?.localizedDescription
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async { self.reachable = session.isReachable }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    decode(applicationContext)
  }

  /// Snapshot also arrives as an immediate message when reachable - same
  /// decode path for both channels. `barcodeResult` is the lookup reply.
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    if let json = message["snapshot"] as? String,
       let data = json.data(using: .utf8),
       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      decode(obj)
    }
    decodeBarcodeResult(message)
  }

  /// Queued fallback channel - barcode results land here when the watch was
  /// unreachable at send time.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    decodeBarcodeResult(userInfo)
  }

  private func decodeBarcodeResult(_ dict: [String: Any]) {
    guard let obj = dict["barcodeResult"] as? [String: Any],
          let data = try? JSONSerialization.data(withJSONObject: obj),
          let result = try? JSONDecoder().decode(BarcodeResult.self, from: data)
    else { return }
    DispatchQueue.main.async { self.barcodeResult = result }
  }

  private func decode(_ dict: [String: Any]) {
    // Barcode replies can piggyback inside a snapshot push (fallback path
    // for phones whose native build predates the sendToWatch function).
    decodeBarcodeResult(dict)
    do {
      let data = try JSONSerialization.data(withJSONObject: dict)
      let snap = try JSONDecoder().decode(WatchSnapshot.self, from: data)
      DispatchQueue.main.async { self.snapshot = snap }
    } catch {
      print("[FitVoid] snapshot decode failed: \(error)")
      DispatchQueue.main.async { self.lastError = String(describing: error) }
    }
  }
}
