import SwiftUI
import WatchKit

private let lime = Color(red: 0.8, green: 1.0, blue: 0.0)   // #CCFF00
private let ink = Color(red: 0.04, green: 0.04, blue: 0.0)  // accentText
private let waterBlue = Color(red: 0.25, green: 0.75, blue: 1.0)
private let waterTop = Color(red: 0.62, green: 0.88, blue: 1.0)
private let waterDeep = Color(red: 0.0, green: 0.42, blue: 0.85)
private let stepGreen = Color(red: 0.3, green: 0.9, blue: 0.45)
private let setOrange = Color(red: 1.0, green: 0.55, blue: 0.1)

/// Activity-style progress ring shared by the home and workout heroes.
private func progressRing(diameter: CGFloat, color: Color, pct: Double) -> some View {
  ZStack {
    Circle()
      .stroke(color.opacity(0.18), style: StrokeStyle(lineWidth: 9))
    Circle()
      .trim(from: 0, to: min(1, max(0, pct)))
      .stroke(color, style: StrokeStyle(lineWidth: 9, lineCap: .round))
      .rotationEffect(.degrees(-90))
      .animation(.easeOut(duration: 0.6), value: pct)
  }
  .frame(width: diameter, height: diameter)
}

struct ContentView: View {
  @EnvironmentObject private var session: WatchSessionManager

  var body: some View {
    Group {
      if let w = session.snapshot?.workout, w.active {
        WorkoutView(workout: w)
      } else {
        HomeView()
      }
    }
    .environmentObject(session)
    .fullScreenCover(item: $session.celebration) { c in
      CelebrationView(celebration: c) { session.celebration = nil }
    }
  }
}

// MARK: - Workout celebration

/// Shown after Finish - mirrors the phone's WorkoutSummary: trophy, title,
/// duration hero, volume/sets/exercises, then DONE back to the face.
private struct CelebrationView: View {
  let celebration: WorkoutCelebration
  let onDone: () -> Void
  @State private var burst = false

  private var clock: String {
    let s = celebration.durationSec
    return s >= 3600
      ? String(format: "%d:%02d:%02d", s / 3600, s % 3600 / 60, s % 60)
      : String(format: "%d:%02d", s / 60, s % 60)
  }

  private var volumeText: String {
    celebration.volume >= 1000
      ? String(format: "%.1fk", celebration.volume / 1000)
      : String(format: "%.0f", celebration.volume)
  }

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      StarField()

      // Confetti stand-in: expanding lime/orange/blue rings, like the app's
      // cannon colors, bursting once when the cover opens.
      ForEach(0..<3, id: \.self) { i in
        Circle()
          .stroke([lime, setOrange, waterBlue][i].opacity(burst ? 0 : 0.5),
                  lineWidth: 3)
          .frame(width: 40, height: 40)
          .scaleEffect(burst ? 6 : 0.2)
          .animation(.easeOut(duration: 1.1).delay(Double(i) * 0.12), value: burst)
      }

      ScrollView {
        VStack(spacing: 8) {
          ZStack {
            Circle()
              .fill(RadialGradient(colors: [lime.opacity(0.35), .clear],
                                   center: .center, startRadius: 4, endRadius: 34))
              .frame(width: 68, height: 68)
            Image(systemName: "trophy.fill")
              .font(.system(size: 26))
              .foregroundStyle(lime)
          }
          .scaleEffect(burst ? 1 : 0.4)
          .animation(.spring(response: 0.5, dampingFraction: 0.6), value: burst)

          Text("GREAT JOB")
            .font(.system(size: 9, weight: .bold))
            .tracking(1.5)
            .foregroundStyle(.white.opacity(0.55))
          Text(celebration.title)
            .font(.system(size: 14, weight: .bold))
            .multilineTextAlignment(.center)

          VStack(spacing: 0) {
            Text(clock)
              .font(.system(size: 30, weight: .bold, design: .rounded))
              .monospacedDigit()
            Text("DURATION")
              .font(.system(size: 8, weight: .bold))
              .tracking(1)
              .foregroundStyle(.white.opacity(0.45))
          }

          HStack(spacing: 0) {
            stat("\(volumeText)", "\(celebration.unit.uppercased()) VOL")
            stat("\(celebration.setCount)", "SETS")
            stat("\(celebration.exerciseCount)", "EXERCISES")
          }

          if !celebration.exerciseNames.isEmpty {
            VStack(spacing: 2) {
              ForEach(celebration.exerciseNames, id: \.self) { name in
                Text(name)
                  .font(.system(size: 10, weight: .medium))
                  .foregroundStyle(.white.opacity(0.7))
                  .lineLimit(1)
              }
            }
          }

          Button(action: onDone) {
            Text("DONE")
              .font(.system(size: 12, weight: .bold))
              .tracking(1)
              .foregroundStyle(ink)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 9)
              .background(lime, in: Capsule())
          }
          .buttonStyle(.plain)
          .padding(.top, 4)
        }
        .padding(.horizontal, 14)
      }
      .scrollIndicators(.hidden)
    }
    .onAppear { burst = true }
  }

  private func stat(_ value: String, _ label: String) -> some View {
    VStack(spacing: 1) {
      Text(value)
        .font(.system(size: 13, weight: .bold))
        .monospacedDigit()
      Text(label)
        .font(.system(size: 7, weight: .bold))
        .tracking(0.5)
        .foregroundStyle(.white.opacity(0.45))
    }
    .frame(maxWidth: .infinity)
  }
}

// MARK: - Activity rings hero

/// Three concentric progress rings around a central play button,
/// Activity-app style. Outer=water, middle=food, inner=steps. Each ring is
/// tappable - opens the matching detail page. Hit areas are full circles,
/// so stacking order decides: inner rings and the play orb win their area.
private struct RingsHero: View {
  let waterPct: Double
  let foodPct: Double
  let stepsPct: Double
  let onPlay: () -> Void
  var onWater: () -> Void = {}
  var onFood: () -> Void = {}
  var onSteps: () -> Void = {}

  var body: some View {
    GeometryReader { geo in
      let d = min(geo.size.width, geo.size.height)
      ZStack {
        progressRing(diameter: d, color: waterBlue, pct: waterPct)
          .contentShape(Circle())
          .onTapGesture(perform: onWater)
        progressRing(diameter: d * 0.74, color: lime, pct: foodPct)
          .contentShape(Circle())
          .onTapGesture(perform: onFood)
        progressRing(diameter: d * 0.48, color: stepGreen, pct: stepsPct)
          .contentShape(Circle())
          .onTapGesture(perform: onSteps)

        Button(action: onPlay) {
          Image(systemName: "play.fill")
            .font(.system(size: d * 0.14, weight: .bold))
            .foregroundStyle(ink)
            .frame(width: d * 0.3, height: d * 0.3)
            .background(lime, in: Circle())
        }
        .buttonStyle(.plain)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

/// Color-keyed legend - labels only, pinned top-left over the rings.
private struct RingLegend: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      row(waterBlue, "Water")
      row(lime, "Food")
      row(stepGreen, "Steps")
    }
  }

  private func row(_ color: Color, _ label: String) -> some View {
    HStack(spacing: 4) {
      Circle().fill(color).frame(width: 5, height: 5)
      Text(label)
        .font(.system(size: 9, weight: .medium))
        .foregroundStyle(Color.white.opacity(0.72))
        .lineLimit(1)
    }
  }
}

/// Static star field behind the home screen. Randomized once per view
/// creation - a different sky each time the app is opened.
private struct StarField: View {
  private let stars: [(x: CGFloat, y: CGFloat, r: CGFloat, o: Double)] = {
    var rng = SystemRandomNumberGenerator()
    return (0..<60).map { _ in
      (x: CGFloat.random(in: 0...1, using: &rng),
       y: CGFloat.random(in: 0...1, using: &rng),
       r: CGFloat.random(in: 0.4...1.4, using: &rng),
       o: Double.random(in: 0.12...0.55, using: &rng))
    }
  }()

