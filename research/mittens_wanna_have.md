# 🥦 Mittens Health System — Final Plan (v3)

> Planning only. No code yet. All specifics locked in.

---

## Susanna's Profile

```
HEIGHT:          5'7" (170 cm)
WEIGHT:          130 lb (59 kg)
SEX:             Female
DOB:             May 6, 2002 (age 23)
ACTIVITY:        Normally active, sedentary when grinding
SKIN TYPE:       Fitzpatrick 4-5

DAILY MACROS (calculated):
  Protein:       71-118g  (1.2-2.0 g/kg × 59 kg)
  Carbs:         177-295g (3-5 g/kg × 59 kg)
  Fat:           47-71g   (0.8-1.2 g/kg × 59 kg)
  Water:         1.8-2.1L (30-35 mL/kg × 59 kg)
  Fiber:         25g

TDEE (Mifflin-St Jeor, moderate activity):
  BMR = 10×59 + 6.25×170 - 5×23 - 161 = 1,376 kcal
  TDEE = 1,376 × 1.55 = ~2,133 kcal/day
```

---

## Hardware & Services ($0/month)

| Component | Role | Cost |
|-----------|------|------|
| 🖥️ Old laptop (24/7, WiFi) | Ollama + Qwen3.5 for food vision | $0 |
| 📷 ESP32 XIAO Sense | Camera, 3D-printed mount on Vuzix | $0 |
| 👓 Vuzix Z100 | On-lens display | $0 |
| 📱 MentraOS/AugmentOS | App → Vuzix display | $0 |
| 🌡️ OpenUV API | UV forecast (50 req/day) | $0 |
| 💡 AgroMax Pure UV T5 | UVB winter lamp | $0 |

---

## System 1–2: Nutrient Database + Calculator

*(Unchanged from v2 — see previous plan for full tables)*

**Age corrected to 23.** TDEE recalculated: **~2,133 kcal/day**.

---

## System 3: AI Vision — Research & Options

### 🔍 Vision Model Comparison

| Model | Size | VRAM Needed | Speed | Food Accuracy | Offline? | Notes |
|-------|------|-------------|-------|--------------|----------|-------|
| **Qwen3.5 Vision 0.8B** | 0.8B | ~4-6 GB | Very fast | Basic | Via Ollama on laptop | Newest. Native multimodal (not bolted on) |
| **Qwen3.5 Vision 2B** | 2B | ~6-8 GB | Fast | Good | Via Ollama on laptop | Sweet spot for food recognition |
| **Qwen3.5 Vision 4B** | 4B | ~8-12 GB | Medium | Very good | Via Ollama on laptop | **Recommended if laptop has 8+ GB VRAM** |
| **Qwen3.5 Vision 9B** | 9B | ~12-16 GB | Slower | Excellent | Via Ollama on laptop | Best accuracy, needs beefy GPU |
| **Moondream 2B** | 2B | ~6-8 GB | Fast | Decent | Via Ollama on laptop | Ultra-lightweight, designed for edge. Good for general "what is this?" |
| **LLaVA-Phi** | ~3B | ~6-8 GB | Fast | Good | Via Ollama on laptop | Lightweight, solid for general vision |
| **Apple Intelligence** | On-device | iPhone's NPU | Instant | Good | ✅ Fully offline | "Use Model" in Shortcuts. Free, private, no server |
| **ESP32 TinyML** | ~250KB | ESP32 PSRAM | ~1-3s | Limited | ✅ Fully offline | MobileNet via Edge Impulse. Only recognizes trained food categories |

### 🏆 Recommended: Three-Tier Strategy

Build all three tiers. Use whichever fits the situation.

#### Tier 1: Phone Photo → Laptop (MVP, start here)

```
iPhone Camera                Old Laptop (WiFi)              Mittens
┌──────────────┐            ┌─────────────────┐           ┌──────────────┐
│ Take photo   │───WiFi────►│ Ollama           │──WiFi───►│ /vision      │
│ via Shortcut │  POST img  │ Qwen3.5-VL 4B   │ POST     │ /analyze     │
│ or manual    │            │ localhost:11434   │ foods    │              │
└──────────────┘            └─────────────────┘           │ Cross-ref    │
                                                           │ nutrient DB  │
                                                           │ + pantry     │
                                                           │ + RDA gaps   │
                                                           └──────┬───────┘
                                                                  │
                                                                  ▼
                                                       Push notification
                                                       or Vuzix display
```

**How**: iPhone Shortcut → "Take Photo" → POST to laptop Ollama → response → POST to Mittens → get nutrient analysis → display

