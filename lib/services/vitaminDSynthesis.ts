/**
 * Vitamin D Cutaneous Photosynthesis Model (v2)
 *
 * Estimates vitamin D₃ production from sun exposure based on:
 *  - Vitamin-D-weighted (CIE action spectrum) UVB, derived from the measured
 *    erythemal UV index plus a solar-zenith-angle (SZA) correction
 *  - Fitzpatrick skin type (melanin-dependent efficiency)
 *  - Exposed body surface area fraction
 *  - Sunscreen use
 *
 * WHAT CHANGED FROM v1 (and why "10+ min for both UV 6 and UV 8" happened):
 *  1. Skin type is now parsed from either a number (4) or a string
 *     ('fitzpatrick-4'). v1 passed the raw string into a numeric lookup in
 *     one code path, so the lookup missed and silently fell back to Type II
 *     efficiency — flattening light vs dark skin.
 *  2. recommendSunExposure() no longer silently clamps the answer to the safe
 *     single-session limit. v1 returned `min(minutesNeeded, safeMax)`, so once
 *     the true need exceeded the safe cap (common for darker skin, larger
 *     deficits, or limited skin exposure) it reported the SAME capped number
 *     regardless of UV — which is exactly why UV 6 and UV 8 looked identical.
 *     We now return the true minutes plus an honest multi-session plan.
 *  3. Safe exposure time now scales with UV (you burn faster at UV 8 than UV 6),
 *     so UV 6 and UV 8 differ in BOTH synthesis rate and safe limit.
 *  4. Skin-type efficiencies recalibrated to published "minutes per 1000 IU"
 *     ratios (Type VI needs ~4× Type II), and an optional latitude/day-of-year
 *     gate models the "vitamin D winter" (no UVB when the noon sun is too low).
 *
 * Scientific basis:
 *  - Webb AR, Engelsen O (2006) "Calculated Ultraviolet Exposure Levels for a
 *    Healthy Vitamin D Status." Photochem Photobiol 82:1697-1703 — the Standard
 *    Vitamin D Dose (SDD): ¼ MED over ¼ BSA ≈ 1000 IU (25 mcg).
 *  - Holick MF (2007) "Vitamin D deficiency." N Engl J Med 357:266-81.
 *  - CIE (2006) "Action Spectrum for the Production of Previtamin D3 in Human
 *    Skin." Technical Report 174.
 *  - Fioletov VE et al. (2010) on the vitamin-D : erythemal UV ratio vs SZA.
 *  - Engelsen O et al. (2005): UVB synthesis effectively stops above ~35–37°
 *    latitude in winter (solar zenith angle too oblique).
 *  - Skin-type minutes-for-1000-IU (annual avg, 25% BSA): I 5.05, II 6.3,
 *    III 7.6, IV 11.35, V 15.15, VI 25.25 (UV-index based synthesis model,
 *    Sci Rep 2024;14:s41598-024-54188-5) → relative efficiencies below.
 *
 * Calibration baseline (unchanged): ~25 mcg (1000 IU) per 15 min at UV Index 6,
 * Fitzpatrick II, 25% body exposed, sun reasonably high (SZA ≤ ~45°).
 *
 * Limitations:
 *  - UV index is erythema-weighted; we approximate the vitamin-D weighting with
 *    an SZA ratio. This is good for UV ≥ ~3 and degrades at very low sun.
 *  - Does not model age-related decline in 7-dehydrocholesterol.
 *  - Plateau at 62.5 mcg/session reflects photodegradation equilibrium.
 */

/** Fitzpatrick skin type (I–VI) */
export type FitzpatrickType = 1 | 2 | 3 | 4 | 5 | 6;

/** Accepts 4, '4', or 'fitzpatrick-4' and returns a clamped numeric type. */
export function parseSkinType(raw?: number | string | null): FitzpatrickType {
  if (typeof raw === 'number' && raw >= 1 && raw <= 6) return Math.round(raw) as FitzpatrickType;
  const n = parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
  return (n >= 1 && n <= 6 ? n : 4) as FitzpatrickType; // default Type IV
}