  var body: some View {
    GeometryReader { geo in
      ForEach(0..<stars.count, id: \.self) { i in
        Circle()
          .fill(Color.white.opacity(stars[i].o))
          .frame(width: stars[i].r * 2, height: stars[i].r * 2)
          .position(x: stars[i].x * geo.size.width, y: stars[i].y * geo.size.height)
      }
    }
    .allowsHitTesting(false)
  }
}

/// Small circular back button pinned top-left of sheets - replaces the
/// navigation titles, one consistent way back everywhere. Pass `action` for
/// in-place overlays (no sheet to dismiss).
private struct BackOrb: View {
  @Environment(\.dismiss) private var dismiss
  var action: (() -> Void)? = nil
  var body: some View {
    Button { action?() ?? dismiss() } label: {
      Image(systemName: "chevron.left")
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(.white.opacity(0.85))
        .frame(width: 26, height: 26)
        .background(Color.white.opacity(0.12), in: Circle())
    }
    .buttonStyle(.plain)
    .padding(.leading, 6)
    .padding(.top, 2)
  }
}

/// Circular gradient quick-add orb - echoes the ring motif. Used for water
/// on the home face and weight/reps on exercise pages.
private struct QuickOrbButton: View {
  let icon: String
  let label: String
  let colors: [Color]
  var foreground: Color = .white
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      VStack(spacing: 0) {
        Image(systemName: icon)
          .font(.system(size: 11, weight: .bold))
        Text(label)
          .font(.system(size: 9, weight: .bold, design: .rounded))
      }
      .foregroundStyle(foreground)
      .shadow(color: .black.opacity(0.35), radius: 1, y: 0.5)
      .frame(width: 46, height: 46)
      .background {
        Circle()
          .fill(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom))
          .overlay {
            Circle().stroke(Color.white.opacity(0.28), lineWidth: 1)
          }
      }
    }
    .buttonStyle(.plain)
  }
}

/// Water quick-add in the home hero's bottom corners.
private struct WaterOrbButton: View {
  let ml: Int
  let action: () -> Void
  var body: some View {
    QuickOrbButton(icon: "drop.fill", label: "+\(ml)",
                   colors: [waterTop.opacity(0.55), waterBlue.opacity(0.4), waterDeep.opacity(0.5)],
                   action: action)
  }
}

/// Exercise thumbnail: photo when the phone sent an image URL, else a
/// tinted tile with a tracking-type glyph. Circular like watchOS app icons.
private struct ExerciseThumb: View {
  let url: String?
  let tt: String
  var size: CGFloat = 38

  private var icon: String {
    switch tt {
    case "cardio": return "figure.run"
    case "hold": return "timer"
    case "carry": return "figure.walk"
    default: return "dumbbell.fill"
    }
  }

  var body: some View {
    ZStack {
      Circle().fill(Color.white.opacity(0.08))
      Image(systemName: icon)
        .font(.system(size: size * 0.38))
        .foregroundStyle(lime)
      if let url, let u = URL(string: url) {
        AsyncImage(url: u) { image in
          image.resizable().scaledToFill()
        } placeholder: {
          Color.clear
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
      }
    }
    .frame(width: size, height: size)
  }
}

// MARK: - Home

private struct HomeView: View {
  @EnvironmentObject private var session: WatchSessionManager

  @AppStorage("home.showPRs") private var showPRs = true
  @AppStorage("home.showStats") private var showStats = true
  @AppStorage("home.showLastWorkout") private var showLastWorkout = true

  @State private var showStart = false
  @State private var page: String? = nil // "hydration" | "nutrition" | "activity"
  @State private var faceTab = 0 // 0 = rings face, 1 = pulse face
  @State private var showEdit = false

  var body: some View {
    NavigationStack {
      ZStack {
        StarField()
        // Two faces, swipe sideways: the rings home, then the pulse/cardio
        // page (live HR from the wrist + standalone cardio logging).
        TabView(selection: $faceTab) {
          ScrollView {
            VStack(alignment: .leading, spacing: 14) {
              hero
                .containerRelativeFrame(.vertical) { h, _ in h + 30 }
              if showPRs { prsSection }
              if showStats { statsSection }
              if showLastWorkout { lastWorkoutSection }
              editLink
              reachabilityNote
            }
            .padding(.horizontal, 2)
            .padding(.bottom, 24)
          }
          .scrollIndicators(.hidden)
          .tag(0)

          PulseView()
            .environmentObject(session)
            .tag(1)
        }
        .tabViewStyle(.page)

        // Legend pinned to the top-left corner, inset enough that the
        // rounded bezel never clips it.
        RingLegend()
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .padding(.leading, 14)
          .padding(.top, 12)
          .ignoresSafeArea()
          .opacity(faceTab == 0 ? 1 : 0) // rings legend belongs to face 1

        // In-place overlay, NOT a .sheet: when the phone activates the
        // workout, HomeView unmounts and a real sheet would be orphaned on
        // screen with a dead dismiss - which is exactly the stuck-screen bug.
        if showStart {
          StartWorkoutSheet(onClose: { showStart = false })
            .environmentObject(session)
            .background(Color.black.ignoresSafeArea())
            .transition(.opacity)
            .zIndex(10)
        }
        if let page {
          DetailPageView(page: page) { self.page = nil }
            .environmentObject(session)
            .background(Color.black.ignoresSafeArea())
            .transition(.opacity)
            .zIndex(12)
        }
      }
    }
    .sheet(isPresented: $showEdit) {
      EditHomeSheet(showPRs: $showPRs, showStats: $showStats, showLastWorkout: $showLastWorkout)
    }
  }

  private var hero: some View {
    let t = session.snapshot?.today
    let waterPct = pct(t?.waterMl, of: t?.waterTargetMl)
    let foodPct = pct(t?.kcal, of: t?.kcalTarget)
    let stepsPct = pct(t?.steps, of: t?.stepsTarget)
    return ZStack {
      RingsHero(waterPct: waterPct, foodPct: foodPct, stepsPct: stepsPct,
                onPlay: { showStart = true },
                onWater: { page = "hydration" },
                onFood: { page = "nutrition" },
                onSteps: { page = "activity" })
      .frame(height: 150)
      .offset(y: -18)
      // Water quick-adds parked in the dead space either side of the
      // rings' lower arc. They live inside the hero so they scroll away
      // with it instead of floating over the sections below.
      HStack(spacing: 0) {
        WaterOrbButton(ml: 250) { session.logWater(ml: 250) }
        Spacer()
        WaterOrbButton(ml: 500) { session.logWater(ml: 500) }
      }
      .frame(maxHeight: .infinity, alignment: .bottom)
      .padding(.horizontal, 6)
      .padding(.bottom, 20)
    }
  }

  private func pct(_ value: Int?, of target: Int?) -> Double {
    guard let v = value, let t = target, t > 0 else { return 0 }
    return Double(v) / Double(t)
  }

