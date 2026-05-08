# Life Metabolism Engine + Motion Intelligence

Research and architecture for implementation in a separate conversation.

**Gemma**: Verified on Pixel 7a (text: 2.1s, vision: 23.8s). Local-first data layer in progress.

---

## Part 1: Two-Layer Location Data (Clarified)

### Layer 1: Location Logs (INSTANT, for visualization)

Location logs record continuously and instantly, regardless of activity state. They serve the map and calendar:

```
Every 30m move or significant change:
  → IMMEDIATELY log to location_logs table
  → Map trail updates in real-time
  → Calendar shows continuous location line on Reflect tab
  → This is JUST coordinate data with timestamps
```

### Layer 2: Activity Logs (DEFERRED, from location pattern)

Activity logs are higher-level summaries created FROM location logs when the user becomes stationary:

```
Motion lifecycle:
  1. User starts moving (AR: RUNNING at 8:02 AM)
  2. Location logs record every 30m move → map trail builds
  3. Calendar shows running line on Reflect tab in real-time
  4. User stops moving (AR: STILL at 8:34 AM)
  5. User stays stationary for threshold (e.g. 2-5 min)
  6. THEN: Create activity log:
     - Activity type: Running (87% confidence, AR API)
     - Duration: 32 min
     - Path: aggregated from location_logs between 8:02-8:34
     - Location: Central Park (matched to known place)
     - Nutrient impact: computed from activity profile
  7. Activity log appears in Today tab
  8. If proactiveness ON → chat card sent
```

This means:
- Map trail and calendar line are ALWAYS live and current
- Activity logs only appear after the movement session concludes
- User sees the trail building on the map/calendar, then gets the summarized activity log after

---

## Part 2: Motion Detection (Cross-Platform)

### Current Problem

`locationService.ts` line 174-182 uses GPS speed only:
```typescript
const speedKmh = location.coords.speed * 3.6;
if (speedKmh < 2) motionType = 'stationary';
else if (speedKmh < 8) motionType = 'walking';
// ... noisy, can't distinguish running vs fast walking
```

### Fix: Native Activity Recognition

| | iOS | Android |
|---|---|---|
| **API** | `CMMotionActivityManager` | Activity Transition API |
| **ML** | M7+ motion coprocessor | Sensor fusion (acc+gyro+mag+bar) |
| **Detects** | walking, running, cycling, automotive, stationary | WALKING, RUNNING, ON_BICYCLE, IN_VEHICLE, STILL |
| **Battery** | Near zero (hardware) | Near zero (event-driven) |

Start with `react-native-motion-activity-tracker` (cross-platform), move to custom Expo modules later if needed.

---

## Part 3: AEIOU -- Good Time Journal (Corrected)

### The Framework

AEIOU is Stanford Life Design's structured observation method from the **Good Time Journal** (Burnett & Evans, *Designing Your Life*). It's an ethnographic self-reflection tool for discovering what brings you flow, engagement, and energy -- NOT a cortisol questionnaire.

| Letter | Dimension | Purpose |
|---|---|---|
| **A** | Activities | What were you actually doing? Structured or unstructured? Your role? |
| **E** | Environments | Where were you? How did the space affect your mood? |
| **I** | Interactions | Who/what were you interacting with? Formal or informal? |
| **O** | Objects | What tools/devices were involved? Which ones supported engagement? |
| **U** | Users | Who else was present? How did they affect the experience? |

### How It's Already Built (ActivityEditModal)

The modal already has the full Good Time Journal stack:
- **Engagement** (1-10 scale, "Lo → Flow → Hi") -- how absorbed were you?
- **Energy** (-5 to +5, "Drained → 0 → Energized") -- how did it affect your energy?
- **Life Categories** (work/health/play/love weights, normalized to 1.0) -- which life dimensions got attention?
- **AEIOU** (5 free-text fields) -- deep reflection on the experience
- **"Reflect with Mittens"** button → opens chat with activity context for deeper journaling
- **Failure Logs** -- linked insights from past failures related to this activity

### AEIOU's Role in the Metabolism Pipeline

AEIOU data feeds the metabolism engine through **energy ratings**, not as a direct cortisol input:

```
User rates energy: -3 (draining) for "family call"
  → Metabolism engine: cortisol impact = mapped from energy rating
  → Memory learns: "family calls → energy: -3"
  → Future similar activities auto-apply learned energy pattern
  → User can always override via the modal

User rates energy: +4 (energizing) for "coding with music at D12"
  → Metabolism engine: cortisol reduction from positive engagement
  → Memory learns the full AEIOU context:
    A: "Building Mittens feature"
    E: "D12 lab, quiet morning"  
    I: "Solo, deep focus"
    O: "Laptop, headphones"
    U: "Empty lab"
  → Mittens learns: "You're happiest coding solo at D12 in quiet mornings"
```