**When**: Quick grocery trip, checking fridge, cooking prep

#### Tier 2: ESP32 Camera → Laptop → Glasses (Real-time-ish)

```
ESP32 XIAO Sense            Old Laptop                    Mittens
(on Vuzix mount)            (Ollama, WiFi)                (Railway)
┌──────────────┐            ┌─────────────────┐           ┌──────────────┐
│ Button press │───WiFi────►│ Qwen3.5-VL      │──WiFi───►│ /vision      │
│ → JPEG       │  POST img  │                  │ foods    │ /analyze     │
│ (OV2640)     │            │ ~2-5s inference  │          │              │
└──────────────┘            └─────────────────┘           └──────┬───────┘
                                                                  │
                                                      MentraOS/AugmentOS
                                                      WebSocket → Vuzix
                                                      ┌──────────────────┐
                                                      │ Shopping list OR │
                                                      │ cooking tips     │
                                                      │ on-lens display  │
                                                      └──────────────────┘
```

**How**: Press button on glasses → ESP32 captures → WiFi to laptop → Qwen identifies → Mittens cross-references → MentraOS displays on Vuzix

**When**: Walking through grocery store with glasses on, hands-free cooking

**Future: near real-time** — instead of button press, ESP32 captures every few seconds and streams to laptop. Qwen processes latest frame. Vuzix updates live. This works because Qwen3.5 0.8B can do ~1-2s per image on decent GPU.

#### Tier 3: ESP32 On-Device (Offline, No WiFi)

```
ESP32 XIAO Sense (standalone, no WiFi needed)
┌──────────────────────────────────────────┐
│ OV2640 camera → capture frame            │
│ → MobileNet TFLite (Int8 quantized)      │
│ → on-device inference (~1-3s)            │
│ → classify: "broccoli" | "banana" | ...  │
│ → BLE → Vuzix Z100 (basic text display)  │
└──────────────────────────────────────────┘
```