  @ViewBuilder private var prsSection: some View {
    let prs = session.snapshot?.recentPRs ?? []
    if !prs.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        sectionHeader("Recent PRs", icon: "trophy.fill")
        ForEach(prs.prefix(4)) { pr in
          VStack(alignment: .leading, spacing: 1) {
            Text(pr.exercise)
              .font(.system(size: 10, weight: .semibold))
              .foregroundStyle(Color.white.opacity(0.72))
              .lineLimit(1)
            HStack(alignment: .firstTextBaseline) {
              Text(pr.label)
                .font(.system(.callout, design: .rounded, weight: .bold))
              Spacer()
              Text(pr.when)
                .font(.system(size: 9))
                .foregroundStyle(Color.white.opacity(0.55))
            }
          }
        }
      }
    }
  }

  @ViewBuilder private var statsSection: some View {
    let stats = session.snapshot?.stats ?? []
    if !stats.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        sectionHeader("Stats", icon: "chart.bar.fill")
        ForEach(stats) { stat in
          HStack {
            Text(stat.label)
              .font(.system(size: 12))
              .foregroundStyle(Color.white.opacity(0.72))
            Spacer()
            Text(stat.value)
              .font(.system(.callout, design: .rounded, weight: .semibold))
          }
        }
      }
    }
  }

  @ViewBuilder private var lastWorkoutSection: some View {
    if let last = session.snapshot?.lastWorkout {
      VStack(alignment: .leading, spacing: 6) {
        sectionHeader("Last Workout", icon: "clock.arrow.circlepath")
        VStack(alignment: .leading, spacing: 2) {
          Text(last.title)
            .font(.system(.callout, weight: .semibold))
            .lineLimit(1)
          Text("\(last.when) · \(last.detail)")
            .font(.system(size: 10))
            .foregroundStyle(Color.white.opacity(0.72))
            .lineLimit(2)
        }
      }
    }
  }

  private func sectionHeader(_ text: String, icon: String) -> some View {
    HStack(spacing: 5) {
      Image(systemName: icon)
        .font(.system(size: 9))
      Text(text.uppercased())
        .font(.system(size: 10, weight: .bold))
        .tracking(1.0)
    }
    .foregroundStyle(lime)
  }

  private var editLink: some View {
    Button { showEdit = true } label: {
      Label("Edit Home", systemImage: "slider.horizontal.3")
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(Color.white.opacity(0.72))
        .frame(maxWidth: .infinity)
    }
    .buttonStyle(.plain)
    .padding(.top, 2)
  }

  @ViewBuilder private var reachabilityNote: some View {
    if !session.reachable {
      Label("Phone out of range", systemImage: "iphone.slash")
        .font(.system(size: 10))
        .foregroundStyle(Color.white.opacity(0.72))
        .frame(maxWidth: .infinity)
    }
  }
}

// MARK: - Start workout selector

/// Routine launcher - circular icon grid like the watch's own app view:
/// lime + orb for an empty workout, then one orb per routine. Rendered as an
/// in-place overlay (not a sheet) so it can't be orphaned by the view swap.
private struct StartWorkoutSheet: View {
  @EnvironmentObject private var session: WatchSessionManager
  let onClose: () -> Void

  private let cols = [
    GridItem(.flexible(), spacing: 6),
    GridItem(.flexible(), spacing: 6),
    GridItem(.flexible(), spacing: 6),
  ]

  var body: some View {
      ScrollView {
        LazyVGrid(columns: cols, spacing: 14) {
          Button {
            session.startWorkout()
            WKInterfaceDevice.current().play(.click)
            onClose()
          } label: {
            VStack(spacing: 4) {
              ZStack {
                Circle()
                  .fill(LinearGradient(colors: [lime, Color(red: 0.55, green: 0.75, blue: 0)],
                                       startPoint: .top, endPoint: .bottom))
                  .frame(width: 48, height: 48)
                Image(systemName: "plus")
                  .font(.system(size: 18, weight: .bold))
                  .foregroundStyle(ink)
              }
              Text("Empty")
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(1)
            }
          }
          .buttonStyle(.plain)

          ForEach(session.snapshot?.routines ?? []) { r in
            Button {
              session.startRoutine(r.id)
              WKInterfaceDevice.current().play(.click)
              onClose()
            } label: {
              VStack(spacing: 4) {
                ZStack {
                  Circle()
                    .fill(LinearGradient(colors: [setOrange, Color(red: 0.7, green: 0.3, blue: 0.05)],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(width: 48, height: 48)
                  Text(String(r.name.prefix(1)).uppercased())
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                }
                Text(r.name)
                  .font(.system(size: 8, weight: .medium))
                  .foregroundStyle(.primary)
                  .lineLimit(1)
              }
            }
            .buttonStyle(.plain)
          }
        }
        .padding(.horizontal, 4)
        .padding(.top, 30)
        .padding(.bottom, 24)
      }
      .overlay(alignment: .topLeading) { BackOrb(action: onClose) }
  }
}

// MARK: - Edit home sheet

private struct EditHomeSheet: View {
  @Binding var showPRs: Bool
  @Binding var showStats: Bool
  @Binding var showLastWorkout: Bool
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        Section("Sections") {
          Toggle("Recent PRs", isOn: $showPRs)
          Toggle("Stats", isOn: $showStats)
          Toggle("Last Workout", isOn: $showLastWorkout)
        }
      }
      .overlay(alignment: .topLeading) { BackOrb() }
    }
  }
}

// MARK: - Live workout

private struct WorkoutView: View {
  @EnvironmentObject private var session: WatchSessionManager
  let workout: WatchSnapshot.Workout

  @State private var confirmDiscard = false
  @State private var editing: WatchSnapshot.SetItem?
  @State private var showExercisePicker = false
  @State private var showCardio = false


  /// Sets grouped by exercise, preserving workout order.
  private var groups: [(key: String, name: String, sets: [WatchSnapshot.SetItem])] {
    var out: [(String, String, [WatchSnapshot.SetItem])] = []
    for s in workout.sets {
      if let i = out.firstIndex(where: { $0.0 == s.blockKey }) {
        out[i].2.append(s)
      } else {
        out.append((s.blockKey, s.exercise, [s]))
      }
    }
    return out
  }

  var body: some View {
    NavigationStack {
      ZStack {
        StarField()
        TabView {
          heroPage
          ForEach(groups, id: \.key) { group in
            exercisePage(group)
          }
          if groups.isEmpty { emptyState }
          actionsPage
        }
        .tabViewStyle(.page)

        // In-place overlay (not .sheet) - dies with the workout if it
        // finishes mid-flow instead of orphaning on screen.
        if showCardio {
          CardioFlowView { showCardio = false }
            .environmentObject(session)
            .background(Color.black.ignoresSafeArea())
            .transition(.opacity)
            .zIndex(10)
        }
      }
    }
    .sheet(item: $editing) { set in
      SetDetailSheet(set: set, unit: session.snapshot?.unit ?? "kg")
        .environmentObject(session)
    }
    .sheet(isPresented: $showExercisePicker) {
      ExercisePickerSheet()
        .environmentObject(session)
    }
    .confirmationDialog("Discard workout?", isPresented: $confirmDiscard) {
      Button("Discard", role: .destructive) { session.discardWorkout() }
      Button("Cancel", role: .cancel) {}
    }
  }

  // MARK: - Hero: exercise title, clock, pause orb with set/rest rings, skip

  private var paused: Bool { workout.pausedAtMs != nil }

  private var resting: Bool {
    workout.restEndsAt != nil || workout.restRemainingMs != nil
  }

  private var restRemainingSec: Int {
    if let rem = workout.restRemainingMs { return Int(rem / 1000) }
    guard let ends = workout.restEndsAt else { return 0 }
    return max(0, Int(ends / 1000 - Date().timeIntervalSince1970))
  }

