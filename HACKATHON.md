# Mittens × Gemma 4 Hackathon — Execution Plan

## Hackathon context

- **Event:** Gemma 4 Good Hackathon (Kaggle × Google DeepMind)
- **Prize pool:** $200K across general, impact, and technical categories
- **Deadline:** May 18, 2026
- **Focus areas:** health, education, climate
- **Required features:** multimodal input, native function calling
- **Deliverables:** working demo, public repo, technical write-up, short video

Mittens fits the health × multimodal × function-calling × runs-locally rubric almost exactly.

---

## Positioning

**Mission: health + education. Teach people how to live well — not nag them about it.**

Mittens is a health & education companion. The job is to show people, through data they can see and audit, what a healthy, balanced, fulfilling life actually looks like — grounded in research and practiced daily. Nutritious meals, hydration, sleep, time outside, sun, movement, unbroken work blocks. No failure logs. No "try harder" shaming. Physical health first; mental health follows.

Everything Mittens does — food inference, activity impact, nutrient gaps, UV → Vitamin D synthesis, life-balance scoring — is **visualized and auditable**, especially the AI-inferred parts. Users can see what the model decided, on what input, with what confidence.

Local models + pendant are what make this free for everyone, forever, with no internet required. The pendant removes manual logging. The local model removes the spend gate.

### What makes Mittens not-a-wrapper

- **Metabolism engine** — food as intake, activities as burn, sleep/mood/UV/hydration as absorption modifiers → true absorbed-nutrient gaps that adapt across the day.
- **Nutrient rigor** — bioavailability math, water-from-meals (not just drinks), plant vs animal Vitamin A upper-limit asymmetry (no UL on beta-carotene, real UL on retinol), IOM/NIH tier-based safety, MILP meal planner.
- **LMST scheduling** — local mean solar time for the daily schedule, longitude-corrected against civil time. Dynamic UV-index-driven Vitamin D synthesis, not a flat 15-min rule.
- **AEIOU life categorization** — Stanford Designing Your Life framework, weighted across Work / Health / Play / Love.
- **3-phase activity pipeline** — Recognition → Life Design Inference → Health Impact, with 25+ peer-reviewed citations.
- **Native iOS** — CoreLocation geofencing, CMMotionActivity fusion, Google Calendar OAuth with attendance reconciliation, polyline map trails, focus timer sync.
- **Smart pantry** — logging a home meal auto-decrements pantry stock; freshness timers on every item.

LLMs swap freely; ~85% of Mittens keeps working without them. Gemma plugs into this system rather than *being* the system.

---

## Demo strategy

**Show the full ecosystem, not a reduced food-only demo.**

Differentiation lives in cross-domain inference. Photo→nutrition alone puts Mittens alongside hundreds of similar submissions. The metabolism engine with Gemma powering specific high-frequency local calls is a stronger pitch.

Demo narrative: *"Mittens is a full habit builder and health co-designer. Here's what happens when you take a meal photo, log an activity, check in at bedtime — all with Gemma running on your phone for the hot path, and a Xiao ESP32-S3 pendant providing ground-truth sensor data."*

---

## Three-tier brain model

| Tier | Brain | User pays Google/Anthropic | User pays us | For |
|---|---|---|---|---|
| **Local** | Gemma on-device | nobody | nobody | offline, no-spend, privacy-inclined users |
| **BYOK** | Gemini/Claude via user's own key | user, directly | nothing (or tiny sync fee) | devs, tech-savvy |
| **Managed** | Gemini/Claude via our key | us | subscription ~$5–10/mo | normal users who want it to just work |

Every call shows token usage in-app regardless of tier. Managed tier quota degrades gracefully: when users hit the cap, AI calls fall back to local Gemma rather than failing. No surprise bills.

**Data residency is user-controlled.** Local tier keeps storage fully on-device (SQLite, post-hackathon). BYOK and Managed tiers can sync to Strapi for cross-device continuity, or stay local. Every AI inference is logged with its inputs, outputs, model tier, and confidence — visualized and auditable in-app.

---

## What runs on-device first

Not everything needs to port to Gemma. Pick the right calls.

- **Stage 1 capabilities router** — highest frequency, classification-shaped, latency matters. Port first. Benchmark: 7.16s on Pixel 7a CPU.
- **Food Phase 1 vision (single-shot)** — demo-friendly, headline multimodal win. Benchmark: 22s vision, 7.60s Food ID text. Cap output at `max_items: 8` (ordered by visual prominence, `truncated` flag for the rare >8 case) + compact schema (`n`/`g`/`c` keys) + `max_tokens: 384` safety net with JSON stop sequence.
- **Food Phase 1 vision (delta mode, pendant serial photos)** — preferred when pendant is active. Small token budget per frame (~128), higher accuracy than single-shot because each call is "what changed?" not "what's everything?"
- **Phase 2 nutrient estimation** — leave in cloud initially, but revisit post-hackathon: with delta-style incremental logging, per-frame nutrient adjustment is much smaller than a whole-meal JSON and might become viable locally.
- **Chat tone** — leave in cloud initially. Small models are flat; revisit with Gemma 4 E4B post-hackathon.

