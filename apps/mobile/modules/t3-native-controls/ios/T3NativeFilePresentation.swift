import ImageIO
import QuickLook
import UIKit
import UniformTypeIdentifiers

private final class FilePreviewItem: NSObject, QLPreviewItem {
  let source: URL
  let sourceIdentifier: String?
  var previewItemURL: URL?
  var previewItemTitle: String?

  init(source: URL, title: String, sourceIdentifier: String?, file: URL? = nil) {
    self.source = source
    self.sourceIdentifier = sourceIdentifier
    previewItemURL = file
    previewItemTitle = title
  }
}

private final class FilePreviewController: QLPreviewController {
  var onAppear: (() -> Void)?

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    onAppear?()
  }
}

final class T3NativeFilePresentation: NSObject, QLPreviewControllerDataSource,
  QLPreviewControllerDelegate, UIAdaptivePresentationControllerDelegate {
  let identifier: String
  private var controller: FilePreviewController?
  private let completion: (Error?) -> Void
  private weak var sources: T3PresentationSources?
  private let sourceIdentifiers: [String]
  private var items: [FilePreviewItem] = []
  private var loading: Task<Void, Never>?
  private var dismissRequested = false
  private var finished = false

  init(identifier: String, sources: T3PresentationSources, sourceIdentifiers: [String],
       completion: @escaping (Error?) -> Void) {
    self.identifier = identifier
    self.sources = sources
    self.sourceIdentifiers = sourceIdentifiers
    self.completion = completion
    super.init()
  }

  func present(url: URL, title: String, from presenter: UIViewController) {
    present(urls: [url], titles: [title], selectedIndex: 0, from: presenter)
  }

  func present(urls: [URL], titles: [String], selectedIndex: Int, from presenter: UIViewController) {
    items = urls.indices.map { index in
      FilePreviewItem(source: urls[index], title: titles[index],
                      sourceIdentifier: sourceIdentifiers.indices.contains(index) ? sourceIdentifiers[index] : nil)
    }
    loading = Task { @MainActor [self] in
      do {
        guard let selected = try await prepare(items[selectedIndex]) else { return }
        items[selectedIndex] = selected
        let preview = FilePreviewController()
        preview.delegate = self
        preview.dataSource = self
        preview.currentPreviewItemIndex = selectedIndex
        preview.onAppear = { [weak self] in self?.resumePendingDismissal() }
        controller = preview
        presenter.present(preview, animated: !UIAccessibility.isReduceMotionEnabled) { [self] in
          resumePendingDismissal()
        }
        preview.presentationController?.delegate = self
      } catch {
        finish(error: error)
        return
      }
      await prepareRemainingItems()
    }
  }

  /// Returns nil when the presentation closed while the file was being prepared.
  @MainActor private func prepare(_ item: FilePreviewItem) async throws -> FilePreviewItem? {
    let file = try await Self.prepareFile(url: item.source, title: item.previewItemTitle ?? "")
    guard !finished, !Task.isCancelled else {
      try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
      return nil
    }
    // Quick Look knows which formats it renders; refuse before presenting so the caller
    // can fall back instead of showing an "unsupported format" page.
    guard QLPreviewController.canPreview(file as NSURL) else {
      try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
      throw NSError(
        domain: "T3NativePresentation",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "This file type cannot be previewed on this device."]
      )
    }
    return FilePreviewItem(source: item.source, title: item.previewItemTitle ?? "",
                           sourceIdentifier: item.sourceIdentifier, file: file)
  }

  /// Prepares the rest of the gallery while it is open, nearest to the visible item first.
  @MainActor private func prepareRemainingItems() async {
    while !finished, let controller {
      let current = items.indices.contains(controller.currentPreviewItemIndex)
        ? controller.currentPreviewItemIndex : 0
      guard let index = items.indices.filter({ items[$0].previewItemURL == nil })
        .min(by: { abs($0 - current) < abs($1 - current) })
      else { return }
      do {
        guard let ready = try await prepare(items[index]) else { return }
        // A new item object makes Quick Look drop whatever it rendered for the placeholder.
        items[index] = ready
        controller.reloadData()
        if controller.currentPreviewItemIndex == index { controller.refreshCurrentPreviewItem() }
      } catch {
        guard !finished, !Task.isCancelled else { return }
        let visible = controller.currentPreviewItemIndex
        items.remove(at: index)
        controller.reloadData()
        // Keep the visible item on screen when an earlier one disappears.
        if visible != NSNotFound, index < visible || visible == items.count {
          controller.currentPreviewItemIndex = visible - 1
        }
      }
    }
  }

  func dismiss() {
    dismissRequested = true
    loading?.cancel()
    guard !finished else { return }
    guard let controller else { finish(); return }
    // Drain Close from viewDidAppear after opening or cancelling an interactive dismissal.
    // Starting a second modal transition while UIKit is settling the first can strand it.
    guard !controller.isBeingPresented, !controller.isBeingDismissed else { return }
    controller.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) { [self] in finish() }
  }

  private func resumePendingDismissal() {
    // Appearance callbacks run before UIKit has cleared the current transition.
    DispatchQueue.main.async { [weak self] in
      if self?.dismissRequested == true { self?.dismiss() }
    }
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { items.count }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    items[index]
  }

  private func sourceView(for item: QLPreviewItem) -> UIView? {
    guard !UIAccessibility.isReduceMotionEnabled,
      let sourceIdentifier = (item as? FilePreviewItem)?.sourceIdentifier
    else { return nil }
    return sources?.view(for: sourceIdentifier)
  }

  func previewController(_ controller: QLPreviewController, transitionViewFor item: QLPreviewItem) -> UIView? {
    sourceView(for: item)
  }

  func previewController(_ controller: QLPreviewController, frameFor item: QLPreviewItem,
                         inSourceView view: AutoreleasingUnsafeMutablePointer<UIView?>) -> CGRect {
    guard let source = sourceView(for: item) else { return .zero }
    view.pointee = source
    return source.bounds
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) { finish() }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish() }

  private func finish(error: Error? = nil) {
    guard !finished else { return }
    finished = true
    loading?.cancel()
    loading = nil
    for item in items {
      if let file = item.previewItemURL {
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
      }
    }
    items.removeAll()
    DispatchQueue.main.async { [completion] in completion(error) }
  }

  /// Copy original bytes so preview and sharing do not mutate a draft or workspace file.
  nonisolated private static func prepareFile(url: URL, title: String) async throws -> URL {
    try Task.checkCancellation()
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("t3-preview-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      let download = directory.appendingPathComponent("original")
      if url.isFileURL {
        try FileManager.default.copyItem(at: url, to: download)
      } else if url.scheme == "data" {
        try Data(contentsOf: url).write(to: download, options: .atomic)
      } else {
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
          throw URLError(.unsupportedURL)
        }
        let (temporaryFile, response) = try await URLSession.shared.download(from: url)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
          throw URLError(.badServerResponse)
        }
        try FileManager.default.moveItem(at: temporaryFile, to: download)
      }
      try Task.checkCancellation()
      // Detect images and PDFs by content; preserve other extensions so Quick Look can decide support.
      let filename = URL(fileURLWithPath: title).lastPathComponent as NSString
      let originalExtension = filename.pathExtension
      var type: UTType?
      if let image = CGImageSourceCreateWithURL(download as CFURL, nil),
        CGImageSourceGetCount(image) > 0, let imageType = CGImageSourceGetType(image),
        let detectedType = UTType(imageType as String) {
        type = detectedType
      } else if CGPDFDocument(download as CFURL) != nil {
        type = .pdf
      } else if originalExtension.lowercased() == "svg" {
        type = .svg
      }
      let fileExtension: String
      if let type {
        fileExtension = UTType(filenameExtension: originalExtension) == type
          ? originalExtension : type.preferredFilenameExtension ?? originalExtension
      } else {
        fileExtension = originalExtension
      }
      let stem = filename.deletingPathExtension
      var name = String(stem.prefix(60)).components(separatedBy: .controlCharacters).joined(separator: "_")
      while name.utf8.count > 200 { name.removeLast() }
      let baseName = name.isEmpty ? "Preview" : name
      let file = directory.appendingPathComponent(
        fileExtension.isEmpty ? baseName : "\(baseName).\(fileExtension)")
      try FileManager.default.moveItem(at: download, to: file)
      return file
    } catch {
      try? FileManager.default.removeItem(at: directory)
      throw error
    }
  }
}