export interface VitaminDSynthesisParams {
  /** Duration of sun exposure in minutes */
  durationMinutes: number;
  /** Current (erythemal) UV index (0–15+) */
  uvIndex: number;
  /** Fitzpatrick skin type (1–6), number or 'fitzpatrick-N' string */
  skinType: FitzpatrickType | string;
  /** Fraction of body surface area exposed, default 0.25 (face + arms + hands) */
  bodyCoverage?: number;
  /** Whether sunscreen SPF 30+ was applied */
  sunscreen?: boolean;
  /** Optional: latitude (deg) for the vitamin-D-winter / SZA correction */
  latitude?: number;
  /** Optional: day of year (1–365) for the SZA correction */
  dayOfYear?: number;
}

export interface VitaminDSynthesisResult {
  /** Estimated vitamin D₃ synthesized in micrograms */
  mcg: number;
  /** Equivalent in International Units (1 mcg = 40 IU) */
  iu: number;
  /** Human-readable explanation */
  explanation: string;
}

export interface SunExposureParams {
  /** Vitamin D deficit to close, in micrograms */
  deficitMcg: number;
  /** Current (erythemal) UV index */
  uvIndex: number;
  /** Fitzpatrick skin type, number or 'fitzpatrick-N' string */
  skinType: FitzpatrickType | string;
  /** Fraction of body surface area exposed, default 0.25 */
  bodyCoverage?: number;
  /** Optional latitude (deg) for the SZA / vitamin-D-winter correction */
  latitude?: number;
  /** Optional day of year (1–365) for the SZA correction */
  dayOfYear?: number;
}

export interface SunExposureResult {
  /** True minutes of exposure needed at this UV / skin / coverage (uncapped) */
  minutesNeeded: number;
  /** Safe single-session limit (minutes) at this UV index and skin type */
  safeMaxMinutes: number;
  /** mcg synthesised by one full safe session */
  mcgPerSafeSession: number;
  /** Number of safe sessions/days to close the deficit */
  sessionsNeeded: number;
  /** True if the whole deficit fits in one safe session */
  feasible: boolean;
  /** Advisory note */
  note: string;
}

/**
 * Melanin-dependent UVB→vitamin-D efficiency relative to Fitzpatrick Type II,
 * derived from published "minutes per 1000 IU" by skin type (Type VI ≈ 4× Type II).
 * Ref: Sci Rep 2024 UV-index synthesis model; Clemens 1982; Armas 2007.
 */
const SKIN_EFFICIENCY: Record<FitzpatrickType, number> = {
  1: 1.25,    // Very fair, always burns
  2: 1.0,     // Fair, baseline reference
  3: 0.83,    // Medium, tans easily
  4: 0.56,    // Olive/moderate brown
  5: 0.42,    // Brown
  6: 0.25,    // Dark brown/black
};

/**
 * Maximum safe sun exposure (minutes) before erythema, referenced to UV Index 6.
 * Scaled by (6 / uvIndex) at call time because burn time is inversely
 * proportional to UV intensity.
 * Ref: Fitzpatrick 1988 (MED); Rhodes 2010.
 */
const SAFE_MAX_AT_UV6: Record<FitzpatrickType, number> = {
  1: 10,
  2: 15,
  3: 20,
  4: 30,
  5: 45,
  6: 60,
};

/** Baseline synthesis: 25 mcg per 15 min at UV=6, Fitz II, 25% body (SDD). */
const BASE_RATE_MCG_PER_MIN = 25 / 15; // ~1.667 mcg/min
const BASE_UV = 6;
const BASE_COVERAGE = 0.25;

/** Sunscreen SPF 30+ blocks ~95% of UVB (Matsuoka 1987, Holick 2007) */
const SUNSCREEN_FACTOR = 0.05;

/** Plateau cap: photodegradation limits per-session yield (Holick 2007) */
const MAX_PER_SESSION_MCG = 62.5; // ~2500 IU

/** Below this UV index, UVB is too weak for meaningful synthesis (WHO/Webb 2006) */
const MIN_UV_FOR_SYNTHESIS = 3;

// --- Solar geometry (for the optional vitamin-D-winter / SZA correction) ---

const DEG = Math.PI / 180;

/** Solar declination (deg) for a given day of year (Cooper 1969). */
export function solarDeclination(dayOfYear: number): number {
  return 23.45 * Math.sin(DEG * (360 * (284 + dayOfYear) / 365));
}

/** Solar zenith angle (deg) at local solar noon for a latitude + day. */
export function noonSolarZenith(latitudeDeg: number, dayOfYear: number): number {
  return Math.abs(latitudeDeg - solarDeclination(dayOfYear));
}

