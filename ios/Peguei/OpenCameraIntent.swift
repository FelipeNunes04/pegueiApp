import AppIntents

/// System-level entry point for opening Peguei straight to the camera
/// screen -- exposed to Siri, Spotlight and the Shortcuts app via
/// `PegueiShortcuts` below. The intent itself does no recording: it just
/// foregrounds the app; recording happens via the manual record button.
@available(iOS 16.0, *)
struct OpenCameraIntent: AppIntent {
    static var title: LocalizedStringResource = "Abrir Peguei"
    static var description = IntentDescription("Abre o Peguei na tela da câmera, pronta para gravar.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        return .result()
    }
}

@available(iOS 16.0, *)
struct PegueiShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenCameraIntent(),
            phrases: [
                "Abrir \(.applicationName)",
                "\(.applicationName) peguei",
            ],
            shortTitle: "Abrir Peguei",
            systemImageName: "camera.fill"
        )
    }
}
