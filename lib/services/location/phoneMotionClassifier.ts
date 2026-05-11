/**
 * Phone Motion Classifier
 *
 * Phone-only walk/bike/transit/run/stationary classification.
 * No pendant required (the pendant only confirms `isWorn` and the scene type,
 * it doesn't drive the basic motion label).
 *
 * Why this exists:
 *   Apple's CMMotionActivityManager and Android's Activity Recognition API
 *   are noisy. They fire low-confidence "walking" events from hand fidgeting,
 *   and they have no good way to distinguish biking from short car trips.
 *   We can do better by fusing three independent signals on a rolling window:
 *
 *     1. GPS displacement (very reliable for moving vs not moving)
 *     2. Pedometer step rate (hardware-level — fidgets don't register as steps)
 *     3. AR API output, weighted by its own confidence (soft prior, not gospel)
 *
 *   The decision tree below resolves walk/bike/run/transit/stationary using
 *   primarily signals 1 and 2, with AR as a tie-breaker only.
 *
 * Output:
 *   { type, confidence } where confidence is 0..1. Downstream code (activity
 *   log writer) can surface confidence so low-confidence guesses get marked
 *   as "AI inferred — tap to correct".
 *
 * Limitations:
 *   - Pedometer updates from expo-sensors don't fire while the app is fully
 *     backgrounded. We use periodic polls (`getStepCountAsync`) on a timer to
 *     work around this.
 *   - When GPS is degraded (subway, tunnel, indoor mall), the classifier
 *     holds the last known label until a fix returns. Otherwise we'd flap
 *     to "stationary" every time a train enters a tunnel.
 */

import * as Pedometer from 'expo-sensors/build/Pedometer';
import { getCurrentMotion } from './motionService';

// ─── Types ───────────────────────────────────────────────────────────────

export type ClassifiedMotion =
  | 'stationary'
  | 'walking'
  | 'running'
  | 'cycling'
  | 'driving' // = "transit" in the UI mapping
  | 'unknown';

export interface ClassificationResult {
  type: ClassifiedMotion;
  confidence: number; // 0..1
  reason: string;     // human-readable explanation for the activity log
  timestamp: number;
}

interface SpeedSample {
  speed: number; // m/s
  time: number;  // ms epoch
}

interface PositionSample {
  lat: number;
  lon: number;
  time: number;
  accuracy?: number; // m
}

// ─── State ───────────────────────────────────────────────────────────────

const WINDOW_MS = 90_000; // rolling window for features
const SUBWAY_HOLD_MS = 120_000; // hold last known label this long on GPS loss

const speedHistory: SpeedSample[] = [];
const positionHistory: PositionSample[] = [];

// Step count cache: total steps reported by the OS, with timestamp.
// We diff consecutive snapshots to get a step rate.
let lastStepSnapshot: { steps: number; time: number } | null = null;
let stepPollTimer: ReturnType<typeof setInterval> | null = null;
const STEP_POLL_INTERVAL_MS = 15_000;

let lastClassification: ClassificationResult = {
  type: 'unknown',
  confidence: 0,
  reason: 'no data yet',
  timestamp: 0,
};

let pedometerAvailable = false;
let pedometerStarted = false;

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Initialize the classifier. Safe to call multiple times.
 * Starts the pedometer poll if available.
 */
export async function startMotionClassifier(): Promise<void> {
  if (pedometerStarted) return;
  pedometerStarted = true;

  try {
    pedometerAvailable = await Pedometer.isAvailableAsync();
    if (!pedometerAvailable) {
      console.log('[motionClass] pedometer not available, falling back to GPS-only');
      return;
    }
    // iOS Pedometer needs explicit permission for getStepCountAsync historical
    // queries. requestPermissionsAsync is a no-op on devices that don't need it.
    try {
      await Pedometer.requestPermissionsAsync();
    } catch { /* permission flow may not exist on this platform */ }

    // Seed initial snapshot so the first diff has a baseline.
    await pollStepCount();
    stepPollTimer = setInterval(() => {
      pollStepCount().catch(() => {});
    }, STEP_POLL_INTERVAL_MS);
    console.log('[motionClass] started, pedometer polling every', STEP_POLL_INTERVAL_MS, 'ms');
  } catch (err) {
    console.warn('[motionClass] init failed:', err);
  }
}

export function stopMotionClassifier(): void {
  if (stepPollTimer) {
    clearInterval(stepPollTimer);
    stepPollTimer = null;
  }
  pedometerStarted = false;
  speedHistory.length = 0;
  positionHistory.length = 0;
  lastStepSnapshot = null;
}

/**
 * Feed a new GPS sample into the classifier. Called from locationService
 * on every significant location change.
 */
