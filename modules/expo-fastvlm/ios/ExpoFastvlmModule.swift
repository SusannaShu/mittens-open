import ExpoModulesCore

public class ExpoFastvlmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoFastvlm")

    AsyncFunction("analyzeImage") { (imagePath: String, prompt: String, promise: Promise) in
      // Placeholder for FastVLM CoreML integration
      print("analyzeImage called with prompt: \(prompt)")
      promise.resolve("This is a placeholder response from the ExpoFastvlm native module. CoreML inference not yet implemented.")
    }
  }
}
