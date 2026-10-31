import SwiftUI
import WatchConnectivity

@main
struct FitVoidWatchApp: App {
  @StateObject private var session = WatchSessionManager.shared

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(session)
    }
  }
}
