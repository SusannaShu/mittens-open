/**
 * Model Registry -- catalog of all local models available for on-device inference.
 *
 * Each model has:
 *   - id: unique key used in config/storage
 *   - role: what it does (vision, reasoning, or multimodal = both)
 *   - runtime: which engine runs it (litert = LiteRT-LM native, llama.rn = llama.cpp, mlx = MLX Swift, coreml = CoreML)
 *   - files: GGUF/LiteRT/MLX files to download from HuggingFace
 *   - ramMB: approximate loaded RAM usage
 *   - quality: 1-10 relative quality score for its role
 *   - minRAM_GB: minimum device RAM required to run safely (avoids iOS Jetsam kills)
 *
 * MODELS:
 *   FastVLM 0.5B   -- Apple's official on-device VLM. CoreML, fastest TTFT.
 *   SmolVLM2 256M  -- HuggingFace's tiny VLM. MLX Swift, smallest footprint.
 *   Moondream 2    -- Compact VQA/captioning. llama.cpp GGUF, community iOS builds.
 *   Gemma E2B      -- Full tier via LiteRT-LM (best quality, audio support, needs 6GB+).
 *   Gemma 3 1B     -- Standard/Lite tier via llama.rn (text-only, no vision).
 *
 * NOTE: FastVLM, SmolVLM2, and Moondream are vision-capable on low-RAM devices.
 * Gemma E2B is the most capable but requires 6GB+ RAM (crashes on iPhone SE 3).
 */

export type ModelRole = 'vision' | 'reasoning' | 'multimodal';
export type ModelRuntime = 'litert' | 'llama.rn' | 'mlx' | 'coreml';

export interface ModelFile {
  name: string;
  url: string;
  sizeBytes: number;
}

export interface LocalModel {
  id: string;
  name: string;
  role: ModelRole;
  runtime: ModelRuntime;
  files: ModelFile[];
  ramMB: number;
  quality: number;
  /** Minimum device RAM in GB required to run this model safely */
  minRAM_GB: number;
}

const HF = 'https://huggingface.co';
const GEMMA3_1B = `${HF}/google/gemma-3-1b-it-qat-q4_0-gguf/resolve/main`;

export const LOCAL_MODELS: LocalModel[] = [
  // ─── SmolVLM2 256M via llama.rn (smallest VLM, runs on anything) ───
  // HuggingFace's ultra-compact VLM. Vision + text in ~175MB.
  // Ideal for iPhone SE 3 and other low-RAM devices.
  {
    id: 'smolvlm2-256m',
    name: 'SmolVLM2 256M',
    role: 'multimodal',
    runtime: 'llama.rn',
    ramMB: 350,
    quality: 5,
    minRAM_GB: 3,
    files: [
      {
        name: 'smolvlm2-256m-video-instruct-q8_0.gguf',
        url: `${HF}/ggml-org/SmolVLM2-256M-Video-Instruct-GGUF/resolve/main/SmolVLM2-256M-Video-Instruct-Q8_0.gguf`,
        sizeBytes: 175_056_352,
      },
      {
        name: 'mmproj-smolvlm2-256m-video-instruct-q8_0.gguf',
        url: `${HF}/ggml-org/SmolVLM2-256M-Video-Instruct-GGUF/resolve/main/mmproj-SmolVLM2-256M-Video-Instruct-Q8_0.gguf`,
        sizeBytes: 103_771_680,
      },
    ],
  },

  // ─── FastVLM 0.5B via CoreML (Apple's official, best iPhone perf) ───
  // Apple Research CVPR 2025. CoreML + ANE optimized. 85x faster TTFT than LLaVA.
  // Official iOS demo app at github.com/apple/ml-fastvlm
  {
    id: 'fastvlm-0.5b',
    name: 'FastVLM 0.5B',
    role: 'multimodal',
    runtime: 'coreml',
    ramMB: 600,
    quality: 7,
    minRAM_GB: 3,
    files: [
      {
        name: 'fastvlm-0.5b-stage3.zip',
        url: 'https://ml-site.cdn-apple.com/datasets/fastvlm/llava-fastvithd_0.5b_stage3_llm.fp16.zip',
        sizeBytes: 440_000_000,
      },
    ],
  },

  // ─── Moondream 2 via llama.rn (compact VQA, community iOS builds) ───
  // 1.9B params, proven llama.cpp GGUF support. Good object recognition.
  // Needs separate vision projector file (mmproj).
  {
    id: 'moondream2',
    name: 'Moondream 2',
    role: 'multimodal',
    runtime: 'llama.rn',
    ramMB: 1300,
    quality: 7,
    minRAM_GB: 4,
    files: [
      {
        name: 'moondream2-q4_k_m.gguf',
        url: `${HF}/vikhyatk/moondream2/resolve/main/moondream2-text-model-f16.gguf`,
        sizeBytes: 1_300_000_000,
      },
      {
        name: 'mmproj-moondream2.gguf',
        url: `${HF}/vikhyatk/moondream2/resolve/main/moondream2-mmproj-f16.gguf`,
        sizeBytes: 200_000_000,
      },
    ],
  },

  // ─── Full tier: Gemma E2B via LiteRT-LM (text + vision + audio) ───
  // Best quality on-device model. Requires 6GB+ RAM.
  // Crashes on iPhone SE 3 (4GB) due to iOS Jetsam memory limits.
  {
    id: 'gemma-e2b',
    name: 'Gemma 4 E2B',
    role: 'multimodal',
    runtime: 'litert',
    ramMB: 1500,
    quality: 9,
    minRAM_GB: 6,
    files: [
      {
        name: 'gemma-local.litertlm',
        url: `${HF}/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm`,
        sizeBytes: 2_583_085_056,
      },
    ],
  },

  // ─── Standard tier: Gemma 3 1B QAT Q4 via llama.rn (text-only) ───
  // Clean instruction following, no thinking/CoT artifacts.
  // Uses json_schema grammar for guaranteed structured JSON output.
  {
    id: 'gemma3-1b-q4',
    name: 'Gemma 3 1B',
    role: 'reasoning',
    runtime: 'llama.rn',
    ramMB: 800,
    quality: 7,
    minRAM_GB: 3,
    files: [
      {
        name: 'gemma-3-1b-it-qat-q4_0.gguf',
        url: `${GEMMA3_1B}/gemma-3-1b-it-qat-q4_0.gguf`,
        sizeBytes: 760_000_000,
      },
    ],
  },
];

/** Look up a model by ID */
export function getModel(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find(m => m.id === id);
}

/** Get total download size in bytes for a model */
export function getDownloadSize(model: LocalModel): number {
  return model.files.reduce((sum, f) => sum + f.sizeBytes, 0);
}

/** Format bytes as human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}
