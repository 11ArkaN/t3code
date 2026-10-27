import AVFoundation
import Foundation
import Speech
import UIKit

@MainActor
enum FeatureVoiceInputAdapterFactory {
    static func make() -> any FeatureVoiceInputAdapter {
        if #available(iOS 26.0, *) {
            return AppleVoiceInputAdapter()
        }
        return UnsupportedVoiceInputAdapter()
    }
}

@MainActor
private final class UnsupportedVoiceInputAdapter: FeatureVoiceInputAdapter {
    let isSupported = false
    let localeIdentifier = Locale.current.identifier

    func prepare() async throws {}
    func requestMicrophonePermission() async -> FeatureVoiceMicrophonePermission { .denied }
    func startRecording(maximumDuration: TimeInterval) async throws {}
    func stopRecording() async throws -> URL { throw AppleVoiceInputError.unavailable }
    func transcribe(recordingURL: URL) async throws -> String {
        throw AppleVoiceInputError.unavailable
    }
    func cancelTranscription() async {}
    func cleanup() async {}
}

private enum AppleVoiceInputError: Error {
    case unavailable
    case unsupportedLocale
    case recordingFailed
}

private struct AppleVoiceAudioSessionConfiguration {
    let category: AVAudioSession.Category
    let mode: AVAudioSession.Mode
    let options: AVAudioSession.CategoryOptions
    let preferredInput: AVAudioSessionPortDescription?
}

/// Owns the shared audio session and the recorder off the main thread.
/// Session activation, route selection, and recorder setup wait on the audio
/// server. That can take seconds, for example while a Bluetooth headset switches
/// to its microphone profile, and it froze the app when it ran on the main actor.
@available(iOS 26.0, *)
private actor AppleVoiceRecorder {
    private let audioSession = AVAudioSession.sharedInstance()
    private var recorder: AVAudioRecorder?
    private var previousConfiguration: AppleVoiceAudioSessionConfiguration?
    private var preferredInputWasTouched = false

    /// Starts recording to `url` and returns the connected microphones so the
    /// caller can remember them.
    func start(
        url: URL,
        maximumDuration: TimeInterval,
        microphoneOrder: [FeatureMicrophoneEntry]
    ) throws -> [FeatureMicrophoneInput] {
        stop()
        let previous = AppleVoiceAudioSessionConfiguration(
            category: audioSession.category,
            mode: audioSession.mode,
            options: audioSession.categoryOptions,
            preferredInput: audioSession.preferredInput
        )
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: [.allowBluetoothHFP])
            previousConfiguration = previous
            try audioSession.setActive(true)
            let inputs = selectPreferredMicrophone(order: microphoneOrder)
            let recorder = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ])
            guard recorder.prepareToRecord(), recorder.record(forDuration: maximumDuration) else {
                throw AppleVoiceInputError.recordingFailed
            }
            self.recorder = recorder
            return inputs
        } catch {
            stop()
            throw error
        }
    }

    /// Stops any recording and restores the session the app had before.
    func stop() {
        recorder?.stop()
        recorder = nil
        guard let previousConfiguration else { return }
        if preferredInputWasTouched {
            try? audioSession.setPreferredInput(previousConfiguration.preferredInput)
            preferredInputWasTouched = false
        }
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
        try? audioSession.setCategory(
            previousConfiguration.category,
            mode: previousConfiguration.mode,
            options: previousConfiguration.options
        )
        self.previousConfiguration = nil
    }

    private func selectPreferredMicrophone(
        order: [FeatureMicrophoneEntry]
    ) -> [FeatureMicrophoneInput] {
        // iOS only exposes connected inputs after the recording session is configured.
        let ports = audioSession.availableInputs ?? []
        let inputs = ports.map {
            FeatureMicrophoneInput(uid: $0.uid, name: $0.portName, portType: $0.portType.rawValue)
        }
        let order = FeatureMicrophonePriority.order(
            FeatureMicrophonePriority.remembering(inputs, in: order)
        )
        guard let preferred = FeatureMicrophonePriority.preferredInput(inputs, order: order),
              let port = ports.first(where: { $0.uid == preferred.uid }),
              port.uid != audioSession.preferredInput?.uid else { return inputs }
        preferredInputWasTouched = true
        // A route can disappear between enumeration and selection. Keep the iOS route in that case.
        try? audioSession.setPreferredInput(port)
        return inputs
    }
}

