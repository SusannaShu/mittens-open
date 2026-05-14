# Mittens Pendant: Ambient Intelligence Pipeline

Implementation plan aligned with [wireup_use_cases.md](file:///Users/susannahuang/Documents/GitHub/mittens-open/mittens_pendant/wireup_use_cases.md).

All work targets `mittens-open`. Gemma only (E2B on-device / Gemma 26B self-hosted). Pendant mic for all audio via existing push-to-talk.

---

## Architecture: Design v2 Decisions

### 1. Unified SceneStream (not separate Meal/Activity streams)

One `Scene` per continuous engagement. Opens on first qualifying frame, extends on confirming frames, closes on multi-signal evidence. The Scene carries everything:

```typescript
interface Scene {
  id: string;
  openedAt: number;
  lastActiveAt: number;
  closedAt?: number;
  closeReason?: 'geofence_exit' | 'scene_change' | 'timeout' | 'user';
  
  type: SceneType;       // 'meal_prep' | 'work' | 'commute' | 'eating' | ...
  subPhase: SubPhase;    // 'prep' | 'cook' | 'eat' | 'cleanup' | 'active'
  place?: string;
  
  // Populated incrementally across frames
  aeiou: Partial<AEIOUResult>;
  environment?: EnvironmentResult;
  
  // Food-specific (populated when type involves food)
  food?: {
    ingredients: FoodItem[];
    method?: string;
    cookStartAt?: number;
    cookFinishAt?: number;    // one-shot timer fires here
    plateAt?: number;
    methodRecommendation?: { method: string; score: number; reason: string };
  };
  
  eatingContext?: EatingContext;
  pantryDeltas: Array<{ name: string; qtyChange: number; reason: string }>;
  
  // Frames that built this scene
  frameCount: number;
  framePaths: string[];     // all pendant vision frames during this scene
  lastFramePath?: string;
}
```

### 2. Event-driven, no polling

Every in-progress scene carries `openedAt`, `lastActiveAt`, and scheduled one-shot timers. Checks happen **only when new evidence arrives** (pendant frame, GPS update, transcript):

- Work scene opened at 14:00. New frame at 14:46 still classifies as work. After-frame handler checks `now - openedAt >= 45min` -> fires break nudge.
- Cook scene: method "baking salmon" identified -> set `cookFinishAt = now + 20min` as a one-shot `expo-notifications` scheduled local notification. Not a poll.
- The only true scheduled triggers: cook timers, pre-meal nudges, bedtime nudges. Everything else is reactive.

### 3. Scene close -- multi-signal, not idle-timeout

Triggered on new evidence, not on a clock:

| Signal | Closes |
|--------|--------|
| Geofence exit | Any scene, hard close |
| Food plated / utensil in hand / user at table | `meal_prep` -> transitions to `eating` subPhase |
| Plate empty x2 frames / user at sink / utensils down + 5min no eating (checked on NEXT frame) | `eating` closes |
| `cookFinishAt` timer fires + user in kitchen | "your salmon is done" voice nudge |
| `cookFinishAt` timer fires + user NOT in kitchen | "your salmon is gonna burn" voice nudge |
| Laptop not visible / user >5m from desk / place exit | `work` closes |
| 30min no qualifying frame | Safety net close with `closeReason: 'timeout'`, marked low-confidence |

### 4. Capture cadence -- firmware-level, not skip-classify

> [!IMPORTANT]
> This is the answer to "should we skip classification when active." **No.** When stationary, always classify every frame. The cadence change happens at the firmware level:

| Phone GPS | Worn? | Pendant mode | Capture trigger |
|-----------|-------|-------------|----------------|
| Stationary, known place | Yes | PASSIVE (default) | IMU motion events -- dense, classify every frame |
| Stationary, unknown place | Yes | PASSIVE | IMU motion events, every 5 min fallback |
| Moving | Yes | ACTIVE (phone-driven) | Phone sends `CMD:CAPTURE` on each GPS trail dot (~10m) |
| Moving | No | N/A | No captures, GPS trail only |

When motion changes a lot (walking around kitchen, fidgeting at desk), the pendant captures on IMU motion events -- that is fine and expected. The "cramming pics" problem only happens during actual transit (GPS displacement > 50m/min).

When stationary (cooking, working, eating), every frame gets classified because **that is how Mittens understands what is happening.** The cooking-then-working scenario requires seeing every transition.

### 5. Cooking-then-working interleave

This is the salmon case. User starts cooking, goes to desk while waiting for beef/salmon to finish:

1. Kitchen frame -> scene opens: `type: 'meal_prep'`, `subPhase: 'cook'`
2. Method identified: "baking salmon, ~20min" -> `food.cookFinishAt = now + 20min`, schedule one-shot notification
3. User walks to desk -> new frame at desk -> **new scene opens**: `type: 'work'`, `subPhase: 'active'`
4. The `meal_prep` scene stays open (not closed -- no geofence exit, same home). It has a pending `cookFinishAt` timer.
5. Timer fires at +20min -> check current location. User at home -> voice: "your salmon is done"
6. User returns to kitchen -> work scene gets frames that don't match "work" anymore. After 2 non-matching frames -> work scene closes with actual end time.
7. Kitchen frame shows plated food -> meal_prep transitions `subPhase: 'eat'`

**Multiple scenes can be open simultaneously at the same place.** The sceneStream manager tracks them by type. New frame -> check against all open scenes -> extend the one that matches, or open a new one if no match.

### 6. Three-tier memory retrieval

E2B context is small (~8K tokens). Can't dump all memory. Most kitchen frames are unambiguous.

**Tier 1 -- Free, SQL only, always runs:**
- Yogurt machine in frame -> fetch `food.machine_setup` notes from last 48h
- Fridge open at home -> fetch current pantry state
- Cooking detected -> fetch `routines.cooking_methods`

**Tier 2 -- One tiny brain.text() call (memory index + scene descriptor):**
- Input: 1-line memory summaries (30 entries ~800 tokens) + scene descriptor
- Output: `{ useIds: [1], reason: "kefir vs yogurt ambiguity" }` or `{ useIds: [] }`
- Cache: descriptor-hash -> memory-IDs. Invalidate on memory change.

**Tier 3 -- Identify with retrieved notes:**
- Final identify call gets tier1 + tier2 notes as short preamble. Stays inside E2B budget.

### 7. mittensAsk via push-to-talk (no auto-record)

When Mittens asks a question:
1. `speak(question)` via TTS
2. Arm a one-shot listener for the next pendant double-tap event (push-to-talk)
3. User presses pendant button and speaks -> existing bridge handles audio -> brain processes
4. Listener registers transcript as answer; auto-deregisters after 60s if no press

**Zero firmware change.** Reuses existing double-tap flow entirely. The user physically presses the button to respond -- preserves user agency, no hot-mic surprise.

### 8. Pre-meal nudges for all three meals

Schedule pre-meal nudges from `materializeSchedule()`:
- Check overlapping calendar events -> compute `event.start - travelMins - prepMins - buffer`
- No overlap -> fire at `mealTime - prepMins - buffer`
- `prepMins` is a profile setting with per-meal override (breakfast 10, lunch 25, dinner 30)
- Scheduled via `expo-notifications` at app boot. Re-evaluated on calendar change.

### 9. Smart pantry with portion estimation

Per ingredient identified during meal_prep, the brain estimates quantity from vision:
- "3 almonds" -> decrement almonds by 3, estimate remaining from last known qty
- "half an avocado" -> decrement avocados by 0.5
- "a handful of sunflower seeds" -> estimate ~30g, decrement accordingly

Portion confidence levels:
- **high**: countable items (3 almonds, 2 eggs) or standard units (1 cup, 1 tbsp)
- **medium**: visual estimation of pourable/scoopable items (a handful, a splash)
- **guess**: bulk items where vision cannot determine quantity (some rice, oil drizzle)

Pantry entry structure:
```typescript
interface PantryItem {
  name: string;
  qty: number;
  unit: string;           // 'count' | 'g' | 'ml' | 'cups'
  lastAddedQty: number;   // for running_low threshold
  lastUsedAt: string;
  confidence: 'high' | 'medium' | 'guess';
  runningLow: boolean;    // qty < 0.3 * lastAddedQty
}
```

Rules:
- **In pantry** -> decrement by estimated amount. Below 30% of `lastAddedQty` -> mark `running_low` for grocery nudge.
- **Not in pantry** -> user clearly has it. Add with estimated qty + `confidence: 'guess'` so UI shows badge.
- **Inventory glance**: fridge-open / shelf-open frame -> identify all visible items, reconcile against pantry.
- **Zero or negative qty** -> mark as "needs restocking", don't delete (user might have more than detected).

### 10. GPS-synced captures during movement (trail photos)

Instead of time-based captures during movement, sync pendant captures with GPS trail dots. Each trail dot on the Places map gets a pendant photo.

**How it works:**

1. Phone detects motion start (confirmed by `confirmMotionStart()` -- GPS displacement > 10m)
2. Phone sends `CMD:ACTIVE` to pendant via BLE
3. Pendant enters ACTIVE mode: disables IMU-triggered captures, stays awake, listens for BLE commands
4. Each time `handleSignificantLocationChange()` fires in [locationService.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/services/location/locationService.ts) (every `TRAIL_POINT_DISTANCE_M = 10` meters), the captureGate also sends `CMD:CAPTURE` to pendant
5. Pendant snaps one JPEG, BLE transfers it back
6. Phone saves frame tagged with `{lat, lon, timestamp, framePath}` in `location_logs`
7. When motion ends (stationary 2+ min), phone sends `CMD:PASSIVE` -- pendant returns to IMU-triggered captures

**Firmware modes:**
```
PASSIVE (default -- stationary):
  IMU motion -> wake -> camera -> BLE transfer (current behavior)
  
ACTIVE (phone-driven -- moving):
  Disable IMU camera trigger
  Wait for CMD:CAPTURE via BLE -> camera -> BLE transfer
  IMU still tracks worn-detection but does not trigger captures
```

**App-side hook point** -- [logLocationPoint()](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/services/location/locationService.ts#L294-L311):
```typescript
function logLocationPoint(entry) {
  // ... existing trail point recording ...
  
  // If pendant is in active mode and worn, snap a photo at this GPS point
  if (captureGate.isActiveMode()) {
    pendantService.sendCommand('capture');
    // Photo comes back async via onMotionFrame callback
    // Tagged with this GPS coordinate by captureGate
  }
}
```

**Trail UI** -- When user taps a GPS dot on the trail in Places tab, show the pendant photo taken at that location. Each `location_logs` row gets an optional `frame_path` column. The map view queries photos by time range overlapping the trail segment.

### 11. Pendant vision frames attached to meal and activity logs

Every pendant frame captured during a Scene gets stored in `scene.framePaths[]`. When a Scene closes and writes to `nutrition_logs` or `activity_logs`, all frame paths are included:

**Meal logs**: `nutrition_logs.image_uris` already exists (JSON array, [line 58 of database.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/database.ts#L58)). Currently populated from user chat messages (camera/gallery picks). Pendant vision frames go into the same column -- when a `meal_prep` or `eating` scene closes, its `framePaths[]` are written to `image_uris`.

**Activity logs**: `activity_logs` currently has `meta TEXT` but no dedicated image column. Add `image_uris TEXT` (same pattern as nutrition_logs) via `ALTER TABLE`.

**How frames flow into logs:**
```
Scene opens (meal_prep at kitchen)
  -> frame 1 (pouring kefir): framePaths = ['/path/to/frame1.jpg']
  -> frame 2 (adding almonds): framePaths = ['/path/to/frame1.jpg', '/path/to/frame2.jpg']
  -> frame 3 (eating):         framePaths = [..., '/path/to/frame3.jpg']
Scene closes
  -> writes nutrition_log with image_uris = JSON.stringify(scene.framePaths)
```

**UI impact**: The existing meal detail/edit view in the app already reads `imageUris` from [nutritionApi.ts line 31](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/services/nutritionApi.ts#L31) and renders thumbnails. Pendant vision frames will show up automatically -- same rendering, just more photos per log entry. When user opens a cooking log, they see the progression: pouring kefir -> adding almonds -> plated meal.

For activity logs, the same pattern applies. A `work` scene at school from 2-3pm closes with 4 desk frames attached. Opening the activity log shows what the workspace looked like.

### 12. Pipeline debug trace in pendant-triggered logs

Every pendant-triggered log entry (meal, activity, or scene) stores the full `PipelineLog` from its processing. The existing [PipelineLogBubble](file:///Users/susannahuang/Documents/GitHub/mittens-open/components/chat/PipelineLogBubble.tsx) component (already built for chat messages) renders an expandable trace showing:

- **Triage classification**: what the frame was classified as (food/activity/scene type)
- **Pipeline phases**: each processing step with status, timing, and result summary
- **Brain calls**: which brain (E2B/Gemma26B) was used, inference latency
- **Scene lifecycle**: scene open/extend/close decisions with reasons

The `PipelineLog` is stored in:
- `pendant_scene_log.metadata` (JSON blob, already in schema)
- `nutrition_logs` via a new `pipeline_log TEXT` column
- `activity_logs` via a new `pipeline_log TEXT` column

In the Mittens messages tab, pendant-triggered entries render with the same expandable debug bubble as chat-triggered pipeline runs. Collapsed: "4 phases -- 2.3s [E2B]". Expanded: phase-by-phase breakdown with triage result, scene classification confidence, memory retrieval tier used, and any errors.

The [PipelineLogger](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/pipelines/logger.ts) already supports `startPhase/completePhase/failPhase/skipPhase` and `summarizeResult` for food/activity/pantry domains. For pendant scenes, add new summary cases:
```typescript
case 'scene:classify': return `${data.sceneType} / ${data.subPhase} (conf: ${data.confidence})`;
case 'scene:extend': return `Extended ${data.sceneType}, frame #${data.frameCount}`;
case 'scene:close': return `Closed: ${data.closeReason}, ${data.frameCount} frames`;
case 'memory:retrieve': return `Tier ${data.tier}, ${data.notesUsed} note(s)`;
case 'pantry:decrement': return `${data.item} -${data.qty}${data.unit}, ${data.remaining} left`;
```

---

## Proposed Changes

### New Files

#### A. Motion frames -> triage (the missing wire)

#### [MODIFY] [usePendantBridge.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/hooks/pendant/usePendantBridge.ts)

The single most important change. Currently line 192-201 just stores the frame:

```diff
 unsubMotion = service.onMotionFrame(async (framePath: string) => {
   pendantStore.addCapture({ type: 'MOTION', timestamp: Date.now(), framePath });
+  // Route through ambient pipeline
+  const { getSceneStreamManager } = require('../../services/ambient/sceneStreamManager');
+  const manager = getSceneStreamManager();
+  manager.onPendantFrame(framePath, Date.now());
 });
```

---

#### [NEW] `lib/services/ambient/types.ts`
Scene types, sub-phases, capture cadence config, voice prompt types.

#### [NEW] `lib/services/ambient/scene.ts`
The `Scene` data class and scene-level operations: open, extend, transition subPhase, close. Writes to `pendant_scene_log` in SQLite on close.

#### [NEW] `lib/services/ambient/sceneClassifier.ts`
Wraps E2B `vision()` with a compact prompt. Returns `{ sceneType, subPhase, items[], confidence }`. Uses phone context (place, motion) to narrow the prompt. Handles the three-tier memory retrieval before classification when needed.

#### [NEW] `lib/services/ambient/sceneStreamManager.ts`
The "brain" of the ambient loop. Tracks all open scenes. On each new frame:
1. Classify frame via `sceneClassifier`
2. Check against all open scenes -- does it match any?
3. If match -> `scene.extend(newContext)` -> check after-frame triggers (sedentary, cook timer)
4. If no match -> close stale scenes (multi-signal check), open new scene
5. On scene close -> route to existing pipelines (food/activity/pantry) to create actual log entries

#### [NEW] `lib/services/ambient/mittensAsk.ts`
The proactive question primitive. `ask(question, timeoutMs = 60000)`: speak via TTS, arm one-shot listener for next double-tap, return Promise that resolves with the audio response or rejects on timeout. Reuses existing `onButtonPress` callback.

#### [NEW] `lib/services/ambient/memoryUpsert.ts`
`upsert(transcript, signalType)`: asks brain (small prompt) "is there a stable preference here? category?" and appends to `profile.memory[category]`. Checks for near-duplicates before adding.

#### [NEW] `lib/services/ambient/captureGate.ts`
Manages pendant capture modes:
- On motion start: sends `CMD:ACTIVE` to pendant (disables IMU captures), subscribes to `locationService.onLocationChange()` to send `CMD:CAPTURE` on each trail dot
- On stationary 2+ min: sends `CMD:PASSIVE` (re-enables IMU captures)
- Tracks current mode and tags incoming frames with GPS coordinates when in ACTIVE mode
- Coordinates with `sceneStreamManager` so trail-captured frames still get classified

#### [NEW] `lib/services/ambient/nudgeComposer.ts`
Shared prompt template for calendar + pantry + goals -> `brain.text()` -> voice output. Used by departure alarms (UC5) and dinner nudges (UC8).

#### [NEW] `lib/services/ambient/wearDetector.ts`
`isWorn()`: pendant connected AND any MOTION event in last N minutes. Used by wakeup check (UC1).

---

### Modified Files

#### [MODIFY] [database.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/database.ts)
Add `pendant_scene_log` table + index, add `image_uris` to activity_logs, add `frame_path` to location_logs:
```sql
CREATE TABLE IF NOT EXISTS pendant_scene_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_type TEXT NOT NULL,
  sub_phase TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  close_reason TEXT,
  place_name TEXT,
  latitude REAL,
  longitude REAL,
  items TEXT,          -- JSON array of identified items
  frame_paths TEXT,    -- JSON array of pendant vision frame file paths
  pantry_deltas TEXT,  -- JSON array of pantry changes
  frame_count INTEGER DEFAULT 0,
  metadata TEXT,       -- JSON blob for food/eating/aeiou data
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scene_log_started ON pendant_scene_log(started_at);

-- Migration: add image_uris to activity_logs (nutrition_logs already has it)
ALTER TABLE activity_logs ADD COLUMN image_uris TEXT;

-- Migration: add frame_path to location_logs for trail photos
ALTER TABLE location_logs ADD COLUMN frame_path TEXT;
-- Migration: add pipeline_log to nutrition_logs and activity_logs for debug trace
ALTER TABLE nutrition_logs ADD COLUMN pipeline_log TEXT;
ALTER TABLE activity_logs ADD COLUMN pipeline_log TEXT;
```

#### [MODIFY] [runner.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/pipelines/runner.ts)
Add `source: 'pendant'` to `PipelineInput` type. When source is pendant, the food pipeline writes to `nutrition_logs` with `source = 'pendant'` and `image_uris` populated from pendant frames. Activity pipeline writes to `activity_logs` with `image_uris`.

#### [MODIFY] [nutritionApi.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/services/nutritionApi.ts)
Update `logConfirmed()` to accept and persist `imageUris` parameter (currently the INSERT ignores `image_uris` column).

#### [MODIFY] [locationService.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/services/location/locationService.ts)
In `logLocationPoint()`: when `captureGate.isActiveMode()`, send `CMD:CAPTURE` to pendant and associate the incoming frame with this GPS point's `location_logs` row via `frame_path` column.

#### [MODIFY] [types.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/pipelines/types.ts)
Add `PendantFrameInput` and `SceneType` types.

#### [MODIFY] [alarmScheduler.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/services/schedule/alarmScheduler.ts)
- `generateMorningWakeup()`: check `wearDetector.isWorn()` + pendant IMU state, use TTS voice
- Add `scheduleMealReminders()` for breakfast/lunch/dinner pre-meal nudges
- Bedtime: voice output path

#### [MODIFY] [logger.ts](file:///Users/susannahuang/Documents/GitHub/mittens-open/lib/pipelines/logger.ts)
Add `summarizeResult` cases for scene/memory/pantry domains so the PipelineLogBubble renders useful summaries for pendant-triggered pipeline runs.

#### [MODIFY] [pendant_main.ino](file:///Users/susannahuang/Documents/GitHub/mittens-open/mittens_pendant/firmware/pendant_main/pendant_main.ino)
Add BLE command handler cases in `PendantCommandCallback::onWrite()`:
- `mode:active` -- enter ACTIVE mode: set `captureMode = ACTIVE`, disable IMU-triggered camera grabs, stay awake listening for BLE capture commands
- `mode:passive` -- return to PASSIVE mode: set `captureMode = PASSIVE`, re-enable IMU-triggered captures (current default behavior)
- `capture` -- immediate capture: take one JPEG, BLE transfer back (works in any mode but designed for ACTIVE mode use)

In `loop()`, modify IMU interrupt handler:
```cpp
if (g_int1Fired || g_int2Fired) {
  // In ACTIVE mode, skip camera on IMU motion -- phone controls captures
  if (captureMode == ACTIVE) {
    g_int1Fired = false;
    g_int2Fired = false;
    lsmRead(LSM6DS3_TAP_SRC);
    lsmRead(LSM6DS3_WAKE_UP_SRC);
    resetIdleTimer();  // still counts as activity (worn detection)
    return;
  }
  // ... existing PASSIVE mode handling ...
}
```

#### [MODIFY] [ble_signal.h](file:///Users/susannahuang/Documents/GitHub/mittens-open/mittens_pendant/firmware/pendant_main/ble_signal.h)
Extend `PendantCommandCallback::onWrite()` to parse `mode:active`, `mode:passive`, and `capture` commands alongside existing `wifi:` handler.

---

## Build Order

Following [wireup_use_cases.md](file:///Users/susannahuang/Documents/GitHub/mittens-open/mittens_pendant/wireup_use_cases.md) section "Order to build":

### Step 1: Motion frames -> triage (~2 hours)
Smallest change, biggest unlock. Modify `usePendantBridge.ts` line 192 to also feed frames into triage. Create minimal `sceneStreamManager.ts` that receives frames, classifies, and logs.

**Unlocks:** UC2, UC3, UC7, UC9 simultaneously start getting data.

### Step 2: GPS-gated capture (~half day, firmware + app)
`captureGate.ts` + firmware `CAPTURE_PAUSE/RESUME`. So battery survives long enough to test step 1.

**Unlocks:** UC6.

### Step 3: SceneStream (~1 day)
`scene.ts` + full `sceneStreamManager.ts` with open/extend/close lifecycle. Replaces the naive "triage every frame as independent" with the accumulating scene model.

**Unlocks:** UC2 (meal accumulation), UC3 (eating context), UC7 (work sessions).

### Step 4: Memory write-back (~3 hours)
`memoryUpsert.ts`. Needed before clarifier answers ("I always get kefir") make sense as persistent knowledge.

### Step 5: mittensAsk (~1 day, mostly testing)
`mittensAsk.ts`. The proactive question primitive. Wraps TTS + double-tap listener. Test with the kefir/yogurt scenario.

**Unlocks:** UC2 clarifier, any future proactive question.

### Step 6: Sedentary watcher / event-driven timers (~half day)
After-frame checks in `sceneStreamManager` for `work_interval_mins` threshold. Voice nudge with goal rotation from memory.

**Unlocks:** UC4.

### Step 7: Nudge composer (~half day)
`nudgeComposer.ts`. Shared by UC5 (departure + lunch prep) and UC8 (dinner + nutrient gaps).

**Unlocks:** UC5, UC8.

### Step 8: Polish
- UC1: wakeup with `wearDetector` + TTS voice
- UC10: bedtime hygiene nudge
- UC8: `nutrientGapTracker` for real gap computation
- UC9: `pantryReconcile` + smart `pantryDecrement` with portion estimation
- Pipeline debug trace in pendant-triggered log entries (PipelineLogBubble)

---

## Resolved Decisions

- **Wakeup volume**: Just use `expo-speech` TTS at normal system volume. No special volume mechanism needed.
- **Pantry decrement**: Smart portion estimation from day 1 -- brain estimates qty used from vision, tracks remaining.
- **Phone motion detection bugs**: Already fixed and tested. `phoneMotionClassifier.ts` and `locationService.ts` changes are merged in the current codebase.

---

## Verification Plan

### Pipeline replay harness
Create `mittens_pendant/replays/` with saved frame sequences (JSON: `[{ time, framePath }]`). A script feeds frames into the triage pipeline with simulated timestamps. Test "yogurt+almonds+sunflower" without re-pouring kefir.

### On-device dry runs
5 real-world scenarios:

| Scenario | Expected |
|----------|---------|
| Morning: pendant on desk, sleep through alarm | Wakeup voice fires |
| Kitchen: make breakfast with low-confidence item | Clarifier asks, memory persists answer |
| Desk: 50 min typing, no breaks | Break nudge fires |
| Lunchtime + no meal logged | Pre-meal nudge fires |
| Walk to park: phone moves | Pendant enters ACTIVE mode, captures sync with GPS trail dots, each dot shows photo |
| Open a meal log created by pendant | Shows vision frame thumbnails + expandable pipeline trace |

### Database verification
```sql
-- Scene logs with pipeline trace
SELECT scene_type, frame_count, close_reason,
       json_extract(metadata, '$.pipelineLog.totalDurationMs') as pipeline_ms
FROM pendant_scene_log ORDER BY created_at DESC LIMIT 20;

-- Auto-logged meals with photos and pipeline log
SELECT log_name, image_uris, pipeline_log
FROM nutrition_logs WHERE source = 'pendant' ORDER BY created_at DESC;

-- Auto-logged activities with photos
SELECT log_name, image_uris, pipeline_log
FROM activity_logs WHERE source = 'pendant' ORDER BY created_at DESC;

-- Pantry with portion tracking
SELECT name, qty, unit, confidence, running_low
FROM pantry_items WHERE updated_at > datetime('now', '-1 day');

-- Trail photos
SELECT latitude, longitude, frame_path
FROM location_logs WHERE frame_path IS NOT NULL ORDER BY recorded_at DESC;
```