### Why cap output tokens when local inference is free

Not about cost — about **latency** and **parse correctness**:

- Decode is linear in output tokens (~15–25 tok/s on Pixel 7a CPU). 128 tokens ≈ 6s, 512 ≈ 25s. The 29.74s Chat benchmark vs 7.60s Food ID is almost entirely this.
- Structured-output calls want JSON and nothing else. Small models love trailing "Here's the JSON:" prefixes, markdown fences, and explanations that break `JSON.parse`. Tight `max_tokens` + stop sequences (`}\n\n`) stops decoding the moment the JSON closes.
- KV cache grows with generation — longer outputs push closer to OOM on a 6GB-RAM phone.

Per-call tuning: Router/Food Phase 1 = 128–384 tok with JSON stops. Chat = 512–1024 (rambling occasionally desired, latency felt). Phase 2 (when ported) = hard clamp to estimated schema length.

### Why GPU ≈ CPU on Pixel 7a (Tensor G2)

Mali-G710 MP7 pays a heavy setup cost for each LLM op (kernel launches, CPU↔GPU memory transfers, buffer reshaping). At batch size 1 the parallelism win doesn't cover the overhead. ARM Cortex-A78 SIMD (NEON) is quite good at INT4/INT8 matmul. Thermal throttling on Mali also kicks in fast — GPU may start faster, then clock down to CPU parity within seconds.

Signal: HF ships `_qualcomm_qcs8275.litertlm` because Google hand-tuned Hexagon DSP paths. No Tensor-optimized variant exists — Tensor's TPU block isn't exposed to third-party LiteRT delegates.

**Decision: default to CPU on Pixel 7a.** Revisit when LiteRT ships a Tensor NPU delegate, or on Pixel 8/9 where the TPU block is exposed. Background-app contention is a secondary effect (~5–10%); closing apps won't flip the verdict.

---

## Economics & infra decisions

- **Free tier reality:** Gemini 2.5 Flash free tier is ~250 requests/day *project-wide* as of April 2026 (cut from higher limits in Dec 2025). Cannot support even ~10 active users. Paid tier is $0.30/M input + $2.50/M output — viable but not free.
- **Image downsizing:** 1024px max before upload, cuts ~70% of bandwidth/storage.
- **Image lifetime:** auto-delete meal photos 30 days after extraction. Keep the analysis, drop the JPG.
- **Nutrient resolution chain:** USDA → OFF → AI (local or cloud, user choice). Add `LOCAL` badge alongside existing `USDA` / `OFF` / `DB` / `EST`.
- **Offline-first SQLite migration:** post-hackathon. For hackathon, keep Strapi primary and add a `Private Mode` toggle that routes AI calls locally while storage stays in cloud.

---

## Xiao ESP32-S3 pendant

Hardware: Xiao ESP32-S3 Sense (camera + IMU), worn as pendant.

### Core interactions — the no-manual-log pathway

The pendant eliminates logging friction. Nothing to open, nothing to tap, nothing to remember.

- **Big-movement camera trigger:** pendant IMU detects significant motion → camera captures scene → BLE-streams to phone → Gemma classifies context (working at desk / eating / cooking / grocery shopping / moving / commuting). False-positive wakes (scratching, reaching for glasses) are handled by a backoff: 3 consecutive "nothing interesting" frames → extend sleep interval (30s → 2min → 5min) until next context change. Cost of a false wake ≈ one Gemma context classification, cheap.
- **Serial-photo cooking analysis — delta pattern, not single-shot:** while cooking context is active, pendant captures every big-movement frame and phone runs Gemma in *delta mode* — "given previous state X, what changed in this frame?" Each call returns `{added:[], removed:[], modified:[]}` with a `via` field (squeeze / pour / sprinkle / chop / fold-in / flip / stir) capturing the gesture, not just the object. This fixes the max-items problem structurally: each frame is 0–2 items, not 15 simultaneous. Token budget per frame drops to ~128, accuracy goes up because the model does change detection instead of full-scene parsing. Condiment amounts are captured from the pour, lemon juice from the squeeze — not the finished plate.
- **Cooking method + quality inference:** Gemma flags visible char severity (golden → brown → dark brown → black spots) and cooking state (crispy / soft / soggy / raw-visible) per frame. Method inference fires from the sequence: oil-then-hot-pan-then-protein → sear; boiling-greens-over-3-min → vit C + folate destruction flag. Nutrient-damage coefficients apply to heat-labile vitamins (C, folate, thiamine B1, B6); heavy char on starches triggers an acrylamide note. Surfaced in the Impact Ledger non-judgmentally: "Broccoli 89mg vit C raw → ~34mg after char. Steaming next time preserves ~80mg."
- **Eating capture + duration:** hand-to-mouth IMU pattern (wrist-preferred, pendant-fallback) + frame → Gemma logs meal + condiments automatically, no "did you just eat?" prompt. Start timestamp (first hand-to-mouth or first food-frame) and end timestamp (10+ min without hand-to-mouth, or plate visually empty) give eating duration → pace. Research-grounded observation, not prescription: fast eating (<15 min) links to weaker satiety signaling and higher post-meal glucose. Mittens surfaces the pattern; the user decides.
- **Nutrient cascade — live and auditable:** when a new delta item lands, the metabolism engine applies its interactions. Lemon juice added to a spinach plate → vit C boosts non-heme iron bioavailability 2–3×, logged as "Iron absorbed: 3.2mg (boosted 2.5× by lemon at 19:42)." The audit UI shows what Gemma saw, what it added, and how the nutrient math moved — the headline "AI shows its work" demo moment.
- **Grocery detection:** when pendant sees a grocery context, pickup-into-cart motions update the pantry with item, estimated quantity, and freshness timer. No manual inventory.
- **Double-tap to talk:** physical double-tap → BLE chat event to phone → TTS speaks reply. Hands-free, no phone unlock.