/**
 * Vitamin-D action-spectrum availability gate as a function of solar zenith
 * angle. UVB is cut off far more steeply than UVA as the sun gets lower, so
 * vitamin D synthesis falls to ~0 well before sunset.
 *   SZA ≤ 30° → 1.0 (sun high, full UVB)
 *   SZA ≥ 65° → 0.0 (vitamin D winter / early morning / late afternoon)
 * Ref: Engelsen 2005; Fioletov 2010.
 */
export function vitaminDAvailability(szaDeg: number): number {
  const cosHigh = Math.cos(30 * DEG); // 0.866
  const cosLow = Math.cos(65 * DEG);  // 0.423
  const c = Math.cos(Math.min(90, Math.max(0, szaDeg)) * DEG);
  return Math.max(0, Math.min(1, (c - cosLow) / (cosHigh - cosLow)));
}

/**
 * SZA correction factor normalised to the calibration condition (SZA ≈ 40°, so
 * availability ≈ 1 at calibration). Returns 1 when latitude/day are unknown so
 * callers that pass only a UV index keep the (bug-fixed) UV-index behaviour.
 */
function szaFactor(latitude?: number, dayOfYear?: number): { factor: number; sza: number | null } {
  if (latitude == null || dayOfYear == null) return { factor: 1, sza: null };
  const sza = noonSolarZenith(latitude, dayOfYear);
  // Calibration availability at SZA≈40° so we don't double-penalise normal midday sun.
  const calib = vitaminDAvailability(40);
  const factor = calib > 0 ? vitaminDAvailability(sza) / calib : 1;
  return { factor: Math.max(0, Math.min(1, factor)), sza };
}

/** Safe single-session minutes at a given UV index for a skin type. */
function safeMaxMinutes(skinType: FitzpatrickType, uvIndex: number): number {
  const base = SAFE_MAX_AT_UV6[skinType] ?? 15;
  if (uvIndex <= 0) return base;
  return Math.round(base * (BASE_UV / uvIndex));
}

/**
 * Estimate vitamin D₃ synthesized from a sun-exposure session.
 */
export function estimateVitaminDSynthesis(params: VitaminDSynthesisParams): VitaminDSynthesisResult {
  const {
    durationMinutes,
    uvIndex,
    bodyCoverage = BASE_COVERAGE,
    sunscreen = false,
    latitude,
    dayOfYear,
  } = params;
  const skinType = parseSkinType(params.skinType);

  if (uvIndex < MIN_UV_FOR_SYNTHESIS) {
    return {
      mcg: 0,
      iu: 0,
      explanation: `UV index ${uvIndex} is too low for vitamin D synthesis (need ≥ ${MIN_UV_FOR_SYNTHESIS}). ` +
        `This commonly occurs in winter at latitudes above ~35°, early morning, or late afternoon.`,
    };
  }

  const { factor: sza, sza: szaDeg } = szaFactor(latitude, dayOfYear);

  // Vitamin-D-winter hard gate: if the noon sun never gets high enough, no synthesis.
  if (szaDeg != null && sza <= 0) {
    return {
      mcg: 0,
      iu: 0,
      explanation: `At your latitude the midday sun is too low (zenith ~${Math.round(szaDeg)}°) ` +
        `for vitamin D synthesis right now — a "vitamin D winter". Use diet or a D3 supplement.`,
    };
  }

  const skinEff = SKIN_EFFICIENCY[skinType];
  const uvScale = uvIndex / BASE_UV;
  const coverageScale = bodyCoverage / BASE_COVERAGE;
  const sunscreenMult = sunscreen ? SUNSCREEN_FACTOR : 1.0;

  const rawMcg = BASE_RATE_MCG_PER_MIN
    * durationMinutes
    * uvScale
    * skinEff
    * coverageScale
    * sza
    * sunscreenMult;

  const mcg = Math.round(Math.min(rawMcg, MAX_PER_SESSION_MCG) * 10) / 10;
  const iu = Math.round(mcg * 40);

  const parts: string[] = [];
  parts.push(`${durationMinutes} min at UV ${uvIndex}, skin type ${skinType}, ${Math.round(bodyCoverage * 100)}% skin exposed`);
  parts.push(`≈ ${mcg} mcg (${iu} IU) vitamin D₃`);
  if (sunscreen) parts.push('(sunscreen reduces synthesis by ~95%)');
  if (szaDeg != null && sza < 0.9) parts.push(`(reduced ${Math.round((1 - sza) * 100)}% for low midday sun, zenith ~${Math.round(szaDeg)}°)`);
  if (rawMcg >= MAX_PER_SESSION_MCG) parts.push('(capped at session maximum — longer exposure does not increase synthesis)');

  const safeMax = safeMaxMinutes(skinType, uvIndex);
  if (durationMinutes > safeMax) parts.push(`⚠ Exceeds safe exposure for skin type ${skinType} at UV ${uvIndex} (${safeMax} min max)`);

  return { mcg, iu, explanation: parts.join('. ') + '.' };
}

