package expo.modules.litertlm

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Message
import java.io.File
import android.net.Uri

class LiteRTLMModule : Module() {
  private var engine: Engine? = null
  private var loadTimeMs: Long = 0

  /** Strip file:// URI scheme to get a raw filesystem path for java.io.File */
  private fun toFilePath(uriOrPath: String): String {
    if (uriOrPath.startsWith("file://")) {
      return Uri.parse(uriOrPath).path ?: uriOrPath
    }
    return uriOrPath
  }

  override fun definition() = ModuleDefinition {
    Name("LiteRTLM")

    // --- Synchronous functions ---

    Function("isModelLoaded") {
      engine != null
    }

    Function("unloadModel") {
      engine?.close()
      engine = null
      loadTimeMs = 0
    }

    Function("getLoadTimeMs") {
      loadTimeMs
    }

    // --- Async functions ---

    AsyncFunction("loadModel") { modelPath: String, backend: String ->
      val path = toFilePath(modelPath)
      val file = File(path)
      if (!file.exists()) {
        throw Exception("Model file not found: $path")
      }

      // Release previous engine if any
      engine?.close()
      engine = null

      val startMs = System.currentTimeMillis()

      val visionBe: Backend = if (backend == "gpu") Backend.GPU() else Backend.CPU()
      val config = EngineConfig(
        modelPath = path,
        visionBackend = visionBe
      )
      val engineInstance = Engine(config)
      engineInstance.initialize()

      loadTimeMs = System.currentTimeMillis() - startMs
      engine = engineInstance
      android.util.Log.i("LiteRTLM", "Engine loaded in ${loadTimeMs}ms (vision: $backend)")
    }

    AsyncFunction("generateText") { prompt: String ->
      val eng = engine ?: throw Exception("Model not loaded. Call loadModel() first.")

      val message = Message.of(prompt)
      val conversation = eng.createConversation()
      try {
        val response = conversation.sendMessage(message)
        response.toString()
      } finally {
        conversation.close()
      }
    }

    AsyncFunction("generateWithImage") { prompt: String, imagePath: String ->
      val eng = engine ?: throw Exception("Model not loaded. Call loadModel() first.")

      val imgPath = toFilePath(imagePath)
      val imageFile = File(imgPath)
      if (!imageFile.exists()) {
        throw Exception("Image file not found: $imgPath")
      }

      val message = Message.of(
        Content.ImageFile(imgPath),
        Content.Text(prompt)
      )

      val conversation = eng.createConversation()
      try {
        val response = conversation.sendMessage(message)
        response.toString()
      } finally {
        conversation.close()
      }
    }

    AsyncFunction("generateWithImages") { prompt: String, imagePaths: List<String> ->
      val eng = engine ?: throw Exception("Model not loaded. Call loadModel() first.")

      val contents = mutableListOf<Content>()
      for (path in imagePaths) {
        val imgPath = toFilePath(path)
        val imageFile = File(imgPath)
        if (!imageFile.exists()) {
          throw Exception("Image file not found: $imgPath")
        }
        contents.add(Content.ImageFile(imgPath))
      }
      contents.add(Content.Text(prompt))

      val message = Message.of(*contents.toTypedArray())

      val conversation = eng.createConversation()
      try {
        val response = conversation.sendMessage(message)
        response.toString()
      } finally {
        conversation.close()
      }
    }

    AsyncFunction("generateWithAudio") { prompt: String, audioPath: String ->
      val eng = engine ?: throw Exception("Model not loaded. Call loadModel() first.")

      val audPath = toFilePath(audioPath)
      val audioFile = File(audPath)
      if (!audioFile.exists()) {
        throw Exception("Audio file not found: $audPath")
      }

      val message = Message.of(
        Content.AudioFile(audPath),
        Content.Text(prompt)
      )

      val conversation = eng.createConversation()
      try {
        val response = conversation.sendMessage(message)
        response.toString()
      } finally {
        conversation.close()
      }
    }
  }
}