  private var elapsedSec: Int {
    let end = workout.pausedAtMs ?? Date().timeIntervalSince1970 * 1000
    return max(0, Int((end - (workout.startedAtMs ?? end) - (workout.pausedAccumMs ?? 0)) / 1000))
  }

  private var heroTime: String {
    let s = resting ? restRemainingSec : elapsedSec
    if s >= 3600 {
      return "\(s / 3600):\(String(format: "%02d", (s % 3600) / 60)):\(String(format: "%02d", s % 60))"
    }
    return "\(s / 60):\(String(format: "%02d", s % 60))"
  }

  private var restPct: Double {
    guard resting, let dur = workout.restDurationSec, dur > 0 else { return 0 }
    return Double(restRemainingSec) / Double(dur)
  }

  /// The exercise being worked now - first group with an incomplete set.
  private var currentGroup: (key: String, name: String, sets: [WatchSnapshot.SetItem])? {
    groups.first(where: { $0.sets.contains(where: { !$0.done }) }) ?? groups.last
  }

  private var currentExercise: String {
    currentGroup?.name ?? workout.title
  }

  /// First incomplete set of the current exercise - its ring glows orange
  /// while you're lifting and turns into the blue rest countdown after.
  private var currentSetId: String? {
    currentGroup?.sets.first(where: { !$0.done })?.id
  }

  private var heroPage: some View {
    VStack(spacing: 4) {
      Text(currentExercise.uppercased())
        .font(.system(size: 12, weight: .bold))
        .tracking(1)
        .foregroundStyle(lime)
        .lineLimit(1)

      TimelineView(.periodic(from: .now, by: 1)) { _ in
        Text(heroTime)
          .font(.system(.title2, design: .rounded, weight: .bold).monospacedDigit())
          .foregroundStyle(paused ? .secondary : .primary)
      }
      .onChange(of: restRemainingSec) { _, now in
        if now == 0 && resting { WKInterfaceDevice.current().play(.notification) }
      }

      GeometryReader { geo in
        let d = min(geo.size.width, geo.size.height)
        let sets = currentGroup?.sets ?? []
        let lw: CGFloat = sets.count > 4 ? 5 : 8
        ZStack {
          ForEach(Array(sets.enumerated()), id: \.element.id) { i, set in
            setRing(set, isCurrent: set.id == currentSetId,
                    diameter: max(24, d - CGFloat(i) * (lw + 5) * 2), lw: lw)
          }
          if sets.isEmpty {
            progressRing(diameter: d, color: setOrange, pct: 0)
          }

          // During a set: ✓ marks it done (the phone fires the rest timer).
          // During rest: ⏸ pauses the workout. Paused: ▶ resumes.
          Button {
            if paused || resting {
              session.togglePause()
            } else if let id = currentSetId {
              session.completeSet(id, done: true)
            }
          } label: {
            Image(systemName: paused ? "play.fill" : resting ? "pause.fill" : "checkmark")
              .font(.system(size: d * 0.13, weight: .bold))
              .foregroundStyle(ink)
              .frame(width: d * 0.28, height: d * 0.28)
              .background(paused ? Color.gray.opacity(0.7) : lime, in: Circle())
          }
          .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(paused ? 0.7 : 1)
      }
      .frame(height: 130)

      Button { session.skipRest() } label: {
        Text("SKIP")
          .font(.system(size: 10, weight: .bold))
          .tracking(1)
          .foregroundStyle(resting ? waterBlue : Color.white.opacity(0.3))
      }
      .buttonStyle(.plain)
      .disabled(!resting)
    }
    .frame(maxWidth: .infinity)
    .overlay(alignment: .bottom) {
      // Quick-add orbs parked in the hero's bottom corners - same language
      // as the water orbs on the home face. They edit the current set.
      if let target = currentGroup?.sets.first(where: { !$0.done }) ?? currentGroup?.sets.last {
        let lbs = session.snapshot?.unit == "lbs"
        let wStep = lbs ? 5.0 : 2.5
        HStack(spacing: 0) {
          QuickOrbButton(icon: "dumbbell.fill",
                         label: "+\(wStep.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(wStep))" : "\(wStep)")",
                         colors: [Color.orange.opacity(0.5), setOrange.opacity(0.45), Color(red: 0.7, green: 0.3, blue: 0.05).opacity(0.55)]) {
            session.updateSet(target.id, field: "w", delta: wStep)
          }
          Spacer()
          QuickOrbButton(icon: "plus", label: "+1",
                         colors: [lime.opacity(0.55), lime.opacity(0.4), Color(red: 0.35, green: 0.5, blue: 0.0).opacity(0.55)],
                         foreground: .white) {
            session.updateSet(target.id, field: "reps", delta: 1)
          }
        }
        .padding(.horizontal, 6)
        .offset(y: 8)
      }
    }
  }

  /// One ring per set: done = solid orange, current = orange glow (or the
  /// blue rest countdown), upcoming = faint track only.
  private func setRing(_ set: WatchSnapshot.SetItem, isCurrent: Bool, diameter: CGFloat, lw: CGFloat) -> some View {
    ZStack {
      Circle()
        .stroke((isCurrent && resting ? waterBlue : setOrange).opacity(0.18),
                style: StrokeStyle(lineWidth: lw))
      if set.done {
        Circle().stroke(setOrange, style: StrokeStyle(lineWidth: lw))
      } else if isCurrent {
        if resting {
          Circle()
            .trim(from: 0, to: min(1, max(0, restPct)))
            .stroke(waterBlue, style: StrokeStyle(lineWidth: lw, lineCap: .round))
            .rotationEffect(.degrees(-90))
            .animation(.easeOut(duration: 0.6), value: restPct)
        } else {
          Circle()
            .stroke(setOrange, style: StrokeStyle(lineWidth: lw))
            .shadow(color: setOrange.opacity(0.9), radius: 5)
        }
      }
    }
    .frame(width: diameter, height: diameter)
  }

  /// One exercise per page - swipe sideways, no long vertical list.
  private func exercisePage(_ group: (key: String, name: String, sets: [WatchSnapshot.SetItem])) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 5) {
        Text(group.name.uppercased())
          .font(.system(size: 10, weight: .bold))
          .tracking(1)
          .foregroundStyle(lime)
        ForEach(Array(group.sets.enumerated()), id: \.element.id) { i, set in
          SetRowView(set: set, index: i + 1) { editing = set }
        }
        Button { session.addSet(after: group.sets.last?.id ?? "") } label: {
          Label("Set", systemImage: "plus")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(lime)
        }
        .buttonStyle(.plain)
        .disabled(group.sets.isEmpty)
      }
      .padding(.horizontal, 2)
    }
    .scrollIndicators(.hidden)
  }

  private var emptyState: some View {
    VStack(spacing: 8) {
      Text("No exercises yet")
        .font(.footnote)
        .foregroundStyle(Color.white.opacity(0.72))
      Button {
        showExercisePicker = true
      } label: {
        Label("Add Exercise", systemImage: "plus.circle.fill")
          .font(.system(.body, design: .rounded, weight: .bold))
          .frame(maxWidth: .infinity)
      }
      .tint(lime)
      .foregroundStyle(ink)
      Button {
        showCardio = true
      } label: {
        Label("Add Cardio", systemImage: "figure.run")
          .font(.system(.body, design: .rounded, weight: .bold))
          .frame(maxWidth: .infinity)
      }
      .tint(stepGreen)
      .foregroundStyle(ink)
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 20)
    .padding(.vertical, 6)
  }

  /// Last page: compact action rows instead of fat buttons.
  private var actionsPage: some View {
    VStack(spacing: 8) {
      Button { showExercisePicker = true } label: {
        Label("Add Exercise", systemImage: "plus")
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .frame(maxWidth: .infinity)
      }
      .controlSize(.small)

      Button { showCardio = true } label: {
        Label("Add Cardio", systemImage: "figure.run")
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .frame(maxWidth: .infinity)
      }
      .tint(stepGreen)
      .controlSize(.small)

      Button { session.logWater(ml: 250) } label: {
        Label("+250 ml", systemImage: "drop.fill")
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .frame(maxWidth: .infinity)
      }
      .tint(waterBlue)
      .controlSize(.small)

      Button { session.finishWorkout() } label: {
        Label("Finish", systemImage: "flag.checkered")
          .font(.system(size: 12, weight: .bold, design: .rounded))
          .frame(maxWidth: .infinity)
      }
      .tint(lime)
      .foregroundStyle(ink)
      .controlSize(.small)

      Button(role: .destructive) { confirmDiscard = true } label: {
        Text("Discard")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(.red.opacity(0.85))
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 10)
  }
}

