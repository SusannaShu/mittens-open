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

  // ─── Ultra tier: Gemma E4B via LiteRT-LM (text + vision + audio) ───
  // Higher quality on-device model. Requires 8GB+ RAM.
  {
    id: 'gemma-e4b',
    name: 'Gemma 4 E4B',
    role: 'multimodal',
    runtime: 'litert',
    ramMB: 2500,
    quality: 10,
    minRAM_GB: 8,
    files: [
      {
        name: 'gemma-local-e4b.litertlm',
        url: `${HF}/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm`,
        sizeBytes: 4_583_085_056,
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