/**
 * Recommend sun exposure to close a vitamin D deficit.
 * Returns the TRUE minutes needed plus a safe per-session limit and a
 * multi-session plan — it never silently clamps the number, so darker skin and
 * larger deficits surface honestly (e.g. "you'd need ~120 min; cap each session
 * at 60 min over 2 days, or expose more skin").
 */
export function recommendSunExposure(params: SunExposureParams): SunExposureResult {
  const {
    deficitMcg,
    uvIndex,
    bodyCoverage = BASE_COVERAGE,
    latitude,
    dayOfYear,
  } = params;
  const skinType = parseSkinType(params.skinType);
  const safeMax = safeMaxMinutes(skinType, uvIndex);

  const { factor: sza, sza: szaDeg } = szaFactor(latitude, dayOfYear);

  const noSynthesis = uvIndex < MIN_UV_FOR_SYNTHESIS || (szaDeg != null && sza <= 0);
  if (noSynthesis) {
    return {
      minutesNeeded: Infinity,
      safeMaxMinutes: safeMax,
      mcgPerSafeSession: 0,
      sessionsNeeded: Infinity,
      feasible: false,
      note: szaDeg != null && sza <= 0
        ? `The midday sun is too low at your latitude right now for vitamin D synthesis ("vitamin D winter"). ` +
          `Get vitamin D from fatty fish, fortified milk, egg yolks, or a D3 supplement (cholecalciferol).`
        : `UV index ${uvIndex} is too low for vitamin D synthesis. ` +
          `Get it from vitamin D-rich foods (fatty fish, fortified milk, egg yolks) or a D3 supplement.`,
    };
  }

  // Reverse the synthesis formula: time = deficit / (rate × all factors).
  const skinEff = SKIN_EFFICIENCY[skinType];
  const uvScale = uvIndex / BASE_UV;
  const coverageScale = bodyCoverage / BASE_COVERAGE;
  const effectiveRate = BASE_RATE_MCG_PER_MIN * uvScale * skinEff * coverageScale * sza; // mcg/min

  // Per-session yield is bounded by both the safe time and the photodegradation plateau.
  const mcgPerSafeSession = Math.round(Math.min(effectiveRate * safeMax, MAX_PER_SESSION_MCG) * 10) / 10;

  const targetMcg = Math.max(0, deficitMcg);
  const minutesNeeded = Math.ceil(targetMcg / effectiveRate);
  const feasible = minutesNeeded <= safeMax;
  const sessionsNeeded = mcgPerSafeSession > 0 ? Math.ceil(targetMcg / mcgPerSafeSession) : Infinity;

  let note: string;
  if (feasible) {
    note = `${minutesNeeded} min of sun (UV ${uvIndex}, skin type ${skinType}, ` +
      `${Math.round(bodyCoverage * 100)}% skin exposed) ≈ ${Math.round(targetMcg)} mcg vitamin D₃. ` +
      `Stay under the ${safeMax} min burn limit; apply sunscreen after.`;
  } else {
    const moreSkin = bodyCoverage < 0.5;
    note = `You'd need about ${minutesNeeded} min, but the safe limit at UV ${uvIndex} for skin type ` +
      `${skinType} is ${safeMax} min (≈ ${mcgPerSafeSession} mcg/session). ` +
      `Spread it over ~${sessionsNeeded} day${sessionsNeeded === 1 ? '' : 's'}` +
      (moreSkin ? `, expose more skin (shorts/short sleeves) to cut the time, ` : `, `) +
      `and/or top up with vitamin D-rich food or a D3 supplement. ` +
      `Darker skin (type ${skinType}) needs several times longer than fair skin for the same dose.`;
  }

  return {
    minutesNeeded,
    safeMaxMinutes: safeMax,
    mcgPerSafeSession,
    sessionsNeeded,
    feasible,
    note,
  };
}
