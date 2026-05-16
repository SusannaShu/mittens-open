/**
 * ExpoFaceRecognitionModule.swift
 *
 * On-device face detection and embedding extraction.
 *
 * Pipeline:
 *   1. Apple Vision VNDetectFaceRectanglesRequest -> face bounding box
 *   2. Crop + resize to 112x112 RGB
 *   3. Run through MobileFaceNet CoreML model -> 128-dim embedding
 *
 * If no CoreML model is bundled, falls back to Apple Vision's own
 * VNGenerateFaceEmbeddingRequest (available on newer OS versions)
 * which produces a 2048-dim embedding. The TypeScript layer handles
 * both dimensionalities transparently.
 *
 * All processing is on-device. No images or embeddings leave the phone.
 */

import ExpoModulesCore
import Foundation
import UIKit
@preconcurrency import Vision
@preconcurrency import CoreML
import CoreImage

public class ExpoFaceRecognitionModule: Module {

  /// Loaded CoreML model (nil if no model bundled)
  private var faceNetModel: VNCoreMLModel?
  private var modelLoaded = false

  /// Strip file:// URI scheme to get a raw filesystem path
  private func toFilePath(_ uriOrPath: String) -> String {
    if uriOrPath.hasPrefix("file://") {
      return URL(string: uriOrPath)?.path ?? uriOrPath
    }
    return uriOrPath
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoFaceRecognition")

    // ─── Check if faces can be detected ───
    Function("isAvailable") { () -> Bool in
      return true // Vision framework is always available on iOS 15+
    }

    // ─── Load a CoreML face embedding model from disk ───
    AsyncFunction("loadModel") { (modelPath: String) in
      let path = self.toFilePath(modelPath)

      guard FileManager.default.fileExists(atPath: path) else {
        throw NSError(
          domain: "ExpoFaceRecognition",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Model not found: \(path)"]
        )
      }

      let modelUrl = URL(fileURLWithPath: path)

      // CoreML compiled model (.mlmodelc) or source (.mlmodel)
      let compiledUrl: URL
      if path.hasSuffix(".mlmodelc") {
        compiledUrl = modelUrl
      } else {
        // Compile on first load
        compiledUrl = try MLModel.compileModel(at: modelUrl)
      }

      let mlModel = try MLModel(contentsOf: compiledUrl)
      self.faceNetModel = try VNCoreMLModel(for: mlModel)
      self.modelLoaded = true
      NSLog("[FaceRecognition] CoreML model loaded from: %@", path)
    }

    Function("isModelLoaded") { () -> Bool in
      return self.modelLoaded
    }

    // ─── Detect faces and extract embeddings from an image ───
    AsyncFunction("detectFaces") { (imagePath: String) -> [[String: Any]] in
      let path = self.toFilePath(imagePath)

      guard let imageData = FileManager.default.contents(atPath: path),
            let uiImage = UIImage(data: imageData),
            let cgImage = uiImage.cgImage else {
        throw NSError(
          domain: "ExpoFaceRecognition",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Failed to read image: \(path)"]
        )
      }

      // Step 1: Detect face bounding boxes
      let faceBoxes = try await self.detectFaceBoundingBoxes(cgImage: cgImage)

      if faceBoxes.isEmpty {
        return []
      }

      // Step 2: For each face, crop and extract embedding
      var results: [[String: Any]] = []

      for observation in faceBoxes {
        let bbox = observation.boundingBox
        let imgW = CGFloat(cgImage.width)
        let imgH = CGFloat(cgImage.height)

        // Vision coordinates: origin at bottom-left, normalized 0..1
        let rect = CGRect(
          x: bbox.minX * imgW,
          y: (1.0 - bbox.maxY) * imgH,
          width: bbox.width * imgW,
          height: bbox.height * imgH
        )

        // Add margin around the face (20%)
        let margin = max(rect.width, rect.height) * 0.2
        let expandedRect = CGRect(
          x: max(0, rect.minX - margin),
          y: max(0, rect.minY - margin),
          width: min(imgW - max(0, rect.minX - margin), rect.width + margin * 2),
          height: min(imgH - max(0, rect.minY - margin), rect.height + margin * 2)
        )

        guard let croppedCG = cgImage.cropping(to: expandedRect) else { continue }

        // Strict CoreML extraction only, or fallback to Vision Feature Print
        var embedding: [Float]? = nil
        if let model = self.faceNetModel {
          embedding = try? await self.extractEmbeddingCoreML(
            faceCG: croppedCG,
            model: model
          )
        } else {
          // Fall back to Apple Vision's native image feature print
          embedding = try? await self.extractEmbeddingVision(faceCG: croppedCG)
        }

        if embedding == nil || embedding!.isEmpty {
          NSLog("[FaceRecognition] Failed to extract embedding for face")
          continue
        }

        let emb = embedding!

        let faceResult: [String: Any] = [
          "embedding": emb,
          "boundingBox": [
            "x": Double(bbox.minX),
            "y": Double(bbox.minY),
            "width": Double(bbox.width),
            "height": Double(bbox.height),
          ],
          "confidence": Double(observation.confidence),
        ]
        results.append(faceResult)
      }

      NSLog("[FaceRecognition] Detected %d faces with embeddings", results.count)
      return results
    }

    // ─── Simple face count (fast, no embeddings) ───
    AsyncFunction("countFaces") { (imagePath: String) -> Int in
      let path = self.toFilePath(imagePath)

      guard let imageData = FileManager.default.contents(atPath: path),
            let uiImage = UIImage(data: imageData),
            let cgImage = uiImage.cgImage else {
        return 0
      }

      let boxes = try await self.detectFaceBoundingBoxes(cgImage: cgImage)
      return boxes.count
    }

    // ─── Unload model to free memory ───
    Function("unloadModel") { () in
      self.faceNetModel = nil
      self.modelLoaded = false
      NSLog("[FaceRecognition] Model unloaded")
    }
  }

