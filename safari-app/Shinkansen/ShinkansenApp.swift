// Shinkansen for macOS Safari host App entry point
// 編譯成 macOS App,負責顯示一個說明視窗 + 一鍵打開 Safari 擴充功能設定

import SwiftUI

@main
struct ShinkansenApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 480, idealWidth: 520, minHeight: 540, idealHeight: 580)
        }
        .windowResizability(.contentSize)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}

// 單視窗 App:關閉主視窗即結束 App,符合 Apple Guideline 4 (Design) 對單視窗 App 的指引
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
