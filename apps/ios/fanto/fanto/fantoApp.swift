//
//  fantoApp.swift
//  fanto
//
//  Created by Robin on 2026/9/13.
//

import GoogleSignIn
import SwiftUI

@main
struct FantoApp: App {
    @State private var store = FantoStore()

    var body: some Scene {
        WindowGroup {
            AuthenticationGateView()
                .environment(store)
                .onOpenURL { url in
                    _ = GIDSignIn.sharedInstance.handle(url)
                }
        }
    }
}
