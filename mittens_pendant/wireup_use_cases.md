# Wiring Mittens into Real Pipelines — 10 Use Cases

Companion doc to `susanna + mittens first convo.md`. Voice + vision work; this is the plan to turn the pendant from a chat toy into a **proactive ambient agent**.

Everything below names exact files in this repo so each item is concretely actionable.

---

## Design v2 (current direction)

Several design simplifications after walking through real scenarios. These supersede the per-use-case "what to build" suggestions further down — the use cases are still valid as *scenarios*, but the architecture below is the unified version.

### 1. No polling — event-driven progress only

Every in-progress scene log carries `openedAt`, `lastActiveAt`, and a list of `triggers`. Triggers are checked **only when new evidence arrives** (pendant frame, GPS update, transcript) — not on an interval.

- Work scene opened at 14:00. New frame at 14:46 still classifies as work → after-frame handler checks `now - openedAt >= 45min` → fires break nudge.
- Cook scene: when method "baking salmon" is identified, set `cookFinishAt = now + 20min` as a *single* `expo-notifications` scheduled local notification (survives backgrounding). Not a poll, one fire.
- The only true scheduled triggers in the system are these one-shots: cook timers, pre-meal nudges, bedtime nudges. Everything else is reactive on new evidence.

### 2. Unified `SceneStream` (no separate Meal/Activity streams)

One `Scene` per continuous engagement. Subsumes both the old MealStream and ActivityStream ideas.

```
Scene {
  id, openedAt, lastActiveAt, closedAt?
  type: "lunch" | "work" | "commute" | "meal_prep" | ...   // coarse
  subPhase: "prep" | "cook" | "eat" | "cleanup" | "active" // fine
  aeiou: { ... }                              // populated incrementally
  environment: indoor/outdoor/...             // populated incrementally
  food?: {
    ingredients[], method, cookStartAt, cookFinishAt, plateAt,
    methodRecommendation?: { method, score, reason }  // see Cook phase
  }
  eatingContext?: { pace, distraction, ... }  // populated when subPhase=eat
  pantryDeltas[]: { name, qtyChange, reason } // accumulated during prep
}
```

A scene opens on the first qualifying frame (kitchen → meal_prep, desk → work, etc.). Reflect renders the same scene as one block (possibly split visually by sub-phase for prep + eat), no schema change.

**Cook phase (uses existing `lib/data/retentionFactors.ts`).** When ingredients are identified during meal_prep:

```
score(food, method) = Σ over nutrients (
  baseValue[nutrient] × retentionFactor[food][method][nutrient] × userPriority[nutrient]
)
recommend = argmax(score) across valid methods (raw excluded if food.requires_cooking)
```

`userPriority` defaults to 1 for all nutrients but **gets weighted up for current gaps**: if vitamin C is low this week, raw / quick-steam wins for vitamin-C-rich foods. Same data, personalized recommendation.

Foods missing from retention table → fall back to E2B prompt, **cache result in `cooking_method_cache` keyed by (food, method)**. First time = brain call; subsequent = SQL.

Memory interplay: if user's memory says "prefers fried," the recommender returns BOTH the nutrient-optimal method and the user-preferred method. Mittens phrases it as "you usually fry, but baking keeps more B12 — your call." Informs without overriding.

**Scene close — multi-signal, not idle-timeout.** Triggered on new evidence, not on a clock:

- **Geofence exit** → hard close, any scene.
- **meal_prep → eat pivot** when next frame shows: food plated, utensil in hand, person near mouth, OR user moved from stove area to dining/desk within the same place.
- **eat close** when: plate empty for 2 consecutive frames, OR user stands and walks to sink, OR utensils placed down and 5min of no eating motion (5min tolerance checked when the NEXT frame arrives — not a poll).
- **cook → plate pivot** when `cookFinishAt` timer fires AND user is in kitchen.
- **work close** when: laptop not visible in frame, OR user moved >5m from desk area, OR place exit.
- **Safety net**: 30min no qualifying frame → close with `closeReason: 'timeout'`, marked low-confidence. Not the primary path.

The salmon-burning case: `food.cookFinishAt` is set when method is identified, one-shot timer fires at that timestamp. If user has left the kitchen → "your salmon is gonna burn." If user is still in kitchen → "your salmon is done."

### 3. Pantry management (new — doesn't exist today)

Per ingredient identified during meal_prep:

- **In pantry** → `pantry[name].qty -= usedQty`. Below buffer (default 0.5× last add) → mark `running_low`, surface in next grocery nudge.
- **Not in pantry** → user clearly has it. Add new entry. Total estimate priority:
  1. Visible container/package quantity from the frame (identify phase already returns `quantity`).
  2. Fallback: `max(usedQty * 2, sensibleMinimum)`. Mark `confidence: 'low'` so the pantry UI shows a "guess" badge and lets the user correct.

Special "inventory glance" trigger: when a fridge-open or shelf-open frame is detected, identify all visible items in one shot and reconcile against pantry. Cheap because identify already returns a multi-item list.

### 4. Pre-meal nudges, before the meal time, for all three meals