export function recordGpsSample(sample: {
  lat: number;
  lon: number;
  speed: number | null;
  accuracy?: number | null;
  time?: number;
}): void {
  const now = sample.time ?? Date.now();
  if (sample.speed != null && sample.speed >= 0) {
    speedHistory.push({ speed: sample.speed, time: now });
  }
  positionHistory.push({
    lat: sample.lat,
    lon: sample.lon,
    time: now,
    accuracy: sample.accuracy ?? undefined,
  });
  trimWindow();
}

/**
 * Run the decision tree against current features and return the resulting
 * classification. Cached so repeated calls within a few seconds don't
 * recompute.
 */
export function classifyNow(): ClassificationResult {
  // Mini-cache: 2s is more than enough — features only change on new GPS/step samples
  const now = Date.now();
  if (now - lastClassification.timestamp < 2000) return lastClassification;

  const features = computeFeatures(now);
  const result = decide(features, now);

  // Subway/tunnel hold: if GPS just degraded but we recently had a confident
  // transit label, stick with it rather than flapping to stationary.
  if (
    result.type === 'unknown' &&
    features.gpsDegraded &&
    lastClassification.type === 'driving' &&
    lastClassification.confidence >= 0.6 &&
    now - lastClassification.timestamp < SUBWAY_HOLD_MS
  ) {
    lastClassification = {
      type: 'driving',
      confidence: Math.max(0.4, lastClassification.confidence - 0.2),
      reason: 'GPS degraded, holding transit label',
      timestamp: now,
    };
    return lastClassification;
  }

  lastClassification = result;
  return result;
}

export function getLastClassification(): ClassificationResult {
  return lastClassification;
}

// ─── Internals ───────────────────────────────────────────────────────────

async function pollStepCount(): Promise<void> {
  try {
    // Query a slightly-larger-than-window range so the diff stays robust to
    // clock jitter and dropped polls.
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_MS - 5000);
    const result = await Pedometer.getStepCountAsync(start, end);
    lastStepSnapshot = { steps: result.steps, time: end.getTime() };
  } catch (err) {
    // Permission denied, simulator, or no motion fitness data — ignore.
    // Classifier will just fall through to GPS-only signals.
  }
}