**How**: Train custom MobileNet model on food categories via [Edge Impulse](https://edgeimpulse.com). Deploy as Arduino library to ESP32. Runs entirely on-device in PSRAM (8MB on XIAO S3 Sense).

**Limitations**:
- Only recognizes food categories you've trained (not open-ended "what is this?")
- Start with 20-30 common grocery items, expand over time
- Lower accuracy than VLM — it's classification, not understanding
- No cooking tips or nutrition reasoning (just identifies the food)

**When**: No WiFi available. Out at a farmer's market. Travel.

**Training data**: Photograph your own groceries with the ESP32 camera → upload to Edge Impulse → train → deploy. Edge Impulse is free for personal use.

### 📱 Bonus: Apple Intelligence "Use Model" (iPhone Fallback)

> [!TIP]
> iOS Shortcuts now has a **"Use Model" action** (Apple Intelligence) that can analyze images on-device for free. This is a zero-setup fallback — no laptop, no server, no API key needed.

```
iPhone Shortcut: "Mittens Food Check"
1. Take Photo (or Select Photo)
2. Use Model (On-Device)
   Prompt: "Identify all food items in this photo. Return as JSON list: [{name, category}]"
3. Get Contents of URL → POST to Mittens /vision/analyze
   Body: {foods: <model output>, mode: "grocery"}
4. Show Result (or forward to Vuzix via MentraOS)
```

**Pros**: Instant, private, works offline (the Apple Intelligence part), no server needed for food ID
**Cons**: Can't control model quality, may be less accurate for specific foods, requires iOS 26+

### Comparison Summary

| Scenario | Best Tier | Latency | Accuracy | Needs WiFi? |
|----------|-----------|---------|----------|-------------|
| Quick fridge check | Tier 1 (phone) or Apple Intelligence | 3-8s | High | Yes (or Apple on-device) |
| Grocery store (glasses) | Tier 2 (ESP32 → laptop) | 3-8s | High | Yes |
| Grocery store (no WiFi) | Tier 3 (ESP32 TinyML) | 1-3s | Medium (trained items only) | **No** |
| Cooking prep | Tier 2 or Apple Intelligence | 3-8s | High | Yes (or Apple on-device) |
| Real-time continuous | Tier 2 with Qwen3.5 0.8B | ~1-2s/frame | Good | Yes |

---

## System 4: Smart Glasses

*(Unchanged from v2 — MentraOS/AugmentOS → Vuzix Z100, ESP32 XIAO Sense 3D-printed mount)*

---

## System 5: Weather + Vitamin D

*(Unchanged from v2 — OpenUV API + AgroMax T5 UVB lamp rules)*

**Sun exposure for skin type 4-5:**
- UV 5 → 34-51 min (base 17 × 2.0-3.0 multiplier)
- UV 8 → 20-30 min
- AgroMax: 5-10 min max, 4+ feet, UV goggles mandatory

---

## System 6: Sedentary Detection + Movement

*(Unchanged from v2 — MITTENS_MOVE every 30min during grinding mode)*

---

## Bonus: Apple Health Period Sync

*(Unchanged from v2 — iPhone Shortcut → POST /health/period → iron/B12/Mg modifiers)*

---

## New Files

| File | Purpose |
|------|---------|
| `nutrition.py` | Nutrient database, RDA calculator, cooking rules |
| `weather.py` | OpenUV client, vitamin D windows, AgroMax rules |
| `vision.py` | Routes images to Ollama, parses food ID, cross-refs nutrient DB |
| `pantry.py` | SQLite pantry/fridge inventory from vision |
| `movement.py` | Sedentary detection, MITTENS_MOVE scheduling |
| `glasses/mentra_app/` | AugmentOS app (TS), WebSocket → Vuzix layouts |
| `glasses/esp32_sketch/` | Arduino: capture → POST to Ollama → forward results |
| `glasses/esp32_tinyml/` | Arduino: on-device MobileNet, Edge Impulse, offline food ID |

---

## Env Vars

```env
# Body profile
HEIGHT_CM=170
WEIGHT_KG=59
DOB=2002-05-06
SEX=female
ACTIVITY_LEVEL=moderate
SKIN_TYPE=4

# OpenUV
OPENUV_API_KEY=openuv-11ycnn8rmnbv811c-io

# Local vision (old laptop)
OLLAMA_HOST=http://LAPTOP_IP:11434
OLLAMA_MODEL=qwen3.5-vl:4b    # adjust based on laptop GPU

# UVB lamp
UVB_LAMP_MAX_MINUTES=10
UVB_LAMP_DISTANCE_FEET=4
```

---

## Open Question

> [!IMPORTANT]
> **Old laptop GPU?** This determines which Qwen3.5 model size to use:
>
> | Laptop GPU | Best Model | Speed |
> |------------|-----------|-------|
> | No GPU / Intel integrated | Qwen3.5 0.8B (CPU) | ~10-15s |
> | 4-6 GB VRAM (GTX 1060, etc) | Qwen3.5 2B | ~3-5s |
> | 8-12 GB VRAM (RTX 3060, etc) | **Qwen3.5 4B** ← ideal | ~2-4s |
> | 16+ GB (RTX 3090, etc) | Qwen3.5 9B | ~3-5s |
> | Apple Silicon (M1/M2, 16GB) | Qwen3.5 4B (unified memory) | ~2-4s |
>
> Run `nvidia-smi` (or check "About This Mac") on the old laptop and let me know!

---

## Phased Rollout

### Phase 1: Nutrient Database + Enhanced Meals
- `nutrition.py` with full DB + calculator (probiotics included)
- Enhanced meal calendar events
- **No new APIs, no new hardware**

### Phase 2: Weather + Vitamin D + Movement + Period
- `weather.py` + `movement.py`
- OpenUV integration, AgroMax UVB reminders
- MITTENS_MOVE sedentary alerts
- Apple Health period sync
- **New: OpenUV (have key), 2 iPhone automations**

### Phase 3: AI Vision — Tier 1 (Phone Photo)
- Set up Ollama + Qwen3.5 on old laptop
- `vision.py` + `pantry.py`
- iPhone Shortcut: "Mittens Food Check"
- Apple Intelligence "Use Model" as fallback
- **New: Ollama on laptop**

### Phase 4: Smart Glasses — Tier 2 (ESP32 → Laptop → Vuzix)
- `glasses/esp32_sketch/` + `glasses/mentra_app/`
- 3D print ESP32 mount
- End-to-end: button → photo → food ID → Vuzix display
- **New: ESP32 firmware, AugmentOS app, 3D print**

### Phase 5: Offline — Tier 3 (ESP32 TinyML)
- Train MobileNet on food photos via Edge Impulse
- `glasses/esp32_tinyml/` Arduino sketch
- **Fully offline recognition — no WiFi needed**
- Start with 20-30 common items, expand

### Phase 6: Polish + Smart Modifiers
- Near real-time streaming (ESP32 → laptop continuous)
- Auto-detect stress from calendar density
- Weekly nutrition summary
- Nutrient interaction warnings
- Seasonal food rotation