Replace the "you forgot dinner" post-meal pattern with scheduled pre-meal nudges. For each of `breakfast`, `lunch`, `dinner` from `materializeSchedule()`:

- Check overlapping calendar events.
  - **Calendar event covers meal time** → user will be away → meal must be portable → fire at `event.start - travelMins - prepMins - buffer`.
  - **No overlap** → user eats at home → fire at `mealTime - prepMins - buffer`.
- `prepMins` is a profile setting with per-meal override (defaults: breakfast 10, lunch 25, dinner 30).
- Scheduled via `expo-notifications` at app boot for the rest of the day. Re-evaluated on calendar change. No polling.

### 5. Memory retrieval — three-tier, mostly free

E2B context is small, so we can't dump memory. But always-retrieve is wasteful. Most kitchen frames are unambiguous (banana = banana). Design:

**Tier 1 — Free, deterministic (SQL only, always runs):**
Hardcoded scenario→recency-bucket lookups:
- Yogurt machine in frame → fetch `food.machine_setup` notes from last 48h
- Fridge open at home → fetch current pantry state
- Cooking detected → fetch `routines.cooking_methods`
- Eating in kitchen → fetch `preferences` notes
Zero brain calls, zero context cost. Handles the "what was in the yogurt machine yesterday" case automatically because the system knows yogurt-machine scenarios need 48h context.

**Tier 2 — One tiny brain call: "do we need to retrieve?"**
For ambiguous scenes, run a small retrieval-decide call with the memory *index* (1-line summaries, not full notes):

```
1. preferences: "always picks kefir over yogurt" (2026-04-15)
2. routines: "cooks chicken on Sundays in batches" (2026-03-22)
3. health: "low on vitamin K, eats natto twice weekly" (2026-05-01)
...
```

Input: index + a one-sentence scene descriptor. Output: `{ useIds: [1], reason: "kefir vs yogurt ambiguity" }` or `{ useIds: [], reason: "unambiguous" }`. Index of 30 entries ≈ 800 tokens — fits in E2B budget.

**Tier 3 — Identify with retrieved notes:**
Final identify call gets `tier1_notes + tier2_notes + scene`, max ~3 notes injected as a short "relevant preferences" preamble. Stays inside E2B budget.

**Cache:** First time a scene descriptor like `white-fluid-yogurt-machine-home-morning` passes through tier 2 with a non-empty result, cache the descriptor-hash → memory-IDs mapping. Next time the same scene class appears, skip tier 2. Cache invalidates when memory changes.

**Container-reading vs memory.** Both run, fused at the end:
- Identify phase always attempts OCR/label-read on visible packaging.
- Memory tiers feed in.
- Precedence: high-confidence container label wins. Otherwise memory + visual gestalt decide.
- Yogurt-machine case: container reads "yogurt maker," contents not visible → memory tier 1 retrieves "yesterday: kefir grains + milk in the machine" → classified as kefir.

### 6. Where the old "what to build" items land

- "MealStream" + "ActivityStream" → **`SceneStream`** (this section)
- "sedentaryWatcher" → **trigger-on-evidence in the work scene** (no longer a polling watcher)
- "scheduleMealReminders" → **pre-meal nudges** above, three meals not just dinner
- "pantryReconcile" / "pantryDecrement" → **pantry management** above
- "mittensAsk auto-listen" → **mittensAsk button-press** (already updated in cross-cutting section)
- "memory write-back" → unchanged, still needed
- "phantom ingredient detector" → folded into pantry management's "not in pantry" branch

---

## Implemented in this session

- **`motionService.ts`** rewritten to read the real `{ events: ActivityChangeEvent[] }` payload from `react-native-motion-activity-tracker`. Previously read a non-existent `event.state` field — the throw was swallowed, AR pipeline was a silent no-op for the whole app's life. Now picks the highest-confidence ENTER transition and preserves real confidence.
- **`locationService.ts`** gained three protections:
  - `hasRecentDisplacement(meters, withinMs)` helper that checks the GPS history for actual path length.
  - Non-stationary AR events are dropped if there's < 30m of displacement in the last 60s (kills the fidget-as-walking failure mode).
  - The premature `pullAndLogMotionPoint` in the no-anchor branch is gone — we now pull a GPS sample as the anchor and let `confirmMotionStart` decide whether to log.
  - GPS-speed fallback ladder now requires `hasRecentDisplacement(30, 60s)` before emitting any non-stationary label.
- **`phoneMotionClassifier.ts`** (new): phone-only walk/bike/transit/run/stationary classifier fusing GPS speed/variance/displacement + Pedometer step rate + AR (gated by its own confidence). 90s rolling window. Subway-tunnel hold so the transit label survives a brief GPS loss. Returns `{ type, confidence, reason, timestamp }` — reason is logged for debugging.
- **`startActivityRecognition()`** now starts the classifier first (always), then attaches AR as a secondary input.
- **`handleSignificantLocationChange`** consults the classifier for the motion label on every location point. Legacy AR + GPS-speed ladder is the fallback if the classifier returns `unknown`.

## 0. What we already have (the foundation)

The good news: most of the pipeline plumbing is built. The hard part is **routing pendant frames into it** and giving Mittens **proactive voice + listening**.