### Harvard SPIRE Connection (Tal Ben-Shahar)

The AEIOU data naturally maps to SPIRE wellbeing dimensions:

| SPIRE | What Mittens Tracks | Source |
|---|---|---|
| **Spiritual** | Meaning, purpose, presence | Life categories (work/health/play/love weightings) |
| **Physical** | Exercise, nutrition, sleep | Activity logs + nutrition logs + sleep logs |
| **Intellectual** | Curiosity, learning, deep work | Engagement ratings + AEIOU activity descriptions |
| **Relational** | Quality connections | AEIOU interactions + users fields, energy during social |
| **Emotional** | Full emotional range, resilience | Energy ratings, failure log reflections |

SPIRE check-in is implicit: Mittens can surface insights like "Your Relational wellbeing is high this week (3 energizing social activities) but Intellectual is low (no deep work sessions rated >7 engagement)."

---

## Part 4: Cortisol Model (from Energy + Activities + Memory)

### Three Sources (Ranked by Trust)

```
Source 1: USER ENERGY RATING (highest trust)
  User rated energy: -3 on "family call"
  → cortisol_delta = -(energy * 0.5) = +1.5
  → source: "User rated energy: -3"
  → confidence: High

Source 2: MEMORY PATTERN (medium trust)
  Memory: "family calls → avg energy: -3"
  → cortisol_delta = +1.5 (from learned pattern)
  → source: "From memory: family calls avg -3 energy"
  → confidence: Medium
  → Display note: "Based on past ratings. [Rate this one?]"

Source 3: ACTIVITY DEFAULT (low trust, fallback when no data)
  Activity type = "social" → default cortisol = -1.0 (reducing)
  Activity type = "work" → default cortisol = +0.8 (building)  
  → source: "Default estimate for social activities"
  → confidence: Low
  → Never overrides user data or memory
```

### How Energy Ratings Map to Cortisol

```typescript
function energyToCortisol(energy: number): number {
  // energy scale: -5 (drained) to +5 (energized)
  // cortisol scale: positive = cortisol increase, negative = decrease
  // Relationship: draining activities raise cortisol, energizing lower it
  return -energy * 0.4;  
  // energy +5 → cortisol -2.0 (very calming)
  // energy  0 → cortisol  0.0 (neutral)
  // energy -5 → cortisol +2.0 (very stressful)
}
```

---

## Part 5: Failure Log (Separate from Odyssey, Already Built)

The Failure Log is its own life design tool (Burnett & Evans). Three categories:

| Category | Definition | Action |
|---|---|---|
| **Screwups** | One-off mistakes you normally get right | Acknowledge, move on |
| **Weaknesses** | Recurring failures from inherent habits | Manage/avoid trigger situations |
| **Growth Opportunities** | Failures with fixable causes | Identify critical failure → success factor |

Already connected to ActivityEditModal -- failure logs linked to activities show as "FAILURE INSIGHTS" at the bottom of the modal.

---

## Part 6: Sleep Inference

### Multi-Signal Approach (Ranked by Trust)

```
Source 1: MANUAL LOG (100% confidence)
  User logged sleep manually → use as-is

Source 2: APPLE HEALTH (95% confidence, future)
  HKCategoryTypeIdentifierSleepAnalysis from Apple Watch
  → Gold standard for iOS users with wearables

Source 3: ANDROID USAGESTATS + LOCATION (85% confidence)
  Last active app + location stationary at home
  → Requires PACKAGE_USAGE_STATS permission (manual toggle in Settings)

Source 4: LOCATION + APP USAGE INFERENCE (65% confidence)
  Location: stationary at home from 11:30 PM to 7:00 AM
  Last app usage: our app last opened at 11:15 PM
  → Composite signal, decent baseline

Source 5: PROFILE SCHEDULE (30% confidence, fallback)
  User's target bedtime from profile
  → Only used when no other signals available
```

### Sleep Modal Metabolism Display

```
┌─────────────────────────────────────────┐
│ SLEEP LOG                 April 22      │
│ 7h 12min | Good quality                 │
│ Source: Inferred (65%)     [tap: sigs]  │
│                                         │
│ ── METABOLISM IMPACT ──                │
│ Absorption baseline: 95%    [tap: why] │
│ Cortisol reset: Full        [tap: why] │
│ Magnesium: Stable           [tap: why] │
│ Insulin sensitivity: Normal [tap: why] │
│                                         │
│ [Edit] [Reflect with Mittens]          │
└─────────────────────────────────────────┘
```

---

## Part 7: Metabolism Engine Computation