/// Activity orb grid shared by the pulse page and the workout's Add Cardio
/// flow. Tapping an orb starts a live session, never a bare log.
private struct CardioGrid: View {
  @EnvironmentObject private var session: WatchSessionManager
  var onPick: (String) -> Void

  static let activities: [(key: String, label: String, icon: String)] = [
    ("run", "Run", "figure.run"), ("walk", "Walk", "figure.walk"),
    ("cycle", "Cycle", "bicycle"), ("swim", "Swim", "figure.pool.swim"),
    ("row", "Row", "figure.rower"), ("hike", "Hike", "figure.hiking"),
    ("elliptical", "Elliptical", "figure.elliptical"),
    ("stairs", "Stairs", "figure.stair.stepper"),
    ("other", "Other", "figure.mixed.cardio"),
  ]

  private let cols = [
    GridItem(.flexible(), spacing: 6),
    GridItem(.flexible(), spacing: 6),
    GridItem(.flexible(), spacing: 6),
  ]

  var body: some View {
    LazyVGrid(columns: cols, spacing: 14) {
      ForEach(Self.activities, id: \.key) { a in
        Button { onPick(a.key) } label: { orb(a) }
          .buttonStyle(.plain)
      }
    }
  }

  private func orb(_ a: (key: String, label: String, icon: String)) -> some View {
    VStack(spacing: 4) {
      ZStack {
        Circle()
          .fill(LinearGradient(colors: [stepGreen, Color(red: 0.1, green: 0.55, blue: 0.25)],
                               startPoint: .top, endPoint: .bottom))
          .frame(width: 48, height: 48)
        Image(systemName: a.icon)
          .font(.system(size: 17))
          .foregroundStyle(.white)
      }
      Text(a.label)
        .font(.system(size: 8, weight: .medium))
        .foregroundStyle(.primary)
        .lineLimit(1)
    }
  }
}

/// Full cardio flow as an in-place overlay: pick an activity (skipped when
/// one was pre-selected), live session (clock + HR + GPS distance), then a
/// confirm screen where duration/distance stay editable before logging.
private struct CardioFlowView: View {
  @EnvironmentObject private var session: WatchSessionManager
  @StateObject private var tracker = CardioSessionManager()
  /// Pre-select an activity to skip the grid (pulse page taps land here).
  var startActivity: String? = nil
  let onClose: () -> Void

  private enum Phase { case pick, live, confirm }
  @State private var phase: Phase = .pick
  @State private var activity: String = ""
  @State private var label: String = ""

  var body: some View {
    Group {
      switch phase {
      case .pick:
        ScrollView {
          CardioGrid { key in
            activity = key
            label = CardioGrid.activities.first { $0.key == key }?.label ?? key
            tracker.start()
            phase = .live
          }
          .padding(.horizontal, 4)
          .padding(.top, 30)
        }
        .overlay(alignment: .topLeading) { BackOrb(action: onClose) }
      case .live:
        CardioLiveView(tracker: tracker, label: label) {
          tracker.stop()
          phase = .confirm
        }
      case .confirm:
        CardioEntryView(activity: activity, label: label,
                        startSec: tracker.elapsedSec,
                        startDistM: tracker.distanceM,
                        avgHr: tracker.avgHr,
                        onDone: onClose)
          .environmentObject(session)
      }
    }
    .onAppear {
      if let startActivity, phase == .pick {
        activity = startActivity
        label = CardioGrid.activities.first { $0.key == startActivity }?.label ?? startActivity
        tracker.start()
        phase = .live
      }
    }
  }
}

/// Live cardio session: activity title, elapsed clock, pause orb inside a
/// red HR ring, live bpm + distance below, END under it all.
private struct CardioLiveView: View {
  @EnvironmentObject private var session: WatchSessionManager
  @ObservedObject var tracker: CardioSessionManager
  let label: String
  let onEnd: () -> Void

  private var clock: String {
    let s = tracker.elapsedSec
    return s >= 3600
      ? String(format: "%d:%02d:%02d", s / 3600, s % 3600 / 60, s % 60)
      : String(format: "%d:%02d", s / 60, s % 60)
  }

