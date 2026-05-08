/**
 * iOS Expo Module for LiteRT-LM on-device inference.
 *
 * Bridges the LiteRT-LM C API to JavaScript, matching the same API surface
 * as the Android Kotlin module (loadModel, generateText, generateWithImage, etc.).
 *
 * Uses the C API from engine.h (via CLiteRTLM.xcframework):
 *   - litert_lm_engine_create / litert_lm_engine_delete
 *   - litert_lm_conversation_create / litert_lm_conversation_send_message
 *   - litert_lm_session_generate_content (for image+text)
 */

import ExpoModulesCore
import Foundation
import UIKit
import CLiteRTLM

public class LiteRTLMModule: Module {
  private var engine: OpaquePointer?  // LiteRtLmEngine*
  private var loadTimeMs: Int64 = 0

  /// Strip file:// URI scheme to get a raw filesystem path
  private func toFilePath(_ uriOrPath: String) -> String {
    if uriOrPath.hasPrefix("file://") {
      return URL(string: uriOrPath)?.path ?? uriOrPath
    }
    return uriOrPath
  }

  public func definition() -> ModuleDefinition {
    Name("LiteRTLM")

    // --- Synchronous functions ---

    Function("isModelLoaded") { () -> Bool in
      return self.engine != nil
    }

    Function("unloadModel") { () in
      if let eng = self.engine {
        litert_lm_engine_delete(eng)
        self.engine = nil
        self.loadTimeMs = 0
      }
    }

    Function("getLoadTimeMs") { () -> Int64 in
      return self.loadTimeMs
    }

    // --- Async functions ---

    AsyncFunction("loadModel") { (modelPath: String, backend: String) in
      // The simulator XCFramework slice is a linking stub -- the real engine only runs on device
      #if targetEnvironment(simulator)
      throw NSError(
        domain: "LiteRTLM",
        code: 10,
        userInfo: [NSLocalizedDescriptionKey: "LiteRT-LM inference is not supported on the iOS Simulator. Please run on a physical device."]
      )
      #else
      let path = self.toFilePath(modelPath)
      let fileManager = FileManager.default

      guard fileManager.fileExists(atPath: path) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Model file not found: \(path)"]
        )
      }

      // Release previous engine if any
      if let eng = self.engine {
        litert_lm_engine_delete(eng)
        self.engine = nil
      }

      let startMs = Int64(Date().timeIntervalSince1970 * 1000)

      // Three modes: cpu=cpu/cpu/cpu, gpu=gpu/gpu/gpu, mixed=cpu/gpu/cpu (original working config)
      let textB: String
      let visionB: String
      let audioB: String

      switch backend {
      case "gpu":
        textB = "gpu"; visionB = "gpu"; audioB = "gpu"
      case "mixed":
        textB = "cpu"; visionB = "gpu"; audioB = "cpu"
      default: // "cpu"
        textB = "cpu"; visionB = "cpu"; audioB = "cpu"
      }

      NSLog("[LiteRTLM] Creating engine: text=%@, vision=%@, audio=%@", textB, visionB, audioB)