function trimWindow(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (speedHistory.length > 0 && speedHistory[0].time < cutoff) speedHistory.shift();
  while (positionHistory.length > 0 && positionHistory[0].time < cutoff) positionHistory.shift();
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface Features {
  medianSpeed: number;       // m/s
  maxSpeed: number;
  speedStdDev: number;
  stopsPerMin: number;       // count of zero-ish speed samples per minute
  totalDisplacement: number; // m, sum of leg distances in window
  stepRateHz: number;        // steps/sec averaged across window
  pedometerHasData: boolean;
  arType: ClassifiedMotion;
  arConfidence: 'low' | 'medium' | 'high';
  arFresh: boolean;
  windowSeconds: number;
  gpsDegraded: boolean;      // true if recent positions have accuracy > 100m
}

function computeFeatures(now: number): Features {
  // Speed features
  const speeds = speedHistory.map((s) => s.speed);
  const medianSpeed = median(speeds);
  const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
  const speedStdDev = stddev(speeds);

  // Stops/min: samples below 0.5 m/s — a transit ride has many of these,
  // a steady bike ride has very few.
  let stopSamples = 0;
  for (const s of speedHistory) {
    if (s.speed < 0.5) stopSamples++;
  }
  const windowSeconds = Math.max(
    (speedHistory.length > 0 ? now - speedHistory[0].time : 0) / 1000,
    1,
  );
  const stopsPerMin = (stopSamples / windowSeconds) * 60;

  // Total displacement (sum of GPS leg lengths)
  let totalDisplacement = 0;
  for (let i = 1; i < positionHistory.length; i++) {
    totalDisplacement += haversineMeters(
      positionHistory[i - 1].lat,
      positionHistory[i - 1].lon,
      positionHistory[i].lat,
      positionHistory[i].lon,
    );
  }

  // Step rate: diff the two most recent pedometer snapshots
  let stepRateHz = 0;
  let pedometerHasData = false;
  if (lastStepSnapshot && pedometerAvailable) {
    pedometerHasData = true;
    // steps over a WINDOW_MS query
    stepRateHz = lastStepSnapshot.steps / (WINDOW_MS / 1000);
  }

  // AR signal (already corrected by motionService.ts)
  const ar = getCurrentMotion();
  const arFresh = now - ar.timestamp < 60_000;
  const arType = (ar.type as ClassifiedMotion) || 'unknown';

  // GPS degraded: accuracy worse than 100m on the most recent fix, OR
  // no fix in the last 30s.
  const lastFix = positionHistory.length > 0 ? positionHistory[positionHistory.length - 1] : null;
  const gpsDegraded = !lastFix
    ? true
    : (lastFix.accuracy != null && lastFix.accuracy > 100) ||
      now - lastFix.time > 30_000;

  return {
    medianSpeed,
    maxSpeed,
    speedStdDev,
    stopsPerMin,
    totalDisplacement,
    stepRateHz,
    pedometerHasData,
    arType,
    arConfidence: ar.confidence,
    arFresh,
    windowSeconds,
    gpsDegraded,
  };
}

/**
 * The decision tree. Order matters — most-specific cases first.
 */
function decide(f: Features, now: number): ClassificationResult {
  const mk = (type: ClassifiedMotion, confidence: number, reason: string): ClassificationResult => ({
    type, confidence, reason, timestamp: now,
  });

  // Not enough data yet
  if (f.windowSeconds < 20 && f.totalDisplacement < 5) {
    return mk('unknown', 0.2, 'insufficient data');
  }

  // GPS is unusable — defer to last known if available (handled by classifyNow's
  // subway hold). Without that, return unknown.
  if (f.gpsDegraded && positionHistory.length < 2) {
    return mk('unknown', 0.1, 'no GPS');
  }

  // STATIONARY: low displacement + low median speed.
  if (f.medianSpeed < 0.3 && f.totalDisplacement < 25) {
    return mk('stationary', 0.95, 'no displacement, low speed');
  }

  // RUNNING: high step rate + GPS confirms moderate-to-fast pace.
  // Step rate 2.3 Hz ≈ 138 SPM — into running cadence territory.
  if (f.pedometerHasData && f.stepRateHz >= 2.3 && f.medianSpeed >= 1.8) {
    return mk('running', 0.9, `step rate ${f.stepRateHz.toFixed(1)}/s + speed`);
  }
  // AR backup for running (still requires displacement)
  if (f.arType === 'running' && f.arConfidence !== 'low' && f.arFresh && f.medianSpeed >= 1.5) {
    return mk('running', 0.75, 'AR=running + GPS speed agrees');
  }

  // WALKING: clear step rate + walking-band speed.
  if (f.pedometerHasData && f.stepRateHz >= 1.4 && f.medianSpeed >= 0.6 && f.medianSpeed < 2.8) {
    return mk('walking', 0.95, `step rate ${f.stepRateHz.toFixed(1)}/s`);
  }
  // No-pedometer fallback: GPS-only walk band, confirmed by AR or by sustained
  // displacement.
  if (!f.pedometerHasData && f.medianSpeed >= 0.6 && f.medianSpeed < 2.5 && f.totalDisplacement > 40) {
    const arAgrees = f.arType === 'walking' && f.arConfidence !== 'low' && f.arFresh;
    return mk('walking', arAgrees ? 0.8 : 0.6, arAgrees ? 'speed band + AR walking' : 'speed band + displacement');
  }

  // No steps detected, but movement is real -- this is the bike/transit branch.
  const noSteps = !f.pedometerHasData || f.stepRateHz < 0.4;
  if (noSteps && f.totalDisplacement > 60) {
    // TRANSIT signatures: many stops (lights/stations) OR high speed variance
    //   OR sustained high speed.
    if (f.stopsPerMin > 1.5 || f.speedStdDev > 4 || f.medianSpeed > 8) {
      return mk(
        'driving',
        0.85,
        `no steps, stops/min=${f.stopsPerMin.toFixed(1)}, σ=${f.speedStdDev.toFixed(1)}, max=${f.maxSpeed.toFixed(1)}m/s`,
      );
    }
    // CYCLING: sustained moderate speed, smooth profile, few stops.
    if (f.medianSpeed >= 2.5 && f.medianSpeed <= 8 && f.speedStdDev <= 4) {
      const arAgrees = f.arType === 'cycling' && f.arConfidence !== 'low' && f.arFresh;
      return mk('cycling', arAgrees ? 0.85 : 0.75, arAgrees ? 'no steps + speed + AR' : 'no steps + speed band');
    }
  }

  // AR is trustworthy and we don't have a strong counter-signal — accept it
  // softly. This is the last resort before falling to unknown.
  if (f.arFresh && f.arConfidence === 'high' && f.arType !== 'unknown') {
    // Sanity check: if AR says walking but no pedometer steps AND no displacement,
    // refuse. Same for non-stationary AR with no displacement.
    if (f.arType !== 'stationary' && f.totalDisplacement < 25) {
      return mk('unknown', 0.3, 'AR signal without displacement evidence');
    }
    return mk(f.arType, 0.7, 'AR high-confidence fallback');
  }

  return mk('unknown', 0.3, 'no decisive signal');
}

// ─── Math helpers ────────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}