  var body: some View {
    let miles = session.snapshot?.unit == "lbs"
    let distText = miles
      ? String(format: "%.2f mi", tracker.distanceM / 1609.344)
      : String(format: "%.2f km", tracker.distanceM / 1000)
    VStack(spacing: 4) {
      Text(label.uppercased())
        .font(.system(size: 12, weight: .bold))
        .tracking(1)
        .foregroundStyle(stepGreen)
        .lineLimit(1)

      TimelineView(.periodic(from: .now, by: 1)) { _ in
        Text(clock)
          .font(.system(.title2, design: .rounded, weight: .bold).monospacedDigit())
          .foregroundStyle(tracker.paused ? .secondary : .primary)
      }

      GeometryReader { geo in
        let d = min(geo.size.width, geo.size.height)
        ZStack {
          // HR ring - fills toward a nominal 190 max like a zone gauge.
          progressRing(diameter: d, color: .red,
                       pct: Double(tracker.bpm ?? 0) / 190)
          Button { tracker.togglePause() } label: {
            Image(systemName: tracker.paused ? "play.fill" : "pause.fill")
              .font(.system(size: d * 0.16, weight: .bold))
              .foregroundStyle(ink)
              .frame(width: d * 0.36, height: d * 0.36)
              .background(lime, in: Circle())
          }
          .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .frame(height: 100)

      HStack(spacing: 0) {
        VStack(spacing: 0) {
          Text(tracker.bpm.map { "\($0)" } ?? "--")
            .font(.system(size: 14, weight: .bold).monospacedDigit())
            .foregroundStyle(.red)
          Text("BPM")
            .font(.system(size: 7, weight: .bold))
            .foregroundStyle(Color.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        VStack(spacing: 0) {
          Text(distText)
            .font(.system(size: 14, weight: .bold).monospacedDigit())
            .foregroundStyle(waterBlue)
          Text("DIST")
            .font(.system(size: 7, weight: .bold))
            .foregroundStyle(Color.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
      }

      Button(action: onEnd) {
        Text("END")
          .font(.system(size: 11, weight: .bold))
          .tracking(1)
          .foregroundStyle(ink)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
          .background(lime, in: Capsule())
      }
      .buttonStyle(.plain)
      .padding(.horizontal, 30)
    }
  }
}

/// Post-session confirm - duration and distance prefill from the tracker
/// (GPS may read 0 indoors) and stay editable, then LOG writes the session.
private struct CardioEntryView: View {
  @EnvironmentObject private var session: WatchSessionManager
  let activity: String
  let label: String
  var startSec: Int = 0
  var startDistM: Double = 0
  var avgHr: Int? = nil
  var onDone: (() -> Void)? = nil
  @State private var mins = 0
  @State private var dist = 0.0

  var body: some View {
    let miles = session.snapshot?.unit == "lbs"
    ScrollView {
      VStack(spacing: 10) {
        Text(label.uppercased())
          .font(.system(size: 11, weight: .bold))
          .tracking(1)
          .foregroundStyle(stepGreen)
          .padding(.top, 8)

        if let avgHr {
          Text("AVG \(avgHr) BPM")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.red)
        }

        stepper("MIN", "\(mins)", step: 5) { d in mins = min(600, max(0, mins + Int(d))) }
        stepper(miles ? "MI" : "KM",
                String(format: "%.1f", dist), step: 0.5) { d in
          dist = max(0, dist + d)
        }

        Button {
          session.logCardio(activity: activity, durationSec: mins * 60,
                            dist: dist, avgHr: avgHr)
          onDone?()
        } label: {
          Text("LOG")
            .font(.system(.body, design: .rounded, weight: .bold))
            .frame(maxWidth: .infinity)
        }
        .tint(lime)
        .foregroundStyle(ink)
      }
      .padding(.horizontal, 6)
    }
    .onAppear {
      mins = max(1, Int(round(Double(startSec) / 60)))
      dist = startDistM / (miles ? 1609.344 : 1000)
    }
  }

  private func stepper(_ label: String, _ value: String, step: Double,
                       apply: @escaping (Double) -> Void) -> some View {
    VStack(spacing: 2) {
      Text(label)
        .font(.system(size: 8, weight: .bold))
        .tracking(1)
        .foregroundStyle(Color.white.opacity(0.55))
      HStack(spacing: 10) {
        Button { apply(-step) } label: {
          Image(systemName: "minus").font(.system(size: 13, weight: .bold))
        }
        .buttonStyle(.bordered)
        Text(value)
          .font(.system(.title3, design: .rounded, weight: .bold).monospacedDigit())
          .frame(minWidth: 52)
        Button { apply(step) } label: {
          Image(systemName: "plus").font(.system(size: 13, weight: .bold))
        }
        .buttonStyle(.bordered)
      }
    }
  }
}

/// One set row inside an exercise group: thumbnail, SET n, values, state.
private struct SetRowView: View {
  let set: WatchSnapshot.SetItem
  let index: Int
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: 9) {
        ExerciseThumb(url: set.img, tt: set.tt, size: 34)
        VStack(alignment: .leading, spacing: 1) {
          Text("SET \(index)")
            .font(.system(size: 8, weight: .bold))
            .tracking(0.8)
            .foregroundStyle(Color.white.opacity(0.55))
          Text(set.label)
            .font(.system(.callout, design: .rounded, weight: .bold).monospacedDigit())
            .foregroundStyle(set.done ? .secondary : .primary)
            .lineLimit(1)
        }
        Spacer()
        Image(systemName: set.done ? "checkmark.circle.fill" : "chevron.right")
          .font(.system(size: set.done ? 15 : 9, weight: .bold))
          .foregroundStyle(set.done ? lime : Color.secondary)
      }
    }
    .listItemTint(set.done ? lime.opacity(0.25) : nil)
  }
}

// MARK: - Set detail (steppers)

/// Tap a set -> adjust its fields with +/- steppers, then mark done.
/// Sends deltas in display units; the phone converts back to canonical.
private struct SetDetailSheet: View {
  @EnvironmentObject private var session: WatchSessionManager
  @Environment(\.dismiss) private var dismiss
  let set: WatchSnapshot.SetItem
  let unit: String

  @State private var w: Double
  @State private var reps: Int
  @State private var dur: Int
  @State private var dist: Double
  @State private var done: Bool

  init(set: WatchSnapshot.SetItem, unit: String) {
    self.set = set
    self.unit = unit
    _w = State(initialValue: set.w ?? 0)
    _reps = State(initialValue: set.reps ?? 0)
    _dur = State(initialValue: set.dur ?? 0)
    _dist = State(initialValue: set.dist ?? 0)
    _done = State(initialValue: set.done)
  }

  private var wStep: Double { unit == "lbs" ? 5 : 2.5 }

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        // Hero: exercise photo fills the top of the sheet.
        ExerciseThumb(url: set.img, tt: set.tt, size: 96)
          .padding(.top, 4)
        Text(set.exercise)
          .font(.system(size: 11, weight: .bold))
          .tracking(0.8)
          .foregroundStyle(lime)
          .lineLimit(1)

        switch set.tt {
        case "cardio":
          stepper(label: "TIME", value: formatDur(dur), step: 15) { d in
            dur = max(0, dur + Int(d)); session.updateSet(set.id, field: "dur", delta: d)
          }
          stepper(label: unit == "lbs" ? "MILES" : "KM", value: formatDist(dist), step: 0.1) { d in
            dist = max(0, dist + d); session.updateSet(set.id, field: "dist", delta: d)
          }
        case "hold":
          stepper(label: "TIME", value: formatDur(dur), step: 15) { d in
            dur = max(0, dur + Int(d)); session.updateSet(set.id, field: "dur", delta: d)
          }
        case "carry":
          stepper(label: unit.uppercased(), value: formatW(w), step: wStep) { d in
            w = max(0, w + d); session.updateSet(set.id, field: "w", delta: d)
          }
          stepper(label: unit == "lbs" ? "MILES" : "KM", value: formatDist(dist), step: 0.05) { d in
            dist = max(0, dist + d); session.updateSet(set.id, field: "dist", delta: d)
          }
        default:
          stepper(label: unit.uppercased(), value: formatW(w), step: wStep) { d in
            w = max(0, w + d); session.updateSet(set.id, field: "w", delta: d)
          }
          stepper(label: "REPS", value: "\(reps)", step: 1) { d in
            reps = max(0, reps + Int(d)); session.updateSet(set.id, field: "reps", delta: d)
          }
        }

        Button {
          done.toggle()
          session.completeSet(set.id, done: done)
        } label: {
          HStack {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
            Text(done ? "Done" : "Mark Done")
              .font(.system(.body, design: .rounded, weight: .bold))
            Spacer()
          }
        }
        .tint(done ? .gray.opacity(0.5) : lime)
        .foregroundStyle(done ? .white : ink)
      }
      .padding(.horizontal, 2)
      .padding(.top, 28)
    }
    .overlay(alignment: .topLeading) { BackOrb() }
  }

  /// +/- stepper row. Tapping adjusts immediately and sends the delta.
  private func stepper(
    label: String,
    value: String,
    step: Double,
    apply: @escaping (Double) -> Void
  ) -> some View {
    VStack(spacing: 2) {
      Text(label)
        .font(.system(size: 9, weight: .bold))
        .tracking(1.0)
        .foregroundStyle(Color.white.opacity(0.72))
      HStack(spacing: 6) {
        Button { apply(-step) } label: {
          Text("−").font(.system(.title3, design: .rounded, weight: .bold))
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        Text(value)
          .font(.system(.title3, design: .rounded, weight: .bold).monospacedDigit())
          .frame(minWidth: 60)
        Button { apply(step) } label: {
          Text("+").font(.system(.title3, design: .rounded, weight: .bold))
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
      }
    }
  }

  private func formatW(_ v: Double) -> String {
    v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))" : String(format: "%.1f", v)
  }
  private func formatDur(_ s: Int) -> String {
    "\(s / 60):\(String(format: "%02d", s % 60))"
  }
  private func formatDist(_ d: Double) -> String {
    String(format: "%.2f", d)
  }
}