| Layer | File | Status |
|---|---|---|
| Pendant BLE protocol (DOUBLE_TAP, SINGLE_TAP, MOTION, COMMAND) | `lib/services/pendant/pendantProtocol.ts` | done |
| Pendant service lifecycle + BLE/HTTP | `lib/services/pendant/pendantService.ts` | done |
| Firmware: IMU wake + button wake from deep sleep | `mittens_pendant/firmware/pendant_main/*.ino` | done |
| Pendant → chat bridge (double-tap → brain → TTS) | `lib/hooks/pendant/usePendantBridge.ts` | done for voice; **motion frames currently dropped into a store, NOT piped to triage** |
| Triage (one input → many pipelines, with phase gating) | `lib/pipelines/triage.ts` | done |
| Pipeline runner + per-phase logging | `lib/pipelines/runner.ts` + `logger.ts` | done |
| Food pipeline (identify → nutrients → bio → validate) | `lib/pipelines/food/*` | done |
| Activity pipeline (detect → env → social → objects → lifeDesign) | `lib/pipelines/activity/*` | done |
| Pantry pipeline (identify → freshness) | `lib/pipelines/pantry/*` | done |
| Eating context (pace/chewing/distraction/stress/social) | `lib/pipelines/food/eatingContext.ts` | done |
| Memory retrieval (scoped by keywords) | `lib/services/food/memoryRetrieval.ts` | done |
| User memory store (profile.memory JSON in SQLite) | `lib/services/profileApi.ts` | done |
| Morning wakeup notification | `scheduleMorningWakeup()` in `alarmScheduler.ts` | **notification only, no TTS, no pendant-aware check** |
| Departure alarm T-15/T-5/T-0 | `scheduleDepartureAlarm()` | done; **doesn't yet factor in lunch-prep time** |
| Location: 3-layer geofence + trail + motion inference | `lib/services/location/locationService.ts` | done |
| Motion classification (CMMotionActivityManager) | `lib/services/location/motionService.ts` | done — but as you noted, walk/bike/run accuracy is weak |
| Location sessions (SQLite, place + motion + trail + duration) | `lib/services/location/locationSessionApi.ts` | done |
| TTS | `Speech.speak()` in `lib/services/ai/voiceService.ts` | done |
| STT | iOS native via `transcribeAudioFile()` | done |

So the missing pieces, abstractly, are:

- **Motion-frame → triage:** route auto-captured frames through the same pipeline as chat photos.
- **Series → one meal:** keep an open "meal in progress" stream and update it incrementally instead of logging each frame separately.
- **Mittens-initiated questions:** push a question through TTS *and* auto-arm the mic to listen for ~10s.
- **Memory write-back:** when a clarifier answer comes in ("I always get kefir"), persist it to `profile.memory`.
- **Sedentary watcher:** background task that fires nudges when no motion + at-desk + > threshold.
- **Calendar-aware nudge composer:** combines schedule + travel + cooking-time estimate.
- **GPS-gated pendant sleep:** phone tells pendant via COMMAND_UUID to suspend capture while moving.
- **Pantry write-back from kitchen frames:** add unknown items, decrement on use.
- **Nutrient-gap aware suggestions:** wire `scanFridge`/`getGroceryList` into dinner nudges.
- **Bedtime hygiene nudge:** new alarm type with TTS.

The rest of this doc walks each use case with: trigger, pipelines/phases, what to reuse, what to build, what to test.

---

## Use case 1 — Wakeup nudge

> At planned wakeup time, if pendant isn't connected / connected-but-not-worn / user doesn't seem up: **yell** "Susanna, it's time to wake up and get some morning light."

**Trigger source:** local notification scheduled by `scheduleMorningWakeup()` at the planned wake time (already exists). On fire, run a new **wakeup-state probe** function.

**Probe logic (new — call this `wakeupCheck()` in `lib/services/schedule/`):**
1. `pendantService.connected` — false → "not connected"
2. If connected: check whether IMU has reported MOTION events in the last 5 min (we already get MOTION events through `onMotionFrame`). Zero events → "not worn or asleep."
3. Phone motion via `motionService.getCurrentMotion()` — "stationary" + last screen-unlock > 30 min ago → likely still in bed.
4. If any of the three say "not up" → **yell** = play TTS at elevated volume.

**Pipelines/phases involved:** none of the data pipelines. This is purely a **scheduler + TTS + state probe** task.

**What to reuse:**
- `scheduleMorningWakeup()` — keep, but change its `data.type` handler to call `wakeupCheck()` instead of just saving a chat message.
- `pendantService.getConnectionState()` (already exists).
- `pendantStore.recentCaptures` — gives recent MOTION timestamps.
- `voiceService.speak()` with a louder, longer prompt.

