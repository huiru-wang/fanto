import Observation

@MainActor
@Observable
final class TaskDetailCache {
    private struct Key: Hashable {
        let userID: String
        let resourceID: String
    }

    private var detailsByTask: [Key: FantoTaskDetails] = [:]
    private var previewsByArtifact: [Key: FantoTaskArtifactPreview] = [:]

    func details(taskID: String, userID: String) -> FantoTaskDetails? {
        detailsByTask[Key(userID: userID, resourceID: taskID)]
    }

    func store(_ details: FantoTaskDetails, taskID: String, userID: String) {
        guard details.latestDelivery != nil else { return }
        detailsByTask[Key(userID: userID, resourceID: taskID)] = details
    }

    func preview(mediaID: String, userID: String) -> FantoTaskArtifactPreview? {
        previewsByArtifact[Key(userID: userID, resourceID: mediaID)]
    }

    func store(_ preview: FantoTaskArtifactPreview, mediaID: String, userID: String) {
        previewsByArtifact[Key(userID: userID, resourceID: mediaID)] = preview
    }

    func reset() {
        detailsByTask.removeAll()
        previewsByArtifact.removeAll()
    }
}
