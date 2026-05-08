# Mittens LMST schedule — implementation spec

Spec for replacing the current sunrise-anchored scheduler with a **Local Mean Solar Time (LMST)** anchored system. Written to be handed to coding agents directly — file paths, signatures, field names, and acceptance criteria are included.

Background reading: `docs/schedule-science-review.md` in this repo for the health evidence behind this design.

## 1. Goals

- Anchor the user's daily schedule to their **longitude's mean solar time**, not civil timezone or actual sunrise.
- Produce a schedule that is **DST-proof, timezone-politics-proof, and seasonally stable** at any latitude.
- Maximize **sleep regularity** (the single strongest sleep-health mortality predictor per UK Biobank 2024).
- Preserve the morning-light benefit by decoupling **light-exposure prompts** from **schedule anchoring**.
- Handle **travel and permanent moves** with an evidence-based phase-shift protocol (1h/day max).
- Make the displayed times friendly (local clock by default) while keeping the internal representation in LMST.

## 2. Non-goals

- We are not building a new clock app or timezone viewer.
- We are not trying to automatically override the OS clock.
- We are not shipping permanent-DST advocacy; we just smooth DST transitions.
- We are not supporting sub-day-granularity re-anchoring (the daily cron does one LMST anchor per user).

## 3. User-facing changes (high level)

1. **Onboarding** gains a new step: location permission + target wake time + chronotype question.
2. **Settings** (`app/(tabs)/*` settings surface, TBD) gains a "Sleep schedule" panel with wake time, sleep duration, home longitude, chronotype, travel mode toggle.
3. **Schedule blocks** (wake, meals, bedtime) are computed from LMST. Display text shows the user's local clock time; an optional "solar time" mode can show LMST directly.
4. **Morning light prompt** is a new notification separate from the wake alarm — fires at the user's wake time and nudges outdoor light or light-box use based on actual sunrise data.
5. **On permanent location change** (detected via significant longitude shift that persists), the app asks "new home?" and begins a gradual LMST re-anchoring over several days.

## 4. Data model changes

### 4.1 Backend — Strapi `nutrition-profile` model

Add the following fields to `building-fashion-future/backend_strapi/api/nutrition-profile/models/nutrition-profile.settings.json` (or wherever the canonical profile model lives — verify path):

```json
{
  "homeLongitude": { "type": "float", "default": null },
  "homeLatitude":  { "type": "float", "default": null },
  "homeLabel":     { "type": "string", "default": null },
  "wakeTimeLmstMinutes": { "type": "integer", "default": 360 },  // 6:00 LMST
  "sleepHours":    { "type": "float", "default": 8 },
  "chronotype":    { "type": "enumeration", "enum": ["morning", "intermediate", "evening"], "default": "intermediate" },
  "breakfastOffsetMinutes": { "type": "integer", "default": 45 },
  "dinnerBeforeBedMinutes": { "type": "integer", "default": 240 },
  "scheduleMode":  { "type": "enumeration", "enum": ["local_clock", "lmst"], "default": "local_clock" },
  "travelMode":    { "type": "enumeration", "enum": ["home", "short_trip", "transitioning"], "default": "home" },
  "anchorTransition": {
    "type": "json",
    "default": null
    // { "fromLongitude": number, "toLongitude": number, "startedAt": iso, "completesAt": iso, "perDayShiftMinutes": number }
  }
}
```

All fields nullable/defaulted so existing users keep working (see §10 Migration).

### 4.2 Frontend — TypeScript types

Extend `mittens-app/lib/types.ts` with a new interface (or add to existing profile type if one exists):

```ts
export interface ScheduleProfile {
  homeLongitude: number | null;
  homeLatitude: number | null;
  homeLabel: string | null;
  wakeTimeLmstMinutes: number;       // 0-1439; minutes from LMST midnight
  sleepHours: number;
  chronotype: 'morning' | 'intermediate' | 'evening';
  breakfastOffsetMinutes: number;    // minutes after wake
  dinnerBeforeBedMinutes: number;    // minutes before bedtime
  scheduleMode: 'local_clock' | 'lmst';
  travelMode: 'home' | 'short_trip' | 'transitioning';
  anchorTransition: AnchorTransition | null;
}

export interface AnchorTransition {
  fromLongitude: number;
  toLongitude: number;
  startedAt: string;       // ISO
  completesAt: string;     // ISO
  perDayShiftMinutes: number;
}
```

## 5. Core LMST library