@available(iOS 26.0, *)
@MainActor
private final class AppleVoiceInputAdapter: FeatureVoiceInputAdapter {
    private let recorder = AppleVoiceRecorder()
    private let fileManager = FileManager.default
    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var recordingURL: URL?
    private var ownedRecordingURLs = Set<URL>()
    private var previousIdleTimerDisabled: Bool?

    var isSupported: Bool { SpeechTranscriber.isAvailable }
    private(set) var localeIdentifier = Locale.current.identifier

    func prepare() async throws {
        guard SpeechTranscriber.isAvailable else { throw AppleVoiceInputError.unavailable }
        guard let locale = await SpeechTranscriber.supportedLocale(
            equivalentTo: Locale.current
        ) else {
            throw AppleVoiceInputError.unsupportedLocale
        }

        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        if let request = try await AssetInventory.assetInstallationRequest(
            supporting: [transcriber]
        ) {
            try await request.downloadAndInstall()
        }
        self.transcriber = transcriber
        localeIdentifier = locale.identifier
    }

    func requestMicrophonePermission() async -> FeatureVoiceMicrophonePermission {
        await AVAudioApplication.requestRecordPermission() ? .granted : .denied
    }

    func startRecording(maximumDuration: TimeInterval) async throws {
        let url = fileManager.temporaryDirectory
            .appendingPathComponent("t3-voice-\(UUID().uuidString)")
            .appendingPathExtension("m4a")
        ownedRecordingURLs.insert(url)
        recordingURL = url

        let preferences = FeatureMicrophonePreferences.shared
        let inputs = try await recorder.start(
            url: url,
            maximumDuration: maximumDuration,
            microphoneOrder: preferences.entries
        )
        preferences.remember(inputs)
        if previousIdleTimerDisabled == nil {
            previousIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
        }
        UIApplication.shared.isIdleTimerDisabled = true
    }

    func stopRecording() async throws -> URL {
        guard let recordingURL else { throw AppleVoiceInputError.recordingFailed }
        await stopAudio()
        return recordingURL
    }

    func transcribe(recordingURL: URL) async throws -> String {
        guard let transcriber else { throw AppleVoiceInputError.unavailable }
        let audioFile = try AVAudioFile(forReading: recordingURL)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer

        let collector = Task { () throws -> [String] in
            var segments: [String] = []
            for try await result in transcriber.results where result.isFinal {
                segments.append(String(result.text.characters))
            }
            return segments
        }

        do {
            try await analyzer.start(inputAudioFile: audioFile, finishAfterFile: true)
            let segments = try await collector.value
            if self.analyzer === analyzer { self.analyzer = nil }
            return segments.joined(separator: " ").trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        } catch {
            collector.cancel()
            await analyzer.cancelAndFinishNow()
            _ = try? await collector.value
            if self.analyzer === analyzer { self.analyzer = nil }
            throw error
        }
    }

    func cancelTranscription() async {
        await analyzer?.cancelAndFinishNow()
    }

    func cleanup() async {
        await stopAudio()
        if let analyzer {
            await analyzer.cancelAndFinishNow()
            self.analyzer = nil
        }
        for url in ownedRecordingURLs {
            try? fileManager.removeItem(at: url)
        }
        ownedRecordingURLs.removeAll()
        recordingURL = nil
        transcriber = nil
    }

    private func stopAudio() async {
        await recorder.stop()
        if let previousIdleTimerDisabled {
            UIApplication.shared.isIdleTimerDisabled = previousIdleTimerDisabled
            self.previousIdleTimerDisabled = nil
        }
    }
}