### Pendant vs wrist split — architectural reasoning

For hackathon MVP: **pendant-only is fine.** The existing Xiao ESP32-S3 Sense prototype (camera + IMU + BLE, IMU-wake triggered) covers serial-photo cooking, scene context, grocery detection, and gesture messaging. Pendant IMU also gives a decent-but-noisy hand-to-mouth signal (~70% accuracy on eating detection) via arm torque on the torso. That's enough to demo.

Post-hackathon: **split to pendant (chest camera) + wrist (IMU-only band).** Three reasons:

- **Hand-to-mouth detection needs to be on the hand.** Pendant sees arm motion indirectly via chest/shoulder torque — misses small forkfuls while seated still. Wrist IMU gets it >95% clean. Also unlocks *typing-vs-eating discrimination*, which pendant cannot do because the torso is static in both (critical for the work-while-eating pattern, which is common).
- **Camera wants chest-level POV.** Wrist cameras are bouncy and mostly point at the floor. Pendant at chest sees what the user sees.
- **Power + thermal split matches sensor needs.** Wrist = tiny IMU + BLE only, weeks on a coin cell. Pendant = camera + ESP32-S3 + BLE, bigger battery acceptable. One device doing both = worst-case thermal + worst-case battery in the most visible location.

### TFLite Micro — move HAR to wrist (post-hackathon)

For hackathon: pendant keeps a simple big-movement threshold (no HAR model on-device) — camera wake trigger only, dumb firmware. For wrist variant (post-hackathon):

- **Activity classifier on wrist:** 6-axis IMU → 6–10 class model (walking / running / biking / stationary / typing / eating / drinking / cooking). Train on UCI HAR / WISDM. ~90% accuracy is well-established. Separate from the pendant — keeps pendant firmware minimal.
- **Eating vs typing vs drinking discrimination:** the wrist's unique contribution. Forearm supination + loading arc = eating; micro-rotations + tap cadence = typing; longer wrist tilt-up = drinking.
- **Sedentary ground truth:** body-worn IMU on wrist is reliable where phone-on-desk motion detection fails. Feeds the touch-grass / move-around nudges.

### Two tiers of local intelligence (the hackathon narrative)

ESP32 does big-movement wake + camera capture (near-zero power when idle), phone does Gemma (2B, multimodal, delta-mode for cooking), Strapi is optional. The whole stack works on a park bench with no signal. Most submissions will be laptop-bound — this is meaningfully differentiated.

### Future wearable expansion (post-hackathon)

Wrist variant becomes a full health-monitor platform, not just an IMU band. Added ~$5–8 of sensors unlocks:

- **Skin temperature** (SHT31 or similar): fever detection, sleep-onset timing, menstrual luteal-phase detection (~0.3–0.5°C post-ovulation rise — the Oura approach).
- **PPG optical pulse** (MAX30102 class): resting HR, HRV (stress + recovery), SpO2, sleep-stage inference, menstrual cycle HR patterns (~2–4 bpm shifts across cycle phases).
- **Combined signals:** period prediction, sleep staging competitive with consumer wearables, stress/recovery axis.

All out of hackathon scope. Formalized here so the wrist isn't just "IMU band" — it's the long-term full-health-monitor platform for Mittens.

---

## Execution order

### Week 1 — Gating tests