Create a new file `mittens-app/lib/services/solarTime.ts` with **pure, timezone-free** functions. These are the math primitives everything else builds on.

```ts
/**
 * Local Mean Solar Time (LMST) utilities.
 * LMST is the mean solar time at a given longitude, independent of civil timezones and DST.
 * Solar noon at longitude L is UTC + (L / 15) hours.
 *
 * All times are represented either as:
 *   (a) a `Date` (absolute UTC instant), or
 *   (b) a number of LMST-minutes-from-midnight (0-1439), which is a "time of day" in LMST.
 *
 * LMST minutes from midnight at longitude L for instant t (UTC):
 *   lmst = ((t_utc + L/15 hours) mod 24h) in minutes
 */

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;

/** Convert a UTC Date to LMST minutes-of-day at the given longitude. */
export function utcToLmstMinutes(utc: Date, longitude: number): number {
  const offsetMs = (longitude / 15) * 3600 * 1000;
  const shifted = utc.getTime() + offsetMs;
  const minutes = Math.floor(shifted / MS_PER_MINUTE) % MINUTES_PER_DAY;
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Given an LMST time-of-day (minutes from LMST midnight) and a target calendar day,
 * return the UTC Date at which that LMST time occurs on that day.
 *
 * The `dayAnchor` is interpreted in the user's longitude frame — specifically, the UTC
 * day containing the requested LMST moment is derived from dayAnchor's date parts.
 */
export function lmstToUtc(lmstMinutes: number, longitude: number, dayAnchor: Date): Date {
  // Construct UTC midnight at the anchor date, then subtract the LMST offset so that
  // adding lmstMinutes lands on the correct LMST instant.
  const y = dayAnchor.getUTCFullYear();
  const m = dayAnchor.getUTCMonth();
  const d = dayAnchor.getUTCDate();
  const lmstMidnightUtcMs = Date.UTC(y, m, d) - (longitude / 15) * 3600 * 1000;
  return new Date(lmstMidnightUtcMs + lmstMinutes * MS_PER_MINUTE);
}

/** Derive the LMST offset (minutes) of civil time for a longitude. Positive = LMST ahead of UTC. */
export function lmstOffsetMinutes(longitude: number): number {
  return Math.round((longitude / 15) * 60);
}

/** Interpolate LMST anchor during a travel transition. Returns effective longitude for scheduling. */
export function effectiveLongitude(
  transition: AnchorTransition | null,
  homeLongitude: number,
  now: Date
): number {
  if (!transition) return homeLongitude;
  const start = new Date(transition.startedAt).getTime();
  const end = new Date(transition.completesAt).getTime();
  const nowMs = now.getTime();
  if (nowMs <= start) return transition.fromLongitude;
  if (nowMs >= end) return transition.toLongitude;
  const frac = (nowMs - start) / (end - start);
  // Shift along the shortest longitudinal path (handle antimeridian).
  const delta = shortestLongitudeDelta(transition.fromLongitude, transition.toLongitude);
  return normalizeLongitude(transition.fromLongitude + delta * frac);
}

function shortestLongitudeDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function normalizeLongitude(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l <= -180) l += 360;
  return l;
}
```

**Unit tests required** (`solarTime.test.ts`):
- `utcToLmstMinutes(2026-06-21T12:00Z, 0) === 720` (noon UTC at Greenwich = 12:00 LMST)
- `utcToLmstMinutes(2026-06-21T12:00Z, 90) === 1080` (6 PM LMST at +90°E)
- `utcToLmstMinutes(2026-06-21T12:00Z, -75) === 420` (7 AM LMST at NYC longitude)
- Round-trip: `lmstToUtc(utcToLmstMinutes(t, L), L, t)` within 1 minute of `t` (allowing for date boundary).
- Antimeridian travel: `effectiveLongitude` transitioning +170 → -170 goes through 180/−180, not through 0.
- DST-independence: `utcToLmstMinutes` of the same UTC instant is unchanged across a DST transition.

## 6. Schedule computation

Create `mittens-app/lib/services/scheduleComputer.ts`:

```ts
export interface DailyScheduleLmst {
  wakeLmst: number;       // minutes from LMST midnight
  breakfastLmst: number;
  lunchLmst: number;
  dinnerLmst: number;
  bedtimeLmst: number;    // may be > 1440 (next day) — callers should mod 1440 and carry date
}

export interface DailyScheduleAbsolute {
  wakeUtc: Date;
  breakfastUtc: Date;
  lunchUtc: Date;
  dinnerUtc: Date;
  bedtimeUtc: Date;
}

export function computeDailyScheduleLmst(profile: ScheduleProfile): DailyScheduleLmst {
  const wake = profile.wakeTimeLmstMinutes;
  const sleepMin = profile.sleepHours * 60;
  const bedtime = wake - sleepMin;       // may go negative → previous-LMST-day
  const breakfast = wake + profile.breakfastOffsetMinutes;
  const dinner = (bedtime < 0 ? bedtime + MINUTES_PER_DAY : bedtime) - profile.dinnerBeforeBedMinutes;
  const lunch = Math.round((breakfast + dinner) / 2);
  return { wakeLmst: wake, breakfastLmst: breakfast, lunchLmst: lunch, dinnerLmst: dinner, bedtimeLmst: bedtime };
}

export function materializeSchedule(
  profile: ScheduleProfile,
  dayAnchor: Date,
  now: Date = new Date()
): DailyScheduleAbsolute {
  const lon = effectiveLongitude(profile.anchorTransition, profile.homeLongitude!, now);
  const s = computeDailyScheduleLmst(profile);
  return {
    wakeUtc:      lmstToUtc(normalizeLmstMinutes(s.wakeLmst), lon, dayAnchor),
    breakfastUtc: lmstToUtc(normalizeLmstMinutes(s.breakfastLmst), lon, dayAnchor),
    lunchUtc:     lmstToUtc(normalizeLmstMinutes(s.lunchLmst), lon, dayAnchor),
    dinnerUtc:    lmstToUtc(normalizeLmstMinutes(s.dinnerLmst), lon, dayAnchor),
    // Bedtime is "tonight's sleep" → the bedtime *before* the next wake
    bedtimeUtc:   lmstToUtc(normalizeLmstMinutes(s.bedtimeLmst), lon,
                             s.bedtimeLmst < 0 ? dayAnchor : addDaysUtc(dayAnchor, -1)),
  };
}
```

Key properties this must satisfy (cover with tests):

- Output is **stable across DST transitions**: same `profile` + same day-of-year gives the same body-clock moment regardless of civil DST state.
- Output is **stable across seasons** at any latitude: wake/meal/bedtime UTC instants drift by at most ±4 min/year (Equation of Time, which we intentionally do NOT correct for — `LMST = mean` solar time).
- Output is **consistent with the dinner-to-bed gap stored in the profile**: `bedtimeUtc − dinnerUtc === dinnerBeforeBedMinutes` exactly.
- Output is **chronotype-tunable**: changing `wakeTimeLmstMinutes` shifts every meal + bedtime by the same delta.

## 7. Refactor `alarmScheduler.ts`

The current `scheduleBedtimeAlarms(sleepHours, homeLocation, ...)` in `mittens-app/lib/services/alarmScheduler.ts` uses sunrise directly. Refactor it to consume `scheduleComputer`:

**Remove:** the hardcoded `wake + 5h50m` / `wake + 11h40m` meal offsets on lines 300–302.

**Remove:** the dependency on `fetchSunrise` for scheduling. Keep `fetchSunrise` only for the morning-light prompt (§8) and display purposes.

**Replace the meal/bedtime block (lines 289–311) with:**

```ts
const profile = await loadScheduleProfile();             // new: reads from profileApi
if (!profile?.homeLongitude) return;                      // user hasn't set location yet
const schedule = materializeSchedule(profile, new Date());

await generateRhythmBlocks([
  { name: '[Mittens] Wake',      time: schedule.wakeUtc,      type: 'other' },
  { name: '[Mittens] Breakfast', time: schedule.breakfastUtc, type: 'other' },
  { name: '[Mittens] Lunch',     time: schedule.lunchUtc,     type: 'other' },
  { name: '[Mittens] Dinner',    time: schedule.dinnerUtc,    type: 'other' },
  { name: '[Mittens] Bedtime',   time: schedule.bedtimeUtc,   type: 'sleep' },
]);

const bedtime = schedule.bedtimeUtc;
const checkinTime = new Date(bedtime.getTime() - 60 * 60 * 1000);
// ... keep existing checkin + head-home alarm logic, but swap `bedtime` source
```

**Update `scheduleMorningBriefing(sunriseTime)` caller:** pass `schedule.wakeUtc` instead of tomorrow's sunrise. The briefing fires at the user's actual wake, not at solar sunrise.