      guard let settings = litert_lm_engine_settings_create(
        path.cString(using: .utf8),
        textB.cString(using: .utf8),
        visionB.cString(using: .utf8),
        audioB.cString(using: .utf8)
      ) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Failed to create engine settings (\(textB)/\(visionB)/\(audioB)). Model may be corrupt."]
        )
      }

      litert_lm_set_min_log_level(0)

      guard let eng = litert_lm_engine_create(settings) else {
        litert_lm_engine_settings_delete(settings)
        throw NSError(
          domain: "LiteRTLM",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "Engine creation failed (\(textB)/\(visionB)/\(audioB)). Device may lack memory for this config."]
        )
      }
      litert_lm_engine_settings_delete(settings)

      let endMs = Int64(Date().timeIntervalSince1970 * 1000)
      self.loadTimeMs = endMs - startMs
      self.engine = eng
      NSLog("[LiteRTLM] Engine loaded in %lldms (%@/%@/%@)", self.loadTimeMs, textB, visionB, audioB)
      #endif
    }

    AsyncFunction("generateText") { (prompt: String) -> String in
      guard let eng = self.engine else {
        throw NSError(
          domain: "LiteRTLM",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "Model not loaded. Call loadModel() first."]
        )
      }

      // Create a conversation, send message, get response
      guard let conversation = litert_lm_conversation_create(eng, nil) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 5,
          userInfo: [NSLocalizedDescriptionKey: "Failed to create conversation"]
        )
      }
      defer { litert_lm_conversation_delete(conversation) }

      let messageJson = self.buildTextMessageJson(prompt)

      guard let response = litert_lm_conversation_send_message(
        conversation,
        messageJson.cString(using: .utf8),
        nil  // no extra context
      ) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 6,
          userInfo: [NSLocalizedDescriptionKey: "Failed to generate response"]
        )
      }
      defer { litert_lm_json_response_delete(response) }

      guard let responseStr = litert_lm_json_response_get_string(response) else {
        return ""
      }
      return String(cString: responseStr)
    }

    AsyncFunction("generateWithImage") { (prompt: String, imagePath: String) -> String in
      guard let eng = self.engine else {
        throw NSError(
          domain: "LiteRTLM",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "Model not loaded. Call loadModel() first."]
        )
      }

      let imgPath = self.toFilePath(imagePath)
      NSLog("[LiteRTLM] generateWithImage path: %@", imgPath)

      guard FileManager.default.fileExists(atPath: imgPath) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 7,
          userInfo: [NSLocalizedDescriptionKey: "Image file not found: \(imgPath)"]
        )
      }

      // Read image file into memory
      guard let imageData = FileManager.default.contents(atPath: imgPath) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 8,
          userInfo: [NSLocalizedDescriptionKey: "Failed to read image file: \(imgPath)"]
        )
      }

      // -- Diagnostic info --
      let fileSizeKB = imageData.count / 1024
      let memInfo = ProcessInfo.processInfo
      let physicalMB = memInfo.physicalMemory / (1024 * 1024)
      // Check JPEG header (FFD8FF) to validate format
      let isJPEG = imageData.count >= 3 && imageData[0] == 0xFF && imageData[1] == 0xD8 && imageData[2] == 0xFF
      let isPNG = imageData.count >= 4 && imageData[0] == 0x89 && imageData[1] == 0x50 && imageData[2] == 0x4E && imageData[3] == 0x47
      let formatStr = isJPEG ? "JPEG" : isPNG ? "PNG" : "UNKNOWN(\(String(format: "%02X%02X", imageData[0], imageData[1])))"

      // Try to get image dimensions
      var widthPx = 0, heightPx = 0
      if let uiImage = UIImage(data: imageData) {
        widthPx = Int(uiImage.size.width * uiImage.scale)
        heightPx = Int(uiImage.size.height * uiImage.scale)
      }

      NSLog("[LiteRTLM] Image: %dKB, %@, %dx%d, device RAM: %lldMB, prompt: %d chars",
            fileSizeKB, formatStr, widthPx, heightPx, physicalMB, prompt.count)

      // Use session API with InputData (raw bytes) instead of conversation JSON.
      // The C API conversation_send_message doesn't support image file paths;
      // it needs raw image bytes via litert_lm_session_generate_content.

      // Create session config with explicit max_output_tokens.
      // Passing nil config may use defaults that don't properly initialize vision buffers.
      let sessionConfig = litert_lm_session_config_create()
      if let cfg = sessionConfig {
        litert_lm_session_config_set_max_output_tokens(cfg, 512)
        NSLog("[LiteRTLM] Session config: max_output_tokens=512")
      } else {
        NSLog("[LiteRTLM] WARNING: Failed to create session config, using nil")
      }
      defer { if let cfg = sessionConfig { litert_lm_session_config_delete(cfg) } }

      guard let session = litert_lm_engine_create_session(eng, sessionConfig) else {
        NSLog("[LiteRTLM] FAILED to create session (engine may be in bad state)")
        throw NSError(
          domain: "LiteRTLM",
          code: 5,
          userInfo: [NSLocalizedDescriptionKey: "Failed to create session (engine may need reload)"]
        )
      }
      defer { litert_lm_session_delete(session) }

      // Build InputData array: [image_bytes, image_end, text]
      let promptCStr = Array(prompt.utf8CString)

      NSLog("[LiteRTLM] Calling session_generate_content: %d inputs [image(%dB), imageEnd, text(%dB)]",
            3, imageData.count, promptCStr.count - 1)

      let response: OpaquePointer? = imageData.withUnsafeBytes { rawBuf in
        promptCStr.withUnsafeBufferPointer { promptBuf in
          var inputs: [InputData] = [
            InputData(type: kInputImage, data: rawBuf.baseAddress, size: imageData.count),
            InputData(type: kInputImageEnd, data: nil, size: 0),
            InputData(type: kInputText, data: promptBuf.baseAddress, size: promptCStr.count - 1) // exclude null terminator from size
          ]
          return inputs.withUnsafeMutableBufferPointer { inputsBuf in
            litert_lm_session_generate_content(session, inputsBuf.baseAddress, 3)
          }
        }
      }

      guard let resp = response else {
        let diag = "prompt=\(prompt.count)chars, image=\(fileSizeKB)KB \(formatStr) \(widthPx)x\(heightPx), RAM=\(physicalMB)MB, path=\(imgPath.suffix(50))"
        NSLog("[LiteRTLM] session_generate_content returned nil. %@", diag)
        throw NSError(
          domain: "LiteRTLM",
          code: 6,
          userInfo: [NSLocalizedDescriptionKey: "Vision inference failed (\(diag))"]
        )
      }
      defer { litert_lm_responses_delete(resp) }

      let numCandidates = litert_lm_responses_get_num_candidates(resp)
      NSLog("[LiteRTLM] Vision response: %d candidates", numCandidates)

      guard numCandidates > 0,
            let responseStr = litert_lm_responses_get_response_text_at(resp, 0) else {
        return ""
      }
      let result = String(cString: responseStr)
      NSLog("[LiteRTLM] Vision result: %@", String(result.prefix(100)))
      return result
    }

    AsyncFunction("generateWithImages") { (prompt: String, imagePaths: [String]) -> String in
      guard let eng = self.engine else {
        throw NSError(
          domain: "LiteRTLM",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "Model not loaded. Call loadModel() first."]
        )
      }

      guard !imagePaths.isEmpty else {
        throw NSError(
          domain: "LiteRTLM",
          code: 9,
          userInfo: [NSLocalizedDescriptionKey: "No image paths provided"]
        )
      }

      // Read all image files into memory
      var imageDataArray: [Data] = []
      for rawPath in imagePaths {
        let path = self.toFilePath(rawPath)
        guard let data = FileManager.default.contents(atPath: path) else {
          throw NSError(
            domain: "LiteRTLM",
            code: 8,
            userInfo: [NSLocalizedDescriptionKey: "Failed to read image: \(path)"]
          )
        }
        imageDataArray.append(data)
      }

      guard let session = litert_lm_engine_create_session(eng, nil) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 5,
          userInfo: [NSLocalizedDescriptionKey: "Failed to create session"]
        )
      }
      defer { litert_lm_session_delete(session) }

      // Build InputData: [img, imgEnd, text]
      let promptCStr = Array(prompt.utf8CString)

      // Pin data pointers for the C call. Only first image for now (E2B is single-image).
      let response: OpaquePointer? = imageDataArray[0].withUnsafeBytes { buf0 in
        promptCStr.withUnsafeBufferPointer { promptBuf in
          var inputs: [InputData] = [
            InputData(type: kInputImage, data: buf0.baseAddress, size: imageDataArray[0].count),
            InputData(type: kInputImageEnd, data: nil, size: 0),
            InputData(type: kInputText, data: promptBuf.baseAddress, size: promptCStr.count - 1)
          ]
          let count = inputs.count
          return inputs.withUnsafeMutableBufferPointer { inputsBuf in
            litert_lm_session_generate_content(session, inputsBuf.baseAddress, count)
          }
        }
      }

      guard let resp = response else {
        throw NSError(
          domain: "LiteRTLM",
          code: 6,
          userInfo: [NSLocalizedDescriptionKey: "Vision inference failed for multi-image"]
        )
      }
      defer { litert_lm_responses_delete(resp) }

      let numCandidates = litert_lm_responses_get_num_candidates(resp)
      guard numCandidates > 0,
            let responseStr = litert_lm_responses_get_response_text_at(resp, 0) else {
        return ""
      }
      return String(cString: responseStr)
    }

    AsyncFunction("generateWithAudio") { (prompt: String, audioPath: String) -> String in
      guard let eng = self.engine else {
        throw NSError(
          domain: "LiteRTLM",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "Model not loaded. Call loadModel() first."]
        )
      }

      let audPath = self.toFilePath(audioPath)
      guard FileManager.default.fileExists(atPath: audPath) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 11,
          userInfo: [NSLocalizedDescriptionKey: "Audio file not found: \(audPath)"]
        )
      }

      guard let audioData = FileManager.default.contents(atPath: audPath) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 8,
          userInfo: [NSLocalizedDescriptionKey: "Failed to read audio file: \(audPath)"]
        )
      }
      NSLog("[LiteRTLM] Audio loaded: %d bytes", audioData.count)

      guard let session = litert_lm_engine_create_session(eng, nil) else {
        throw NSError(
          domain: "LiteRTLM",
          code: 5,
          userInfo: [NSLocalizedDescriptionKey: "Failed to create session"]
        )
      }
      defer { litert_lm_session_delete(session) }

      let promptCStr = Array(prompt.utf8CString)

      let response: OpaquePointer? = audioData.withUnsafeBytes { rawBuf in
        promptCStr.withUnsafeBufferPointer { promptBuf in
          var inputs: [InputData] = [
            InputData(type: kInputAudio, data: rawBuf.baseAddress, size: audioData.count),
            InputData(type: kInputAudioEnd, data: nil, size: 0),
            InputData(type: kInputText, data: promptBuf.baseAddress, size: promptCStr.count - 1)
          ]
          return inputs.withUnsafeMutableBufferPointer { inputsBuf in
            litert_lm_session_generate_content(session, inputsBuf.baseAddress, 3)
          }
        }
      }

      guard let resp = response else {
        throw NSError(
          domain: "LiteRTLM",
          code: 6,
          userInfo: [NSLocalizedDescriptionKey: "Audio inference failed (audio: \(audioData.count) bytes)"]
        )
      }
      defer { litert_lm_responses_delete(resp) }

      let numCandidates = litert_lm_responses_get_num_candidates(resp)
      guard numCandidates > 0,
            let responseStr = litert_lm_responses_get_response_text_at(resp, 0) else {
        return ""
      }
      return String(cString: responseStr)
    }
  }

  // MARK: - JSON message builders

  /// Escape text for JSON string embedding
  private func escapeJson(_ text: String) -> String {
    return text
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\r", with: "\\r")
      .replacingOccurrences(of: "\t", with: "\\t")
  }

  /// Build text-only message JSON for the conversation API
  private func buildTextMessageJson(_ text: String) -> String {
    let escaped = escapeJson(text)
    return "{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"\(escaped)\"}]}"
  }

  /// Build vision message JSON with a single image path
  private func buildVisionMessageJson(_ text: String, imagePath: String) -> String {
    let escaped = escapeJson(text)
    let escapedPath = escapeJson(imagePath)
    return "{\"role\":\"user\",\"content\":[{\"type\":\"image\",\"image\":\"\(escapedPath)\"},{\"type\":\"text\",\"text\":\"\(escaped)\"}]}"
  }

  /// Build vision message JSON with multiple image paths
  private func buildMultiImageMessageJson(_ text: String, imagePaths: [String]) -> String {
    let escaped = escapeJson(text)
    var content: [String] = imagePaths.map { path in
      let escapedPath = escapeJson(path)
      return "{\"type\":\"image\",\"image\":\"\(escapedPath)\"}"
    }
    content.append("{\"type\":\"text\",\"text\":\"\(escaped)\"}")
    return "{\"role\":\"user\",\"content\":[\(content.joined(separator: ","))]}"
  }

  /// Build audio message JSON for the conversation API
  private func buildAudioMessageJson(_ text: String, audioPath: String) -> String {
    let escaped = escapeJson(text)
    let escapedPath = escapeJson(audioPath)
    return "{\"role\":\"user\",\"content\":[{\"type\":\"audio\",\"audio\":\"\(escapedPath)\"},{\"type\":\"text\",\"text\":\"\(escaped)\"}]}"
  }
}
