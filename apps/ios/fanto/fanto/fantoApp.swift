//
//  fantoApp.swift
//  fanto
//
//  Created by Robin on 2026/9/13.
//

import SwiftUI

@main
struct FantoApp: App {
    @State private var store = FantoStore()

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(store)
                .task {
                    await store.loadCreations()
                }
        }
    }
}