**Display formatting:** when rendering Mittens messages that include times (e.g., morning briefing, bedtime reminders), format according to `profile.scheduleMode`:
- `local_clock`: use `Date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })` — existing behavior.
- `lmst`: render the LMST minutes directly as `H:MM` with a small "solar" suffix.

## 8. Morning light-exposure prompt (new, separate from schedule)

Create `mittens-app/lib/services/lightExposurePrompt.ts`:

Purpose: deliver a distinct notification at the user's wake time nudging outdoor light (or light box in dark winters / indoor conditions). This is what rescues the original "wake with sunrise" benefit without binding the schedule to it.

Inputs:
- `schedule.wakeUtc` (from scheduleComputer)
- Actual sunrise/sunset at current `homeLatitude`/`homeLongitude` (keep `fetchSunrise` for this)
- Weather / cloud cover if available

Logic:

```ts
async function scheduleLightPrompt(profile: ScheduleProfile, wakeUtc: Date) {
  const sunrise = await fetchSunrise(profile.homeLatitude!, profile.homeLongitude!, 0);
  const minutesFromSunrise = sunrise ? (wakeUtc.getTime() - sunrise.getTime()) / 60000 : null;

  let body: string;
  if (minutesFromSunrise === null) {
    body = 'Get 10 min of bright light in the next hour to anchor your day.';
  } else if (minutesFromSunrise < -90) {
    // Waking well before sunrise — polar winter or very early riser
    body = 'It\'s still dark out — 30 min with a 10,000 lux light box supports your circadian rhythm.';
  } else if (minutesFromSunrise >= -90 && minutesFromSunrise <= 120) {
    // Within the good window: step outside
    body = 'Get 10 min of outdoor light in the next hour — natural morning light anchors your day best.';
  } else {
    // Waking well after sunrise — summer at high latitudes or late sleeper
    body = 'The sun\'s been up for a while. Still get 10 min of outdoor light to reinforce your wake signal.';
  }

  await scheduleNotif('morning-light', 'Morning light', body, secondsUntil(wakeUtc), { type: 'light_prompt' });
}
```

This runs alongside (not instead of) the morning briefing.

## 9. Travel and phase-shift

Create `mittens-app/lib/services/phaseShift.ts`:

### 9.1 Detection

Subscribe to existing location service (`locationService.ts` already has significant-location-change tracking). When the user's current longitude diverges from `homeLongitude` by more than **15°** (~1h of LMST) and persists for more than **4 hours**, fire a detection event.

Ask the user (via an AskUserQuestion-style UI prompt or chat message):

- "Short trip (hold your home schedule)" → set `travelMode = short_trip`, no anchor change.
- "Permanent move (re-anchor to here)" → set `travelMode = transitioning`, initialize `anchorTransition`.
- "Snooze — ask me again tomorrow" → wait.

### 9.2 Anchor transition schedule

On "permanent move," compute:

```ts
function initTransition(
  fromLon: number,
  toLon: number,
  now: Date,
  aggressiveness: 'gentle' | 'standard' | 'fast' = 'standard'
): AnchorTransition {
  const delta = Math.abs(shortestLongitudeDelta(fromLon, toLon));
  const totalShiftHours = delta / 15;                      // 1h per 15° longitude
  const perDayHours = aggressiveness === 'gentle' ? 0.5
                    : aggressiveness === 'fast'   ? 1.5
                    : 1.0;
  const days = Math.ceil(totalShiftHours / perDayHours);
  return {
    fromLongitude: fromLon,
    toLongitude: toLon,
    startedAt: now.toISOString(),
    completesAt: new Date(now.getTime() + days * 86400_000).toISOString(),
    perDayShiftMinutes: perDayHours * 60,
  };
}
```

Default `standard` = 1h/day. This matches the evidence-based range (1–1.5h/day max, 30–60 min/day typical for jet-lag protocols).

### 9.3 Direction-specific light/melatonin prompts during transition

While `travelMode === 'transitioning'`:

- **Eastward** (`toLon > fromLon` on shortest path): surface "get bright light at wake, avoid evening light" prompts; offer optional melatonin-timing reminder 6h before target bedtime.
- **Westward**: surface "minimize early-morning light, seek evening light" prompts; offer optional melatonin 1h after rising.

Keep the melatonin reminder as a *suggestion string only* — mittens should not instruct dosing or act medically.

### 9.4 Completion

When `now >= anchorTransition.completesAt`:
- Set `homeLongitude = toLongitude`, `homeLatitude = current lat`, `homeLabel = reverse-geocode result`.
- Clear `anchorTransition`, set `travelMode = 'home'`.
- Fire a one-time "Welcome to your new rhythm" Mittens message.