// MARK: - Exercise picker

/// App-grid style picker: circular exercise icons with names underneath,
/// like the watch home screen. Searchable via dictation/scribble.
private struct ExercisePickerSheet: View {
  @EnvironmentObject private var session: WatchSessionManager
  @Environment(\.dismiss) private var dismiss
  @State private var search = ""

  private var filtered: [WatchSnapshot.ExerciseItem] {
    let all = session.snapshot?.exercises ?? []
    let q = search.trimmingCharacters(in: .whitespaces).lowercased()
    guard !q.isEmpty else { return all }
    return all.filter {
      $0.name.lowercased().contains(q) || $0.muscle.lowercased().contains(q)
    }
  }

  private let cols = [
    GridItem(.flexible(), spacing: 4),
    GridItem(.flexible(), spacing: 4),
    GridItem(.flexible(), spacing: 4),
    GridItem(.flexible(), spacing: 4),
  ]

  var body: some View {
    NavigationStack {
      ScrollView {
        LazyVGrid(columns: cols, spacing: 12) {
          ForEach(filtered) { ex in
            NavigationLink {
              ExerciseOverviewView(ex: ex) {
                session.addExercise(ex.id)
                WKInterfaceDevice.current().play(.success)
                dismiss()
              }
              .environmentObject(session)
            } label: {
              VStack(spacing: 4) {
                ExerciseThumb(url: ex.img, tt: ex.tt, size: 44)
                Text(ex.name)
                  .font(.system(size: 8, weight: .medium))
                  .foregroundStyle(.primary)
                  .lineLimit(1)
              }
            }
            .buttonStyle(.plain)
          }
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)

        if filtered.isEmpty {
          Text(search.isEmpty ? "No exercises" : "No match for \"\(search)\"")
            .font(.footnote)
            .foregroundStyle(Color.white.opacity(0.72))
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
        }
      }
      .searchable(text: $search, prompt: "Say or type a name")
      .overlay(alignment: .topLeading) { BackOrb() }
    }
  }
}

/// Exercise overview inside the picker - like the library detail on the
/// phone: big thumb, name, muscle, tracking type, and an Add button that
/// drops it into the live workout.
private struct ExerciseOverviewView: View {
  let ex: WatchSnapshot.ExerciseItem
  let onAdd: () -> Void

  private var trackingLabel: String {
    switch ex.tt {
    case "cardio": return "Cardio · time & distance"
    case "hold": return "Hold · time"
    case "carry": return "Carry · weight & distance"
    default: return "Strength · weight & reps"
    }
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        ExerciseThumb(url: ex.img, tt: ex.tt, size: 88)
          .padding(.top, 6)
        Text(ex.name)
          .font(.system(.callout, weight: .bold))
          .multilineTextAlignment(.center)
        VStack(spacing: 2) {
          Text(ex.muscle.uppercased())
            .font(.system(size: 9, weight: .bold))
            .tracking(1)
            .foregroundStyle(lime)
          Text(trackingLabel)
            .font(.system(size: 9))
            .foregroundStyle(Color.white.opacity(0.72))
        }
        Button {
          onAdd()
        } label: {
          Text("ADD")
            .font(.system(.body, design: .rounded, weight: .bold))
            .frame(maxWidth: .infinity)
        }
        .tint(lime)
        .foregroundStyle(ink)
      }
      .padding(.horizontal, 2)
    }
  }
}

// MARK: - Pulse face (page 2)

/// Second watch face - live heart rate from the wrist on top, standalone
/// cardio logging below. Swipe right from the rings to get here.
private struct PulseView: View {
  @EnvironmentObject private var session: WatchSessionManager
  @StateObject private var hr = HeartRateManager()
  @State private var cardioActivity: String? = nil

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        ZStack {
          Circle()
            .stroke(Color.red.opacity(0.18), lineWidth: 9)
            .frame(width: 108, height: 108)
          Circle()
            .fill(RadialGradient(colors: [Color.red.opacity(0.25), .clear],
                                 center: .center, startRadius: 4, endRadius: 46))
            .frame(width: 92, height: 92)
          VStack(spacing: 0) {
            Image(systemName: "heart.fill")
              .font(.system(size: 12))
              .foregroundStyle(.red)
            Text(hr.bpm.map { "\($0)" } ?? "--")
              .font(.system(.title2, design: .rounded, weight: .bold).monospacedDigit())
            Text("BPM")
              .font(.system(size: 7, weight: .bold))
              .tracking(1)
              .foregroundStyle(Color.white.opacity(0.5))
          }
        }
        .padding(.top, 26)

        Text("CARDIO")
          .font(.system(size: 8, weight: .bold))
          .tracking(1.5)
          .foregroundStyle(Color.white.opacity(0.45))
          .frame(maxWidth: .infinity, alignment: .leading)

        CardioGrid { cardioActivity = $0 }
      }
      .padding(.horizontal, 10)
      .padding(.bottom, 24)
    }
    .scrollIndicators(.hidden)
    .onAppear { hr.start() }
    .overlay {
      if let cardioActivity {
        CardioFlowView(startActivity: cardioActivity) { self.cardioActivity = nil }
          .environmentObject(session)
          .background(Color.black.ignoresSafeArea())
          .transition(.opacity)
      }
    }
  }
}

// MARK: - Ring detail pages