  // ═══════════════════════════════════════
  // MARK: - Face Detection (Apple Vision)
  // ═══════════════════════════════════════

  private func detectFaceBoundingBoxes(
    cgImage: CGImage
  ) async throws -> [VNFaceObservation] {
    return try await withCheckedThrowingContinuation { continuation in
      let request = VNDetectFaceRectanglesRequest { request, error in
        if let error = error {
          continuation.resume(throwing: error)
          return
        }
        let observations = request.results as? [VNFaceObservation] ?? []
        continuation.resume(returning: observations)
      }

      let handler = VNImageRequestHandler(
        cgImage: cgImage,
        orientation: .up,
        options: [:]
      )

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  // ═══════════════════════════════════════
  // MARK: - Embedding Extraction (CoreML)
  // ═══════════════════════════════════════

  private func extractEmbeddingCoreML(
    faceCG: CGImage,
    model: VNCoreMLModel
  ) async throws -> [Float] {
    // Resize to 112x112 for MobileFaceNet input
    guard let resized = self.resizeCGImage(faceCG, to: CGSize(width: 112, height: 112)) else {
      throw NSError(
        domain: "ExpoFaceRecognition",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Failed to resize face crop"]
      )
    }

    return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[Float], Error>) in
      let request = VNCoreMLRequest(model: model) { request, error in
        if let error = error {
          continuation.resume(throwing: error)
          return
        }

        // Extract the output feature vector
        guard let results = request.results as? [VNCoreMLFeatureValueObservation],
              let firstResult = results.first,
              let multiArray = firstResult.featureValue.multiArrayValue else {
          continuation.resume(returning: [])
          return
        }

        // Convert MLMultiArray to [Float]
        let count = multiArray.count
        var embedding = [Float](repeating: 0, count: count)
        let ptr = multiArray.dataPointer.bindMemory(to: Float.self, capacity: count)
        for i in 0..<count {
          embedding[i] = ptr[i]
        }

        // L2 normalize the embedding
        let norm = sqrt(embedding.reduce(0) { $0 + $1 * $1 })
        if norm > 0 {
          embedding = embedding.map { $0 / norm }
        }

        continuation.resume(returning: embedding)
      }

      request.imageCropAndScaleOption = .scaleFill

      let handler = VNImageRequestHandler(cgImage: resized, options: [:])
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  // ═══════════════════════════════════════
  // MARK: - Embedding Extraction (Apple Vision Fallback)
  // ═══════════════════════════════════════

  private func extractEmbeddingVision(
    faceCG: CGImage
  ) async throws -> [Float] {
    return try await withCheckedThrowingContinuation { continuation in
      let request = VNGenerateImageFeaturePrintRequest { request, error in
        if let error = error {
          continuation.resume(throwing: error)
          return
        }
        guard let result = request.results?.first as? VNFeaturePrintObservation else {
          continuation.resume(returning: [])
          return
        }
        
        let count = result.elementCount
        var embedding = [Float](repeating: 0, count: count)
        result.data.withUnsafeBytes { rawBuffer in
            if let ptr = rawBuffer.bindMemory(to: Float.self).baseAddress {
                for i in 0..<count {
                    embedding[i] = ptr[i]
                }
            }
        }
        
        // L2 normalize the embedding
        let norm = sqrt(embedding.reduce(0) { $0 + $1 * $1 })
        if norm > 0 {
          embedding = embedding.map { $0 / norm }
        }
        
        continuation.resume(returning: embedding)
      }
      
      let handler = VNImageRequestHandler(cgImage: faceCG, options: [:])
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  // ═══════════════════════════════════════
  // MARK: - Image Utilities
  // ═══════════════════════════════════════

  private func resizeCGImage(_ image: CGImage, to size: CGSize) -> CGImage? {
    let colorSpace = image.colorSpace ?? CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
      data: nil,
      width: Int(size.width),
      height: Int(size.height),
      bitsPerComponent: 8,
      bytesPerRow: Int(size.width) * 4,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    context.interpolationQuality = .high
    context.draw(image, in: CGRect(origin: .zero, size: size))
    return context.makeImage()
  }
}