```
1. SLEEP BASELINE (from last night)
   └→ absorption_baseline = f(hours, quality, consecutive_bad_nights)
   └→ cortisol starting level
   └→ insulin sensitivity
   └→ Visualized in sleep modal

2. FOOD INTAKE (per meal)
   └→ Phase 1: identify foods
   └→ Phase 2: per-food nutrient estimation (USDA + AI)
   └→ Per-food auditable with confidence + source
   └→ Visualized in FoodNutrientModal

3. ACTIVITY IMPACT (from activity logs, created when stationary)
   └→ Nutrient depletion/production from activity profiles
   └→ Confidence from detection source (AR/GPS/manual)
   └→ ALL values tappable → reasoning modal
   └→ Visualized in ActivityEditModal + Today tab

4. CORTISOL STATE (from energy ratings + activity defaults + memory)
   └→ Source 1: User energy rating (highest trust)
   └→ Source 2: Memory-learned patterns (medium trust)
   └→ Source 3: Activity type defaults (low trust)
   └→ Maps to absorption modifier
   └→ Visualized in Today tab summary

5. ENVIRONMENT (passive)
   └→ UV exposure (from weather + duration + coverage)
   └→ Nature minutes (from location in parks/green spaces)
   └→ Temperature (affects electrolyte loss)

6. NET = intake + production - depletion
7. ABSORBED = net × sleep_baseline × cortisol_modifier
8. GAPS = RDA - absorbed
```

### Today Tab Visualization

```
TODAY @ 1:32 PM

── STATUS ──
Absorption: 91%                        [tap: breakdown]
  Sleep baseline: 95% (7h 12m, good)
  Cortisol: 4/10 (3h desk, +1h nature)
  Net modifier: ×0.91

── TIMELINE ──
[Sleep] Last night: 7h 12min (good)    65% inferred
  Baseline: 95% | Reset: Full           [tap: details]

[Food] Breakfast: Mixed grain bowl     ✓ Manual
  23/45 nutrients estimated...          [tap: per-food]

[Activity] Running, Central Park       87% AR
  32 min | -320 kcal, +8.2 mcg Vit D    [tap: impact]

[Activity] Desk work, Home             Inferred
  3.2 hrs | -19 mg Mag, -B6             [tap: impact]

[Activity] Park walk with Alex         Manual
  45 min | Nature: ✓ | Energy: +3       [tap: AEIOU]
```

Every value is tappable → reasoning modal with formula, citation, confidence, and [Adjust].

---

## Part 8: Message Flow (Final)

```
Location log    → INSTANT (for map + calendar line)
Activity log    → When motion ENDS + user stationary for threshold

  Activity log created:
    → Always save (regardless of proactiveness setting)
    → Always show in Today tab (with confidence badge)
    → Send chat message?
    
      Manual log?       → NEVER send message
      Auto-detected?
        User moving?    → Queue, send when stationary
        User stationary + proactiveness ON?  → Send chat card
        User stationary + proactiveness OFF? → No message, log visible in Today
```

---

## Architecture Summary

```
INSTANT LAYER (for visualization):
  Location logs → Map trail + Calendar location line (always live)

DEFERRED LAYER (for metabolism):
  Location pattern → Activity log (when session ends)
  Activity log → Nutrient impact computation
  Activity log → Chat card (if conditions met)

REFLECTION LAYER (user-initiated):
  Activity modal → Engagement (1-10) + Energy (-5 to +5)
  Activity modal → Life categories (work/health/play/love)
  Activity modal → AEIOU free-text (Good Time Journal)
  Activity modal → "Reflect with Mittens" → deeper chat journal
  Activity modal → Failure log links

METABOLISM ENGINE:
  Sleep baseline × (food intake + activity impact) × cortisol modifier
  Every value: confidence level + tappable reasoning + editable

WELLBEING INSIGHTS (from accumulated data):
  SPIRE check-in: Spiritual / Physical / Intellectual / Relational / Emotional
  Good Time Journal patterns: what brings flow, what drains
  Failure immunity: screwups / weaknesses / growth opportunities
```

## Open Questions

> [!IMPORTANT]
> **Stationary threshold for activity log creation**: How long should the user be stationary before converting a motion session into an activity log? 2 min? 5 min? This affects lag between stopping and seeing the activity card.

> [!IMPORTANT]
> **Apple Health integration priority**: Worth building for MVP? Solves sleep detection (Apple Watch) + step count + workouts. Requires HealthKit entitlement. Could replace much of our manual inference for iOS users.

> [!IMPORTANT]
> **SPIRE check-in frequency**: Should Mittens surface SPIRE-based wellbeing insights weekly? Monthly? Only when the user has enough AEIOU data to be meaningful (e.g., 7+ rated activities)?