/// In-place overlay opened by tapping a ring. One page per ring: hydration,
/// nutrition, activity. Each shows today's numbers, a 7-day chart, today's
/// entries, and a typed-barcode lookup where it makes sense.
private struct DetailPageView: View {
  @EnvironmentObject private var session: WatchSessionManager
  let page: String
  let onClose: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        switch page {
        case "hydration": hydrationBody
        case "nutrition": nutritionBody
        default: activityBody
        }
      }
      .padding(.horizontal, 10)
      .padding(.top, 32)
      .padding(.bottom, 16)
    }
    .overlay(alignment: .topLeading) { BackOrb(action: onClose) }
  }

  private func header(_ title: String, _ color: Color, _ value: String, _ sub: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
        .font(.system(size: 9, weight: .bold))
        .tracking(1.5)
        .foregroundStyle(color)
      Text(value)
        .font(.system(.title2, design: .rounded, weight: .bold).monospacedDigit())
      Text(sub)
        .font(.system(size: 9))
        .foregroundStyle(Color.white.opacity(0.55))
    }
  }

  private var hydrationBody: some View {
    let t = session.snapshot?.today
    let d = session.snapshot?.detail?.hydration
    return Group {
      header("HYDRATION", waterBlue, "\(t?.waterMl ?? 0) ml",
             "of \(d?.targetMl ?? t?.waterTargetMl ?? 0) ml today")

      HStack(spacing: 14) {
        quickAdd("+250") { session.logWater(ml: 250) }
        quickAdd("+500") { session.logWater(ml: 500) }
        quickAdd("+750") { session.logWater(ml: 750) }
      }

      if let week = d?.week, !week.isEmpty {
        WeekChart(week: week, color: waterBlue) { v in
          v >= 1000 ? String(format: "%.1fk", v / 1000) : "\(Int(v))"
        }
      }

      if let entries = d?.entries, !entries.isEmpty {
        Text("TODAY")
          .font(.system(size: 8, weight: .bold))
          .tracking(1)
          .foregroundStyle(Color.white.opacity(0.45))
        ForEach(Array(entries.enumerated()), id: \.offset) { _, e in
          HStack {
            Text(e.name)
              .font(.system(size: 10, weight: .medium))
              .lineLimit(1)
            Spacer()
            Text("\(e.ml) ml")
              .font(.system(size: 10, weight: .semibold).monospacedDigit())
              .foregroundStyle(waterBlue)
          }
        }
      }

      BarcodeField(kind: "drink", color: waterBlue)
    }
  }

  private var nutritionBody: some View {
    let t = session.snapshot?.today
    let d = session.snapshot?.detail?.nutrition
    return Group {
      header("NUTRITION", lime, "\(t?.kcal ?? 0) kcal",
             "of \(t?.kcalTarget ?? 0) kcal today")

      HStack(spacing: 6) {
        macroPill("P", d?.protein ?? 0)
        macroPill("C", d?.carbs ?? 0)
        macroPill("F", d?.fat ?? 0)
      }

      if let week = d?.week, !week.isEmpty {
        WeekChart(week: week, color: lime) { v in
          v >= 1000 ? String(format: "%.1fk", v / 1000) : "\(Int(v))"
        }
      }

      if let entries = d?.entries, !entries.isEmpty {
        Text("TODAY")
          .font(.system(size: 8, weight: .bold))
          .tracking(1)
          .foregroundStyle(Color.white.opacity(0.45))
        ForEach(Array(entries.enumerated()), id: \.offset) { _, e in
          HStack {
            Text(e.name)
              .font(.system(size: 10, weight: .medium))
              .lineLimit(1)
            Spacer()
            Text("\(e.kcal)")
              .font(.system(size: 10, weight: .semibold).monospacedDigit())
              .foregroundStyle(lime)
          }
        }
      }

      BarcodeField(kind: "food", color: lime)
    }
  }

  private var activityBody: some View {
    let t = session.snapshot?.today
    let a = session.snapshot?.detail?.activity
    let miles = session.snapshot?.unit == "lbs"
    return Group {
      header("ACTIVITY", stepGreen, "\(t?.steps ?? 0)",
             "of \(t?.stepsTarget ?? 10000) steps today")

      HStack(spacing: 0) {
        stat(a.map { miles ? String(format: "%.1f mi", $0.distM / 1609.344)
                          : String(format: "%.1f km", $0.distM / 1000) } ?? "-",
             "DIST")
        stat(a.map { "\($0.activeKcal)" } ?? "-", "ACTIVE")
        stat(a.map { "\($0.exerciseMin)m" } ?? "-", "EXERCISE")
      }

      if let week = a?.week, !week.isEmpty {
        WeekChart(week: week, color: stepGreen) { v in
          v >= 1000 ? String(format: "%.1fk", v / 1000) : "\(Int(v))"
        }
      }

      ForEach(session.snapshot?.stats ?? []) { s in
        HStack {
          Text(s.label)
            .font(.system(size: 10, weight: .medium))
          Spacer()
          Text(s.value)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(stepGreen)
        }
      }
    }
  }

  private func stat(_ value: String, _ label: String) -> some View {
    VStack(spacing: 1) {
      Text(value)
        .font(.system(size: 12, weight: .bold))
        .monospacedDigit()
      Text(label)
        .font(.system(size: 7, weight: .bold))
        .tracking(0.5)
        .foregroundStyle(Color.white.opacity(0.45))
    }
    .frame(maxWidth: .infinity)
  }

  private func macroPill(_ label: String, _ grams: Int) -> some View {
    Text("\(label) \(grams)g")
      .font(.system(size: 9, weight: .bold))
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(lime.opacity(0.15), in: Capsule())
      .foregroundStyle(lime)
  }

  private func quickAdd(_ label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(label)
        .font(.system(size: 10, weight: .bold))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(waterBlue.opacity(0.2), in: Capsule())
        .foregroundStyle(waterBlue)
    }
    .buttonStyle(.plain)
  }
}

/// Seven-day bar chart - today's bar full colour, the rest dimmed.
private struct WeekChart: View {
  let week: [WatchSnapshot.DayVal]
  let color: Color
  let format: (Double) -> String

  var body: some View {
    let maxV = max(1, week.map(\.v).max() ?? 1)
    VStack(alignment: .leading, spacing: 4) {
      Text("THIS WEEK")
        .font(.system(size: 8, weight: .bold))
        .tracking(1)
        .foregroundStyle(Color.white.opacity(0.45))
      HStack(alignment: .bottom, spacing: 0) {
        ForEach(Array(week.enumerated()), id: \.offset) { i, day in
          VStack(spacing: 2) {
            Text(format(day.v))
              .font(.system(size: 6))
              .foregroundStyle(Color.white.opacity(0.5))
            Capsule()
              .fill(i == week.count - 1 ? color : color.opacity(0.3))
              .frame(width: 12, height: max(4, 40 * day.v / maxV))
            Text(day.d)
              .font(.system(size: 7, weight: .bold))
              .foregroundStyle(Color.white.opacity(0.5))
          }
          .frame(maxWidth: .infinity)
        }
      }
    }
  }
}

/// Typed barcode lookup - enter digits, the phone searches OFF/Nutritionix/
/// USDA and pushes back a product card; LOG writes the entry.
private struct BarcodeField: View {
  @EnvironmentObject private var session: WatchSessionManager
  let kind: String // "drink" | "food"
  let color: Color
  @State private var code = ""
  @State private var searching = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("BARCODE")
        .font(.system(size: 8, weight: .bold))
        .tracking(1)
        .foregroundStyle(Color.white.opacity(0.45))

      HStack(spacing: 6) {
        TextField("Type digits", text: $code)
          .font(.system(size: 11, design: .rounded))
        Button {
          searching = true
          session.lookupBarcode(code, kind: kind)
        } label: {
          Image(systemName: "barcode.viewfinder")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(code.isEmpty ? Color.white.opacity(0.3) : color)
        }
        .buttonStyle(.plain)
        .disabled(code.isEmpty)
      }

      if let r = session.barcodeResult, r.kind == kind {
        if r.ok {
          VStack(alignment: .leading, spacing: 4) {
            Text(r.name ?? "Unknown")
              .font(.system(size: 11, weight: .bold))
              .lineLimit(2)
            Text([r.brand, r.serving].compactMap { $0 }.joined(separator: " · "))
              .font(.system(size: 9))
              .foregroundStyle(Color.white.opacity(0.55))
              .lineLimit(1)
            Text("\(Int(r.kcal ?? 0)) kcal · P\(Int(r.protein ?? 0)) C\(Int(r.carbs ?? 0)) F\(Int(r.fat ?? 0))")
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(color)
            HStack(spacing: 12) {
              Button {
                session.logScanned(r)
                searching = false
                code = ""
              } label: {
                Text("LOG")
                  .font(.system(size: 10, weight: .bold))
                  .foregroundStyle(ink)
                  .padding(.horizontal, 14)
                  .padding(.vertical, 6)
                  .background(color, in: Capsule())
              }
              .buttonStyle(.plain)
              Button {
                session.barcodeResult = nil
                searching = false
              } label: {
                Image(systemName: "xmark")
                  .font(.system(size: 10, weight: .bold))
                  .foregroundStyle(Color.white.opacity(0.6))
              }
              .buttonStyle(.plain)
            }
          }
          .padding(8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
        } else {
          Text("No product found for \(r.barcode)")
            .font(.system(size: 9))
            .foregroundStyle(Color.white.opacity(0.55))
        }
      } else if searching {
        HStack(spacing: 6) {
          ProgressView().scaleEffect(0.7)
          Text("Looking up…")
            .font(.system(size: 9))
            .foregroundStyle(Color.white.opacity(0.55))
        }
      }
    }
    .onChange(of: session.barcodeResult?.barcode) { _, _ in searching = false }
  }
}

#Preview {
  ContentView()
    .environmentObject(WatchSessionManager.shared)
}
