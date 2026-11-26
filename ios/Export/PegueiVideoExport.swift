import AVFoundation
import Foundation
import React
import UIKit

/// Exports a saved clip with the sponsor watermark and the species/weight
/// caption burned in, optionally center-cropped to 9:16. Runs entirely on
/// AVFoundation's own export queue; nothing here touches the capture
/// session or the circular buffer (the camera screen isn't on screen while
/// exporting).
@objc(PegueiVideoExport)
final class PegueiVideoExport: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    private var activeSession: AVAssetExportSession?

    @objc(exportVideo:resolver:rejecter:)
    func exportVideo(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard
            let inputPath = options["inputPath"] as? String,
            let outputPath = options["outputPath"] as? String
        else {
            reject("E_EXPORT_ARGS", "Parâmetros de exportação inválidos.", nil)
            return
        }
        let portrait = options["portrait9x16"] as? Bool ?? true
        let watermark = options["watermark"] as? NSDictionary
        let caption = options["caption"] as? NSDictionary

        Task.detached(priority: .userInitiated) { [weak self] in
            do {
                let result = try await self?.run(
                    input: URL(fileURLWithPath: Self.stripScheme(inputPath)),
                    output: URL(fileURLWithPath: Self.stripScheme(outputPath)),
                    portrait: portrait,
                    watermark: watermark,
                    caption: caption
                )
                if let result {
                    if let watermark, let sponsorId = watermark["sponsorId"] as? String, !sponsorId.isEmpty {
                        PegueiAnalytics.track("sponsor_impression", props: [
                            "sponsor_id": sponsorId,
                            "posicao": watermark["position"] as? String ?? "bottom_right",
                        ])
                    }
                    resolve(result)
                }
            } catch let error as ExportError {
                reject(error.code, error.message, nil)
            } catch {
                reject("E_EXPORT_FAILED", error.localizedDescription, error)
            }
        }
    }

    private struct ExportError: Error {
        let code: String
        let message: String
    }

    private static func stripScheme(_ path: String) -> String {
        path.hasPrefix("file://") ? String(path.dropFirst(7)) : path
    }

    private func run(input: URL, output: URL, portrait: Bool, watermark: NSDictionary?, caption: NSDictionary?) async throws -> [String: Any] {
        let asset = AVURLAsset(url: input)
        guard let sourceVideo = try await asset.loadTracks(withMediaType: .video).first else {
            throw ExportError(code: "E_EXPORT_NO_VIDEO", message: "O vídeo não tem imagem para exportar.")
        }
        let duration = try await asset.load(.duration)
        let naturalSize = try await sourceVideo.load(.naturalSize)
        let preferredTransform = try await sourceVideo.load(.preferredTransform)
        let nominalFrameRate = try await sourceVideo.load(.nominalFrameRate)
        let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first

        let composition = AVMutableComposition()
        let range = CMTimeRange(start: .zero, duration: duration)
        guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw ExportError(code: "E_EXPORT_FAILED", message: "Não foi possível preparar a exportação.")
        }
        try videoTrack.insertTimeRange(range, of: sourceVideo, at: .zero)
        if let sourceAudio, let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try? audioTrack.insertTimeRange(range, of: sourceAudio, at: .zero)
        }

        // Size as displayed (the encoder tags portrait clips with a 90° transform).
        let displayRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
        let displaySize = CGSize(width: abs(displayRect.width), height: abs(displayRect.height))
        let renderSize = portrait ? Self.crop9x16(displaySize) : Self.even(displaySize)
        let dx = (displaySize.width - renderSize.width) / 2
        let dy = (displaySize.height - renderSize.height) / 2

        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
        // preferredTransform may carry a translation of its own (it maps into
        // displayRect), so normalise to the origin before centering the crop.
        let toOrigin = CGAffineTransform(translationX: -displayRect.minX, y: -displayRect.minY)
        let transform = preferredTransform.concatenating(toOrigin).concatenating(CGAffineTransform(translationX: -dx, y: -dy))
        layerInstruction.setTransform(transform, at: .zero)

        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = range
        instruction.layerInstructions = [layerInstruction]

        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        let fps = nominalFrameRate > 0 ? nominalFrameRate : 30
        videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps.rounded()))
        videoComposition.instructions = [instruction]

        let overlays = Self.overlayLayers(renderSize: renderSize, watermark: watermark, caption: caption)
        if !overlays.isEmpty {
            let parent = CALayer()
            parent.frame = CGRect(origin: .zero, size: renderSize)
            // Top-left origin, like UIKit, for the overlay math below.
            parent.isGeometryFlipped = true
            let videoLayer = CALayer()
            videoLayer.frame = parent.frame
            parent.addSublayer(videoLayer)
            overlays.forEach { parent.addSublayer($0) }
            videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)
        }

        try? FileManager.default.removeItem(at: output)
        try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)

        guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            throw ExportError(code: "E_EXPORT_FAILED", message: "Não foi possível preparar a exportação.")
        }
        session.outputURL = output
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        session.videoComposition = videoComposition
        activeSession = session

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { continuation.resume() }
        }
        activeSession = nil

        guard session.status == .completed else {
            try? FileManager.default.removeItem(at: output)
            throw ExportError(code: "E_EXPORT_FAILED", message: session.error?.localizedDescription ?? "A exportação falhou.")
        }
        return [
            "path": output.path,
            "width": Int(renderSize.width),
            "height": Int(renderSize.height),
            "durationSeconds": CMTimeGetSeconds(duration),
        ]
    }

    /// Largest centered 9:16 rectangle inside `size`, with even sides (H.264).
    private static func crop9x16(_ size: CGSize) -> CGSize {
        let target: CGFloat = 9.0 / 16.0
        if size.width / size.height > target {
            return even(CGSize(width: size.height * target, height: size.height))
        }
        return even(CGSize(width: size.width, height: size.width / target))
    }

    private static func even(_ size: CGSize) -> CGSize {
        CGSize(width: floor(size.width / 2) * 2, height: floor(size.height / 2) * 2)
    }

    private static func overlayLayers(renderSize: CGSize, watermark: NSDictionary?, caption: NSDictionary?) -> [CALayer] {
        var layers: [CALayer] = []
        let margin = renderSize.width * 0.04

        if let watermark,
           let path = watermark["imagePath"] as? String,
           let image = UIImage(contentsOfFile: stripScheme(path))?.cgImage {
            let width = renderSize.width * 0.22
            let height = width * CGFloat(image.height) / CGFloat(max(image.width, 1))
            let position = watermark["position"] as? String ?? "bottom_right"
            let x = position.hasSuffix("left") ? margin : renderSize.width - width - margin
            let y = position.hasPrefix("top") ? margin : renderSize.height - height - margin
            let layer = CALayer()
            layer.contents = image
            layer.contentsGravity = .resizeAspect
            layer.frame = CGRect(x: x, y: y, width: width, height: height)
            layer.opacity = 0.9
            layers.append(layer)
        }

        if let caption, let image = captionImage(renderWidth: renderSize.width, caption: caption) {
            let layer = CALayer()
            layer.contents = image.cgImage
            // Bottom-left, above the bottom edge; a bottom watermark sits on the right.
            layer.frame = CGRect(
                x: margin,
                y: renderSize.height - image.size.height - margin * 3,
                width: image.size.width,
                height: image.size.height
            )
            layers.append(layer)
        }
        return layers
    }

    /// The caption card: species, optional weight, optional sponsor logo slot on the right.
    private static func captionImage(renderWidth: CGFloat, caption: NSDictionary) -> UIImage? {
        let species = (caption["species"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let weight = (caption["weight"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        guard !species.isEmpty || !weight.isEmpty else { return nil }
        let logo = (caption["logoPath"] as? String).flatMap { UIImage(contentsOfFile: stripScheme($0)) }

        let scale = renderWidth / 1080
        let padding = 28 * scale
        let titleFont = UIFont.systemFont(ofSize: 54 * scale, weight: .bold)
        let subtitleFont = UIFont.systemFont(ofSize: 40 * scale, weight: .semibold)
        let title = NSAttributedString(string: species, attributes: [.font: titleFont, .foregroundColor: UIColor.white])
        let subtitle = NSAttributedString(string: weight, attributes: [.font: subtitleFont, .foregroundColor: UIColor(red: 0.96, green: 0.65, blue: 0.14, alpha: 1)])
        let textWidth = max(title.size().width, subtitle.size().width)
        let textHeight = title.size().height + (weight.isEmpty || species.isEmpty ? 0 : subtitle.size().height)
        let logoSide = logo == nil ? 0 : textHeight
        let gap = logo == nil ? 0 : padding
        let maxWidth = renderWidth * 0.92
        let size = CGSize(width: min(textWidth + logoSide + gap + padding * 2, maxWidth), height: textHeight + padding * 2)

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            let card = UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 24 * scale)
            UIColor(white: 0, alpha: 0.55).setFill()
            card.fill()
            var y = padding
            let textArea = size.width - padding * 2 - logoSide - gap
            if !species.isEmpty {
                title.draw(with: CGRect(x: padding, y: y, width: textArea, height: title.size().height), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
                y += title.size().height
            }
            if !weight.isEmpty {
                subtitle.draw(with: CGRect(x: padding, y: y, width: textArea, height: subtitle.size().height), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
            }
            if let logo {
                let slot = CGRect(x: size.width - padding - logoSide, y: padding, width: logoSide, height: logoSide)
                logo.draw(in: aspectFit(logo.size, in: slot))
            }
        }
    }

    private static func aspectFit(_ size: CGSize, in rect: CGRect) -> CGRect {
        let ratio = min(rect.width / max(size.width, 1), rect.height / max(size.height, 1))
        let fitted = CGSize(width: size.width * ratio, height: size.height * ratio)
        return CGRect(x: rect.midX - fitted.width / 2, y: rect.midY - fitted.height / 2, width: fitted.width, height: fitted.height)
    }
}
