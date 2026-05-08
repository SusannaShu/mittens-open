# Fully Local AI -- Tiered Architecture

## STATUS: IMPLEMENTED

All code is in place. Requires native prebuild (`npx expo prebuild --clean && npx expo run:ios`) to test.

---

## Problem

Different devices have different RAM budgets. A one-size-fits-all approach either excludes small devices or wastes resources on large ones.

## Solution: Auto-Tiered Model Selection

The app detects device RAM on setup and selects the best model:

| Tier | RAM | Model | Download | RAM Used | Capabilities |
|------|-----|-------|----------|----------|-------------|
| **Full** | 8GB+ | Gemma 4 E2B (LiteRT) | 2.58 GB | ~1.5 GB | Text + Vision + Audio |
| **Balanced** | 4-6GB | Qwen3.5-0.8B Q8 (llama.rn) | ~1.0 GB | ~1.0 GB | Text + Vision |
| **Lite** | 3GB | Qwen3.5-0.8B Q4 (llama.rn) | ~710 MB | ~700 MB | Text + Vision |

> [!IMPORTANT]
> Key insight: **Qwen3.5-0.8B is natively multimodal** -- it handles BOTH text reasoning AND vision (image understanding) in a single model using mmproj. No separate vision model, no model swapping, no orchestrator complexity.

### Why Qwen3.5-0.8B?
- **Multimodal in one model**: Text + vision via mmproj, so Balanced/Lite tiers need only ONE download
- **Tiny footprint**: Q4 version is ~530MB + 205MB mmproj = **~710MB total download**
- **llama.cpp native support**: Works with llama.rn out of the box (supported architecture)
- **Better than Qwen3 0.6B**: Newer model, better reasoning at a similar size

### Why NOT FastVLM?
FastVLM-0.5B (Apple) has great vision quality but **llama.cpp does not natively support its custom FastViTHD architecture**. It requires a `gguf-connector` wrapper or custom llama.cpp patches, making it unusable with standard llama.rn.

### Why NOT SmolVLM + Qwen3 (previous approach)?
The original design used two separate models (SmolVLM for vision + Qwen3 0.6B for reasoning). This required:
- Sequential model swapping on 4GB devices
- Complex orchestrator logic
- Two separate downloads
- Caption-then-reason pipeline (slower)

Qwen3.5-0.8B eliminates all of this by doing both jobs in one model.

---

## Architecture

```
User selects "On-Device"
  -> detectTier(deviceRAM)
  -> setBrainId('e2b' | 'llama-rn')
  -> download tier-appropriate model(s)

Text input:
  Full:      E2B brain -> LiteRT-LM (Gemma) -> structured output
  Balanced:  LlamaRN brain -> llama.rn (Qwen3.5) -> structured output
  Lite:      LlamaRN brain -> llama.rn (Qwen3.5) -> structured output

Photo input:
  Full:      E2B brain -> LiteRT-LM (Gemma) native vision -> structured output
  Balanced:  LlamaRN brain -> llama.rn (Qwen3.5) native vision via mmproj -> structured output
  Lite:      LlamaRN brain -> llama.rn (Qwen3.5) native vision via mmproj -> structured output
```

---

## File Structure

```
lib/services/ai/
  modelRegistry.ts       # Catalog of 3 local models (Gemma, Qwen3.5 Q8, Qwen3.5 Q4)
  tierSelector.ts        # Auto-detect device RAM -> select tier -> persist
  visionInference.ts     # SmolVLM via llama.rn (kept as fallback, not primary)
  modelOrchestrator.ts   # Tier-aware orchestration (simplified for single-model tiers)
  localInference.ts      # Existing E2B/LiteRT-LM service (unchanged)

lib/brain/
  llamaRN.ts             # Brain for Balanced/Lite (Qwen3.5 -- text + vision in one)
  e2b.ts                 # Brain for Full tier (Gemma E2B)
  selector.ts            # Routes to correct brain based on explicit brain ID
  types.ts               # BrainId includes 'llama-rn'
```

---

## Model Sources

| Model | Quant | Files | Size | Source |
|-------|-------|-------|------|--------|
| Gemma 4 E2B | LiteRT | 1 | 2.58 GB | `litert-community/gemma-4-E2B-it-litert-lm` |
| Qwen3.5-0.8B | Q8 | model + mmproj | ~1.0 GB | `unsloth/Qwen3.5-0.8B-GGUF` |
| Qwen3.5-0.8B | Q4_K_M | model + mmproj | ~710 MB | `unsloth/Qwen3.5-0.8B-GGUF` |

---

## Profile UI

When user taps "On-Device":
1. Auto-detects RAM -> selects tier
2. Shows tier label + total download size
3. For Full: shows Gemma E2B download/ready (existing flow)
4. For Balanced/Lite: shows single Qwen3.5 model status
5. "Download" button with progress bar

---

## Open Questions

1. **Qwen3.5-0.8B quality**: Can it handle complex structured JSON prompts at only 0.8B params? May need simplified prompts.
2. **Vision quality**: Qwen3.5's mmproj vs SmolVLM's dedicated vision -- need to compare caption quality for food photos.
3. **Latency**: Total pipeline time for photo -> structured output on a 4GB device. Target: < 8s.
4. **Future upgrade path**: If vision quality is insufficient, can fall back to SmolVLM captioning pipeline.