### 9.5 Short trips (< 3 days)

If the user returns to within 15° of `homeLongitude` before 3 days elapse AND `travelMode === short_trip`, no change required — schedule was never shifted. This matches clinical guidance to NOT partially shift for short trips.

### 9.6 DST smoothing (optional enhancement)

DST transitions don't affect LMST at all — this is a free win. But the displayed *local clock* time of wake and meals will jump by 1h on the transition day. To smooth the user-visible experience:

- 3 days before DST: temporarily decrement `wakeTimeLmstMinutes` by 15 min/day (spring-forward) or increment (fall-back) for 3 days, then restore after transition. This produces a 3×15 = 45 min shift spread over 3 days + the remaining 15 min absorbed on transition day.
- Or skip this — the LMST anchor alone already insulates the user's body clock; the display shift is cosmetic.

Recommended: skip in v1, add in v2 if users complain about DST-day display weirdness.

## 10. Onboarding flow changes

Modify `mittens-app/app/onboarding.tsx`. Add steps **after** current step 3 (skin type) or reorder as makes sense:

### Step 4 — Location
- Request `expo-location` permission.
- Call `Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })`.
- Store `homeLatitude`, `homeLongitude`.
- Reverse-geocode to `homeLabel` for display.
- Provide a manual fallback: city search (can reuse any existing city-search component, else simple text field + Nominatim lookup) if permission denied.

### Step 5 — Target wake time + chronotype
UI shows two inputs:

1. **Chronotype question** (3 options): "When do you feel most alert? — Early morning / It depends / Late evening." Maps to `chronotype ∈ { morning, intermediate, evening }`.
2. **Target wake time**: default populated from chronotype:
   - `morning` → 6:00 LMST (wakeTimeLmstMinutes = 360)
   - `intermediate` → 7:00 LMST (wakeTimeLmstMinutes = 420)
   - `evening` → 8:00 LMST (wakeTimeLmstMinutes = 480)
3. Under the input, show a preview: *"In your local clock: ~6:45 AM EST in winter, ~7:45 AM EDT in summer"* — computed live using the user's `homeLongitude` and `toLocaleTimeString` at the current date.
4. **Sleep hours** slider: 6–10, default 8.

### Step 6 — Light exposure commitment (light-touch)
Single screen: "Mittens will nudge you at wake to get 10 min of outdoor light — this is the single highest-leverage habit for sleep and mood. Enable morning light prompts? [Yes / Not now]"

Maps to a `lightPromptEnabled` boolean (add to profile model).

### Submission
Include all new fields in the `updateProfile` payload. Backend Strapi `nutrition-profile` controller must be updated to accept and persist them.

## 11. Settings surface

Add a new "Sleep & schedule" settings screen (likely under `app/(tabs)/sync.tsx` or a new route). Fields editable:

- Target wake time (LMST minutes shown in HH:MM local-equivalent label)
- Sleep hours
- Chronotype (read-only hint: "Our default for your chronotype is X")
- Breakfast offset (30–90 min)
- Dinner-before-bed gap (3–6 h)
- Schedule display mode (`local_clock` / `lmst`)
- Home location (with "Change home location" button that initiates `anchorTransition` manually)

## 12. Migration for existing users

Existing profiles have none of these fields. On next app launch after update:

1. Call `GET /nutrition-profile`. If `homeLongitude === null`:
2. Show a one-time migration card in Today: *"Mittens has improved its scheduling — add your location to get started."* Route to a mini-onboarding that runs just steps 4–5 above.
3. Until completed, schedule generation is disabled and falls back to nothing (or the user's manually-entered times if any exist elsewhere).

Do **not** auto-guess longitude from device timezone — it's wrong in exactly the cases this design is trying to fix (China, Spain, wide-timezone countries).

## 13. Edge cases

| Case | Behavior |
|---|---|
| User at 70°N in polar winter | Schedule unchanged. Light prompt becomes "use light box." |
| User at 70°N in polar summer | Schedule unchanged. Add "use blackout curtains" prompt 2h before bedtime. |
| Antimeridian crossing during travel | `shortestLongitudeDelta` handles. Verified in tests. |
| DST in user's local civil time | Ignored by scheduler (LMST is DST-agnostic). Displayed local clock times shift 1h on transition day — that's the OS, not us. |
| User on a cruise / moving rapidly | Short-trip mode holds home anchor. If they ask to re-anchor, apply 1h/day from current longitude. |
| User deletes location permission after onboarding | Fall back to last known `homeLongitude`. If that's null too, pause schedule generation and prompt. |
| User's phone clock is manually set wrong | Out of scope — we rely on `Date.now()` being accurate; a grossly wrong clock will produce grossly wrong times. Not a new problem. |
| Sleep hours = 6 at `intermediate` default wake of 7:00 LMST | bedtime = 1:00 LMST, dinner = 21:00 LMST (= 9 PM), checkin at 12:00 LMST (midnight). All fine. |
| Sleep hours = 10, wake = 5:00 LMST | bedtime = 19:00 LMST (7 PM LMST), dinner = 15:00 (3 PM LMST). Unusual but mathematically consistent. UI should warn if dinner-to-bed gap feels too early. |

## 14. Acceptance criteria

Must hold after implementation:

1. `solarTime.ts` unit tests pass, including all round-trip and edge cases listed in §5.
2. `scheduleComputer.ts` produces identical UTC output on `2026-03-08 2am local` (spring forward day) for NYC as on `2026-03-07` — i.e. no DST artifact in the schedule.
3. `scheduleComputer.ts` produces UTC output on 2026-06-21 vs 2026-12-21 at NYC that differs by ≤ 4 minutes for the same profile — i.e. seasonally stable.
4. `scheduleComputer.ts` produces UTC output at Helsinki (60°N) that matches New York (40°N) in *body-clock phase* (LMST hour-of-day), shifted by the longitude difference only.
5. Onboarding fails gracefully if location permission is denied (falls back to manual city entry).
6. An existing user with a pre-update profile (no new fields) does not crash the app and sees the migration card.
7. Setting `travelMode = 'transitioning'` with a 6h delta (5000+ mile flight) produces a 6-day transition at `standard` aggressiveness.
8. A transition from +175°E to −175°W passes through 180°, not through 0° (antimeridian correctness).
9. Morning briefing fires at `schedule.wakeUtc`, not at external sunrise.
10. Light prompt copy changes correctly based on `wakeUtc − localSunrise` per §8.

## 15. Out of scope for v1 (backlog)

- Sleep tracking integration (Apple Health, Oura) to validate the SRI of the resulting schedule.
- Automatic chronotype re-assessment based on observed actual-wake data.
- Melatonin dosing recommendations (keep as tip text only in v1).
- Multi-user household coordination.
- Calendar-import collision detection (e.g., "you have a 5 AM meeting — shift wake?").
- DST display-smoothing (§9.6).

## 16. File summary

New files:
- `mittens-app/lib/services/solarTime.ts` + `solarTime.test.ts`
- `mittens-app/lib/services/scheduleComputer.ts` + `scheduleComputer.test.ts`
- `mittens-app/lib/services/lightExposurePrompt.ts`
- `mittens-app/lib/services/phaseShift.ts`
- `mittens-app/app/settings/schedule.tsx` (or equivalent route)

Modified files:
- `mittens-app/app/onboarding.tsx` — add steps 4–6
- `mittens-app/lib/types.ts` — add `ScheduleProfile`, `AnchorTransition`
- `mittens-app/lib/services/alarmScheduler.ts` — swap sunrise-based scheduling for LMST
- `mittens-app/lib/services/profileApi.ts` — no code change, but the `/nutrition-profile` PUT payload now carries the new fields
- `building-fashion-future/backend_strapi/api/nutrition-profile/models/nutrition-profile.settings.json` — add new fields
- `building-fashion-future/backend_strapi/api/nutrition-profile/controllers/nutrition-profile.js` — whitelist new fields on PUT

## 17. Sources

- [Sleep regularity is a stronger predictor of mortality than sleep duration — SLEEP (2024)](https://academic.oup.com/sleep/article/47/1/zsad253/7280269)
- [Permanent standard time is the optimal choice — AASM](https://pmc.ncbi.nlm.nih.gov/articles/PMC10758561/)
- [Interventions to Minimize Jet Lag After Westward and Eastward Flight — Frontiers (2019)](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2019.00927/full)
- [Local Mean Time — Wikipedia](https://en.wikipedia.org/wiki/Local_mean_time)
- [Biological Rhythms During Residence in Polar Regions — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3793275/)
- [Genetic Basis of Chronotype in Humans — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6084759/)

Companion doc: `docs/schedule-science-review.md` (health evidence review).