**What to build:**
- `wearDetector.ts` — tiny helper: "is the pendant worn?" = pendant connected AND any MOTION event in last N minutes.
- A `yell()` variant in voiceService that boosts volume / repeats (expo-speech doesn't expose a volume knob directly — workaround is to speak twice and rely on system volume; document the limitation).
- Optional pendant firmware change: a "WAKEUP" command via `COMMAND_UUID` that flashes the LED + plays a buzz pattern. Worth it — TTS alone won't wake her.

**Test plan:**
- Unit-test `wearDetector.isWorn()` with fake `pendantStore` data (no MOTION = not worn).
- Set wakeup 2 min from now, leave pendant on desk, confirm yell fires.
- Set wakeup, wear pendant + tap it (synthesize MOTION), confirm yell **doesn't** fire.

---

## Use case 2 — Kitchen food capture, with clarifier

> 7am pour white liquid from yogurt machine → glass jar. Yogurt or kefir? confidence 0.7 → Mittens asks "Susanna, yogurt or kefir?", records the next 10s, gets "I always get kefir" → updates memory + logs breakfast. Then sees almonds + sunflower seeds added → updates same meal log.

This is the **most complex** use case and several other ones reuse its machinery (kitchen sees → identify → maybe-ask → log → update). Treat this as the flagship and most of the others fall out of it.

**Trigger source:** firmware MOTION → `onMotionFrame(framePath)` → currently the bridge just stores it. **Change:** route frame through triage when in a "capture-worthy" zone (see use case 6 for the GPS gate).

**Pipelines/phases:**
- `triage()` on the single frame → likely returns `{ pipeline: 'meal', phases: ['identify'] }` or `{ pipeline: 'pantry', phases: ['identify'] }`.
- `food/identify.ts` → returns items with confidence.
- New: **clarify phase** — if any item's confidence is below a threshold (0.75 say), build a yes/no/one-of question and ask via TTS. Pendant auto-records 10s; transcript becomes a follow-up turn.
- New: **mealStream** — instead of creating one MealLog per frame, an in-memory `OpenMeal` is opened on first kitchen frame; each subsequent kitchen frame within ~15 min of the last one **augments** the same meal log (add items to existing food list, re-run nutrients + bioavailability incrementally).
- `food/nutrients.ts` + `food/bioavailability.ts` + `food/validate.ts` — run once at meal close (or after each item if you want live totals; the latter is more expensive).
- After kefir answer: `chat/sideEffects.ts` already has memory-write logic — extend so the clarifier transcript ("I always get kefir") goes through it and lands in `profile.memory.preferences`.

**What to reuse:**
- `triage()` with images → already classifies meal vs pantry.
- `food/identify.ts` — already produces `FoodItem[]` with confidence.
- `parseJsonResponse` + `memoryRetrieval.getRelevantMemory()` already prime food prompts with preferences (so once "kefir" is in memory, subsequent identify passes should bias toward it).
- `usePendantBridge` double-tap path (audio + frame) — reuse the listen-then-respond flow as the clarifier response handler.

**What to build:**
1. **`MealStream` service** (`lib/services/food/mealStream.ts`): opens an active meal session keyed by location (= kitchen) and time. Methods: `openOrExtend(frame, items)`, `closeIfIdle()`. Persists into existing meal log table.
2. **`mittensAsk()` helper** (`lib/services/pendant/mittensAsk.ts`): `speak(question)` + arm a one-shot callback that listens for the *next* double-tap audio (push-to-talk button press). The pendant does NOT auto-record after a question — user still presses the button to answer. This is intentional: avoids hot-mic ambiguity, keeps the same UX as the existing double-tap flow, and means no firmware change is needed. The callback times out after ~60s if no button press arrives.
3. **Confidence-gated clarifier** in food pipeline: after `identify`, if `max(confidence) < 0.75` AND `items.length === 1`, ask. Generic enough to reuse anywhere.
4. **Memory persister** (`lib/services/profile/memoryUpsert.ts`): given a transcript + topic, decide whether to add a note. "I always get kefir" → category `preferences`, note `"always picks kefir over yogurt"`.

**Firmware change:** none required for the clarifier flow. The user presses the pendant button to answer Mittens' questions, same as any other voice message. (We considered an auto-listen BLE command but the explicit button press preserves user agency and avoids hot-mic surprise.)

**Test plan:**
- Mock: feed three frames (yogurt-machine pour, jar of almonds, jar of sunflower seeds) into the bridge in sequence. Assert that `MealStream` keeps one open log and the food list grows to 3.
- Unit-test the clarifier: stub `identify` with `confidence: 0.6` → asserts `mittensAsk` invoked with the right question.
- Integration: physically pour something white, confirm Mittens asks; answer "kefir," confirm `profile.memory` gains the note.
- Edge: low-light frames → `identify` returns empty → make sure we **don't** open a meal log on garbage frames.

---

## Use case 3 — Eating pace + environment + work overlap

> While eating: capture pace, indoor vs outdoor, presence of laptop. If laptop visible, also log a working block in parallel.

**Trigger source:** continues from #2. Once `MealStream` is open, subsequent frames where a person is visible eating (vs prep) feed into the same meal but trigger the eating-context phase.

**Pipelines/phases:**
- `food/eatingContext.ts` — already exists, returns pace/chewing/distraction/stress/social.
- `activity/triage.ts` + `activity/detect.ts` + `activity/environment.ts` + `activity/objects.ts` — already exist. If `objects.detected` includes laptop or screen, also kick off an activity log of `work`.
- This is *the* place where triage's multi-intent design pays off: one frame triggers `meal:eatingContext` AND `activity:detect+objects+environment`.

**What to reuse:** all of it. Triage already supports returning two intents.

**What to build:**
- A heuristic in `MealStream` to switch frames from "still cooking" → "eating now" once the scene composition changes (likely: still hand-near-mouth or fork present). For now, just call `eatingContext` on every meal frame and let the AI return the right pace; you can dedupe/average across the stream.
- **Reflect-calendar timeblock writer** — once `MealStream.close()` fires, write a single `Reflect` timeblock spanning the actual start/end and labeled with the meal name. If a parallel work activity was logged during the meal, that's a second block. Both use existing `activity-log` infrastructure.

**Test plan:**
- Feed three frames: salad bowl alone → person + fork → person + fork + laptop. Assert: one meal log, eating-context populated, one activity log with `work` overlapping the second half.
- Confirm Reflect timeblock has correct start/end (= first kitchen frame to last eating frame).

---

## Use case 4 — Sedentary break

> 45 min at desk with no break → "Susanna, time to take a break from desk — you said you want to do 20 pullups before summer."

**Trigger source:** new background watcher — `sedentaryWatcher.ts`. Polls every ~2 min:
- `motionService.getCurrentMotion()` returns `stationary`
- Current place is a `KnownPlace` of kind `desk` / `home` / `work`
- No pendant MOTION events recorded in the last 45 min
- (optional) calendar isn't currently in a meeting block

**Pipelines/phases:** none. This is **goal-aware composer + TTS + listen**.

**What to reuse:**
- `motionService` + `locationService.getCurrentPlace()` — both ready.
- `memoryRetrieval.getRelevantMemory()` to pull goals/routines notes — feed those into the prompt so the nudge cites real goals ("pullups before summer," "middle splits").
- `voiceService.speak()` for delivery.

**What to build:**
1. `sedentaryWatcher.ts` (BackgroundFetch task or a foreground interval). 45-min threshold should be a profile setting (you already have `workIntervalMins`!).
2. A **nudge composer** that rotates through the user's active goals so it's not always pullups. Pull the latest few entries from `profile.memory.routines` + `activities`.
3. Snooze logic: if a nudge fires and user is still sedentary 15 min later, escalate; if user starts moving within 5 min, cancel + log a successful break.

**Test plan:**
- Mock motion = stationary, current place = home-desk, no events for 46 min → assert nudge fires.
- Set workIntervalMins = 20 → assert threshold respected.
- After nudge, simulate motion within 5 min → assert "break taken" entry logged.

---

## Use case 5 — Calendar-aware lateness with cooking time

> Calendar has D12 shift at noon. 11:30 you're still working. "Susanna you'll be late — 12 min biking, no lunch prepped, meal-prep now to make it on time."

**Trigger source:** extend `scheduleDepartureAlarm()`. It already does T-15/T-5/T-0 based on travel time. Add a **pre-travel checklist** computed at T-(travel + prep + buffer).

**Pipelines/phases:**
- Calendar event lookup — already exists (`calendar-events/today` endpoint).
- Travel time — already used inside `dynamicallyUpdateAlarms()`.
- **New: prep-time estimator** — if the event is at a place tagged as `work_shift` / has a `requires_lunch` flag, look at `getPantry()` to see if a meal exists pre-made; otherwise estimate cook time from `commonFoods.ts` defaults (and any user override in memory).
- TTS via `voiceService.speak()` and **always** send to pendant (use COMMAND_UUID "PLAY" with the encoded text if firmware supports it, else fall back to phone speaker).

**What to reuse:** all of `alarmScheduler.ts`. Just an additional alarm slot.

**What to build:**
1. `eventPrep` table or just a `prepMinutes` field on KnownPlace ("D12 shift needs 30 min lunch prep").
2. `prepCheck.ts`: given `event`, `pantry`, and `prepMinutes`, decide whether to fire a "prep now" nudge T-(travel + prep + 5).
3. Optional but nice: a **what-to-make suggestion** that's a thin call to the chat brain with current pantry + nutrient gaps.

**Test plan:**
- Mock: event at noon, 12 min travel, 30 min prep, no pre-made lunch in pantry → assert nudge fires at 11:13.
- Same event but pantry has `lunch_ready` → assert no prep nudge, normal T-15 fires.

---

## Use case 6 — GPS-gated pendant capture

> Moving = no need for ambient photos (we can't tell anything from a moving scene anyway). Phone sends `isMotion=true` over BLE; pendant stops auto-capture. Resume when stationary.

**Trigger source:** `motionService` already emits motion changes via `subscribeMotion()`. Hook into it.

**What to reuse:**
- `pendantService.sendCommand()` (write to `COMMAND_UUID`) — already used for WiFi credentials. Add `CAPTURE_PAUSE` / `CAPTURE_RESUME`.
- `motionService` callbacks.

**What to build:**
1. **App side:** in pendant init, subscribe to motion; on transitions to `walking`/`cycling`/`running`/`driving`, push `CAPTURE_PAUSE`. On transition to `stationary` for >2 min, push `CAPTURE_RESUME`.
2. **Firmware side:** parse `CAPTURE_PAUSE` in the command handler; set a `captureEnabled = false` flag that short-circuits the MOTION handler before it does the camera grab. The IMU still wakes the chip from deep sleep (which is what burns least power), but it goes right back to sleep without snapping a frame.
3. **Location-only fallback:** while paused, write a tighter GPS trail (`locationSessionApi` already does this on motion start) so we still know *where* she went, even though we don't have pictures.
4. **Smart resume edge case:** if she sits down at a coffee shop, motion → stationary triggers resume even though we're not home. That's fine — the pendant will photograph the café and triage will route the scene to whatever pipeline matches (likely social/work/meal).

**Activity classification: phone for boundaries (GPS-based), pendant for scene-based type**

Pendant won't be worn during runs but phone always comes along — so the phone handles boundary detection and the `running` label, and the pendant (when worn) classifies walk/bike/transit from the camera, not from IMU.

**Why current phone motion detection is bad — three real bugs:**

1. `motionService.ts:84` hardcodes `confidence: 'high'`, throwing away CMMotionActivityManager's actual confidence reading. Hand fidgeting returns `low` from the API; we relabel it `high`.
2. `locationService.ts:handleMotionStateChange` calls `pullAndLogMotionPoint(motionType)` *before* the GPS confirmation runs. The bogus `walking` point is already in the trail by the time `confirmMotionStart` rejects it.
3. No "have we actually moved in the last minute?" GPS-history gate. AR-derived `walking` is trusted unconditionally as long as it's < 60s old.

**Fixes:**
- Plumb the actual event confidence through `motionService`.
- In `handleMotionStateChange`, ignore any non-stationary AR event when GPS history shows < 30m displacement in the last minute.
- In `confirmMotionStart`, only write the location point in the success branch, after the 10m displacement check passes.

**Revised split:**

**Phone (does motion detection + running):**
- `STATIONARY → MOTION` when GPS speed > 0.5 m/s sustained 20s, OR displacement > 50m in 60s
- `MOTION → STATIONARY` when speed < 0.3 m/s for 2 min
- `running` label only fires when AR says `running` AND confidence ≥ medium AND GPS speed > 1.5 m/s. Otherwise just `moving`.
- No walk/bike/transit labels from phone — leave that to the pendant scene.
- Send `MOTION_START` / `MOTION_END` to the pendant over BLE so it knows when to switch capture cadence.

**Pendant (just a camera + worn-detector):**
- `isWorn = ble.connected` — simple, no orientation analysis needed.
- Stationary: capture on motion-event (current behavior). Dense at known places (kitchen, desk).
- Moving + worn: capture every 60s. Scene tells us walk/bike/transit:
  - Handlebars / bike-light POV → `bike`
  - Bus/subway/car interior, seatbacks → `transit`
  - Sidewalk + outdoor + body motion → `walk`
  - Treadmill / gym interior + motion → `run` (matches phone's AR call)
- Moving + not worn: no pendant frames at all. Phone GPS trail is the log. If phone AR labels it `running`, log as a run; else just a `moving` trail.

**No IMU classifier on pendant** — keeps firmware simple, keeps battery profile predictable.

**Capture cadence summary:**

| Phone GPS | Worn? | Capture |
|---|---|---|
| stationary, known place | yes | dense (motion-event) |
| stationary, unknown place | yes | every 5 min |
| moving | yes | every 60s, scene classifies type |
| moving | no | none, GPS trail only |

**Scene-based classifier prompt** lives in `pipelines/activity/detect.ts` and just needs an extra hint when the input is a pendant-during-motion frame: "the wearer is currently moving — classify as walk, bike, transit, run, or unknown based on visible scene." This is a tiny prompt extension, not new infrastructure.

**Things this design intentionally drops:**
- Pendant IMU sampling for activity classification (would cost firmware + battery; scene-based is good enough)
- Phone AR for anything except running (it's noisy for everything else, as documented above)

**Test plan:**
- Simulator: trigger `motionService` callbacks with `walking` → assert CAPTURE_PAUSE sent.
- Trigger `stationary` for 2 min → assert CAPTURE_RESUME.
- On real device, walk around with pendant — confirm pendant doesn't burn battery / spam frames during walk.

---

## Use case 7 — Work activity at school, with start/end windows

> 2pm working, 3pm still working — log window should be 2-3+pm with accurate start and end.

This is basically use case 3 minus the meal. You already have everything:

**Trigger source:** `MOTION` frames while at the `school` known place AND `motionService` = `stationary` AND scene has laptop/desk objects.

**Pipelines/phases:**
- `activity/detect.ts` + `objects.ts` + `environment.ts` → already produce a `work` activity log.
- **New: `activityStream`** — same idea as `MealStream`. Open an `OpenActivity` when triage classifies work for the first time at a place; extend its end time on every subsequent confirming frame; close when the user leaves (geofence exit) or stationary stops being true for >20 min.

**What to reuse:** all of activity pipeline + locationSession boundaries.

**What to build:**
- Generalize `MealStream` from use case 2 into `LogStream<T>` so meal and activity share a base class. Both have the same lifecycle: open on first signal, extend on confirming signals, close on timeout or place exit.

**Test plan:**
- Feed: enter school geofence → 3 frames of desk + laptop at 14:00, 14:30, 15:05 → exit geofence at 15:30. Assert one activity log, type `work`, start 14:00, end 15:30, environment indoor.
- Edge: 14:00 desk, 14:15 sandwich + still at desk, 14:30 desk → assert one work log spanning 14:00-14:30 *and* one meal log at 14:15.

---

## Use case 8 — Dinner-forgetting nudge with pantry + nutrient gaps

> 6pm planned dinner, still working at 6:30. "Dinner time was 6pm — you're low on vitamin K, we have natto, and your bell peppers are on the way out, use them."

**Trigger source:** add a `mealReminderAlarm` similar to `scheduleMorningWakeup`. Schedule for each planned meal time pulled from `materializeSchedule()`. Fire only if no meal log exists for that meal block.

**Pipelines/phases:**
- `getPantry()` (already in profileApi) — list of items + freshness.
- `scanFridge()` returns `nutrientGaps` — wire it in (currently stubbed).
- New: **nudge composer** prompt that takes pantry + gaps + freshness → suggests a dish. Single brain.text() call.
- TTS delivery.

**What to reuse:** alarmScheduler, pantry api, materializeSchedule.

**What to build:**
1. `nutrientGapTracker.ts` — runs at end of day (and on demand) and computes top 3 gaps vs recommended intake (already supported by `data/commonFoods.ts` nutrient tables). Persist to profile.
2. `dinnerNudgeComposer.ts` — builds the prompt and calls `brain.text()`.
3. `scheduleMealReminders()` in alarmScheduler — fires for breakfast/lunch/dinner if not yet logged ~30 min after their planned time.

**Test plan:**
- Mock: it's 6:30pm, planned dinner was 6pm, no MealLog with `mealType=dinner` exists today → assert nudge.
- Mock: pantry has natto + peppers (freshness `use_soon`), gaps include vitamin K + vitamin C → assert composer mentions both.
- Verify it doesn't double-fire if user has already eaten.

---

## Use case 9 — Grocery + cooking pantry sync

> Shopping: log items going into basket. Cooking: decrement on use. Plus: if a frame uses something not in the pantry, that's a "missed" item — add it.

**Trigger source:** kitchen frames (already routed through triage in use case 2) AND **grocery-store frames** (place tagged as a known store, or scene with shopping cart / store shelves).

**Pipelines/phases:**
- `pantry/identify.ts` already returns items with `storageLocation`. Perfect for "in basket / on shelf."
- Triage will route fridge/grocery frames to `pantry`, cooking frames to `meal` — which is already correct.
- **New: pantry reconciliation phase** — after `pantry/identify`, diff against `getPantry()` and produce `additions[]` and `confirmations[]`.
- **New: pantry decrement on cook** — when a `MealStream` closes, for each ingredient in the meal that maps to a pantry item, decrement the quantity. Lightweight name-matcher (you can borrow `commonFoods.ts` aliases).

**What to reuse:** all of pantry pipeline + the meal stream.

**What to build:**
1. `pantryReconcile.ts`: `identify` output → `add/update/confirm` operations.
2. `pantryDecrement.ts`: meal items → pantry deltas. For now, just decrement count by 1 / mark "used today"; portion math is a phase-2 nicety.
3. **"Phantom ingredient" detector**: if a meal includes an ingredient not in pantry, prompt the pantry reconciler to add it ("seems like she has almonds — I didn't know"). Confidence-gate (don't add on a single fuzzy ID).

**Test plan:**
- Mock: grocery store frame → identify returns [bell pepper x3, kefir x1] → pantry gains 3 peppers + 1 kefir.
- Mock: meal frame containing almonds (not in pantry) → pantry gains "almonds" with low confidence + check-by today.
- Cook frame uses 1 pepper → pantry count drops 3 → 2.

---

## Use case 10 — Bedtime hygiene nudge

> "Susanna you should brush your teeth and shower, it's almost bedtime."

Smallest use case. Mostly a config check.

**Trigger source:** add a `scheduleBedtimeHygieneNudge()` to alarmScheduler. Fires T-30 min before `bedtimeUtc` from `materializeSchedule()`.

**Pipelines/phases:** none.

**What to reuse:** `materializeSchedule()`, alarmScheduler patterns.

**What to build:**
- Single new alarm-type entry: `'bedtime_hygiene'`. Composer reads `profile.memory.routines` for a personalized phrasing.
- Optional: if pendant frames after the nudge still show "at desk," follow up at T-10 with a firmer version.

**Test plan:** set bedtime 32 min from now → assert nudge in 2 min.

---

## Cross-cutting infrastructure (shared across use cases)

These are the load-bearing pieces. If you build them once, several use cases unlock at once.

### A. Pendant motion frames → triage (the missing wire)

Right now `usePendantBridge.onMotionFrame` writes to `pendantStore` and stops. Add:

```
unsubMotion = service.onMotionFrame(async (framePath) => {
  pendantStore.addCapture({ type: 'MOTION', timestamp: Date.now(), framePath });
  // NEW: also feed to triage
  const runner = getOrCreatePipelineRunner();
  const triageResult = await triage([framePath], '');
  for (const intent of triageResult.intents) {
    runner.runIntent(intent, { photos: [framePath], source: 'pendant_motion' });
  }
});
```

This single change unlocks #2, #3, #7, #9 simultaneously.

### B. `LogStream<T>` — open/extend/close lifecycle

Generic over meal and activity. Methods:
- `open(initialContext)` — first frame that says "this is happening"
- `extend(newContext)` — subsequent confirming frames augment, don't create new logs
- `closeOnIdle(timeoutMs)` — auto-close
- `closeOnPlaceExit()` — fires when locationService says geofence-exit

Lives in `lib/services/streams/LogStream.ts`. Used by `MealStream` and `ActivityStream`.

### C. `mittensAsk(question)` — ask, then wait for button-press answer

The key proactive primitive. The user still drives the conversation:
1. `speak(question)` via TTS.
2. Arm a one-shot listener for the next pendant double-tap event (push-to-talk audio + frame).
3. When the user presses the pendant button and speaks, the existing bridge path handles transcription and routing.
4. The listener registers the resulting transcript as the answer to the open question; auto-deregister after ~60s if no press arrives, with a follow-up "no answer received" log entry.

**No firmware change.** Reuses the existing double-tap flow end-to-end. Trade-off: the user has to physically press the pendant to respond, which we decided is the right behavior — no hot-mic, no listening surprise, and zero new BLE/firmware surface area.

### D. Memory write-back

`memoryUpsert(transcript, signalType)` reads the user's answer, asks the brain (small prompt) "is there a stable preference here? if so, in what category?" and appends to `profile.memory[category]`. Idempotent — checks for near-duplicates before adding.

### E. Sedentary watcher

Background task. Profile field `workIntervalMins` already exists. Use case 4 needs this; use cases 1 and 10 also depend on similar background polling — consider a single `bodyStateWatcher` that emits events `still_asleep`, `sedentary`, `time_to_bed` and let each use case subscribe.

### F. Calendar + pantry-aware nudge composer

Use case 5 (departure with prep) and 8 (dinner with nutrient gap) share the structure: read calendar + pantry + goals → brain.text() → speak. Centralize into `nudgeComposer.ts` so the prompt template lives in one place.

### G. GPS-gated capture (CAPTURE_PAUSE / RESUME)

Firmware-side flag + app-side motion subscription. Saves battery and prevents motion-blur garbage frames from polluting triage.

---

## Order to build

If I had to sequence this so each step unlocks the next:

1. **A. Motion frames → triage** (2 hours). Smallest change, biggest unlock. Test by walking around your kitchen with the pendant on.
2. **G. GPS-gated capture** (~half a day; firmware + app). So your battery survives long enough to test #1.
3. **B. `LogStream<T>` + `MealStream`** (1 day). Unlocks #2, #3, #7, #9.
4. **D. Memory write-back** (~3 hours). Needed before clarifier-driven memory makes sense.
5. **C. `mittensAsk`** (1 day, mostly firmware test cycle). Unlocks the kefir-vs-yogurt flow and is the foundation for *all* proactive use cases.
6. **E. Sedentary watcher** (½ day). Use case 4.
7. **F. Nudge composer** (½ day). Use cases 5, 8, 10.
8. Polish: bedtime hygiene (10), nutrient-gap tracker (8), pantry reconcile/decrement (9).

---

## Testing strategy (overall)

Three test surfaces, each cheap to add:

**Unit:** every new module gets tests with mocked inputs. `LogStream.extend()` doesn't open a second log → test. `wakeupCheck()` with stationary phone + zero IMU events → returns "not up" → test. `pantryDecrement` on a known meal → expected pantry delta → test.

**Pipeline replay harness:** make a directory `mittens_pendant/replays/` with saved frame sequences (json: `[{ time, framePath }]`). A CLI `npm run replay <name>` feeds frames into the triage pipeline in order with simulated timestamps. This is how you regression-test "yogurt+almonds+sunflower" without re-pouring kefir each iteration. Hook it into the runner via the existing `PipelineLogger` so the output is auditable.

**On-device dry runs:** five real-world scenarios scripted in the README, each with a "what should fire" expectation:
- Morning: leave pendant on desk, sleep through alarm → expect yell.
- Kitchen: make breakfast with low-confidence item → expect clarifier.
- Desk: 50 min of typing, no breaks → expect break nudge.
- Lunchtime + no meal logged → expect dinner-style nudge.
- Walk to the park: phone moves → pendant stops capturing → trail logged.

Each scenario gets a row in a results table you fill in after the run. Cheap, but it's the only way to catch the integration weirdness that pure unit tests miss.

---

## Open questions for you

- For the **yell** in #1: do you actually want elevated volume (which requires native module work), or is the pendant LED flash + buzz pattern enough alongside normal-volume TTS?
- For #6, do you want **(a) IMU classifier on the pendant** (better but firmware-heavy) or **(b) phone accelerometer cadence** (faster to ship, less accurate) first?
- For #9, **pantry decrement on cook**: portion-aware (1 pepper used of 3) or just "marked as used today"? The first is more useful long-term but requires portion mapping.