1. Flash **Gemma 4 E2B (instruction-tuned)** on Pixel 7a via the **LiteRT-LM SDK** (Google AI Edge). Model bundle: [`litert-community/gemma-4-E2B-it-litert-lm`](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) on Hugging Face — `gemma-4-E2B-it.litertlm`, 2.58 GB, public + ungated, sha256 `ab7838cd…27e42`. The `.task` file in that repo is a WebGPU browser variant; the `_qualcomm_qcs8275.litertlm` is Snapdragon-only — skip both on Pixel 7a (Tensor G2). Runtime URL: `https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm` (no rehost needed; HF CDN is fine).
2. Build **photo→nutrition harness:** throwaway Expo screen. Compare local Gemma vs Gemini Flash on 10–15 real meal photos. Measure: time to first token, total latency, food ID accuracy, nutrient JSON accuracy.
3. **Decision gate:** if local Gemma hits ~80% accuracy in under ~15 seconds, proceed. If not, pivot to pendant as the primary "local intelligence" story.
4. Finish fixing iPhone sedentary/activity detection bug (already in progress).

### Week 2 — Phone integration

5. Port Stage 1 capabilities router to on-device Gemma behind a `Private Mode` feature flag.
6. Port Food Phase 1 (vision → food list) to on-device Gemma. Phase 2 stays in cloud.
7. Add `LOCAL` nutrient source badge.
8. BYOK screen in Profile → Integrations (Gemini/Anthropic key input, encrypt at rest, proxy through Strapi, display token usage from responses).

### Week 3 — Pendant

9. Xiao ESP32-S3 firmware: IMU big-movement threshold → camera capture → BLE packet to phone → phone routes to existing photo-analysis pipeline. Backoff logic for scratching/fidget false wakes.
10. Phone-side delta-mode pipeline: accept serial frames from pendant, maintain "current meal state," call Gemma with prior-state + new frame → apply `added/removed/modified` delta to nutrition log. Display cooking-in-progress badge with live item count.
11. Xiao double-tap gesture detector → BLE "mittens message" event → phone handles via existing chat pipeline → TTS replies through `voiceService.ts`.
12. *(Stretch, post-hackathon if cut)* TFLite Micro activity classifier — **defer to wrist variant.** Pendant keeps dumb firmware for hackathon.
13. New `activity-log` source type: `"wearable-pendant"`. Extend nutrition-log with eating duration fields (`eatStartAt`, `eatEndAt`, `paceSec`).

### Week 4 — Polish + submit

13. Rebrand pass across README.md, ROADMAP.md, onboarding copy. "Coach" → "habit tracker / builder / life co-designer, health-first."
14. Image lifecycle: 1024px downsize on upload, 30-day photo delete cron in Strapi.
15. Demo video (≤3 min): full ecosystem walkthrough, emphasize multimodal + function calling + on-device + pendant.
16. Technical write-up: architecture diagram, metabolism engine explanation, on-device pipeline, pendant integration. Link to ROADMAP.md for extended scope.
17. **Submit by May 18, 2026.**

---

## Deferred (post-hackathon)

- Full offline-first SQLite migration + two-way sync protocol — enables fully-local storage with Strapi optional.
- Stripe integration for managed-tier subscriptions.
- **Wrist variant (IMU + skin temp + PPG)** — becomes the full health-monitor platform: HAR (incl. eating-vs-typing discrimination), sleep staging, HRV, resting HR, skin-temp sleep onset and menstrual luteal detection, period prediction. ~$5–8 BOM added to the wrist device.
- On-device Phase 2 nutrient estimation (may arrive sooner with delta-mode incremental logging — per-frame adjustments are smaller than whole-meal JSON).
- **"Why work" task list + user life-view** — user articulates what they're working toward and what a good life looks like to them; Mittens educates (does not nag) using that frame.
- Odyssey Plan, Life Design Team relationship map, social scheduling agent (existing ROADMAP).

## Explicitly dropped

- **Screen-Dimming Enforcement Protocol / harsh interventions via Screen Time API** — Mittens can just talk about it when relevant, and notifications already cover the nudge. No forced behavior modification.
- **Appointment reminders** — native calendar notifications handle this; no reason to duplicate.
- **"I'll try harder" failure-log framing** — wrong tone. Replaced with research-grounded, visualized, non-judgmental education. The vibe is "your physical health has to be in place before your mental health can keep up" — firm but not punitive.

---

## Open questions

- Gemma 4 E2B `.litertlm` format availability in the hackathon's approved model list (confirm at kickoff).
- Managed-tier subscription price point: $5 vs $10 vs freemium-with-credits.
- Pendant double-tap vs single-tap-hold ergonomics — test with actual wear.
- BLE power budget for continuous pendant operation — camera is the dominant cost.
- Whether to keep Phase 2 nutrient estimation behind a user-visible cloud-call counter or silent fallback.
