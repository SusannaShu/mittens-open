/**
 * Vitamin D Cutaneous Photosynthesis Model
 *
 * Estimates vitamin D₃ production from sun exposure based on:
 *  - UVB irradiance (approximated via UV Index)
 *  - Fitzpatrick skin type (melanin-dependent efficiency)
 *  - Exposed body surface area fraction
 *  - Sunscreen use
 *
 * Scientific basis:
 *  - Webb AR et al. (2006) "Who, what, where and when — influences on
 *    cutaneous vitamin D synthesis." Prog Biophys Mol Biol 92:17-25
 *  - Holick MF (2007) "Vitamin D deficiency." N Engl J Med 357:266-81
 *  - CIE (2006) "Action Spectrum for the Production of Previtamin D3
 *    in Human Skin." Technical Report 174
 *  - Rhodes LE et al. (2010) "Recommended summer sunlight exposure
 *    levels." Br J Dermatol 163:1118-25
 *
 * Model calibration:
 *  Baseline: ~25 mcg (1000 IU) vitamin D₃ per 15 min at UV Index 6,
 *  Fitzpatrick type II, 25% body exposed (face, arms, hands).
 *  This aligns with Holick 2007's estimate of sub-erythemal whole-body
 *  exposure producing ~250 mcg (10,000 IU), scaled to 25% surface area.
 *
 * Limitations:
 *  - Does not account for latitude/season beyond UV index
 *  - Assumes UVB fraction correlates linearly with UV index
 *  - Does not model age-related decline in 7-dehydrocholesterol
 *  - Plateau at 62.5 mcg/session reflects photodegradation equilibrium
 */

/** Fitzpatrick skin type (I–VI) */
export type FitzpatrickType = 1 | 2 | 3 | 4 | 5 | 6;

export interface VitaminDSynthesisParams {
  /** Duration of sun exposure in minutes */
  durationMinutes: number;
  /** Current UV index (0–15+) */
  uvIndex: number;
  /** Fitzpatrick skin type (1–6) */
  skinType: FitzpatrickType;
  /** Fraction of body surface area exposed, default 0.25 (face + arms + hands) */
  bodyCoverage?: number;
  /** Whether sunscreen SPF 30+ was applied */
  sunscreen?: boolean;
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
  /** Current UV index */
  uvIndex: number;
  /** Fitzpatrick skin type */
  skinType: FitzpatrickType;
  /** Fraction of body surface area exposed, default 0.25 */
  bodyCoverage?: number;
}

export interface SunExposureResult {
  /** Minutes of exposure needed (may exceed safe max) */
  minutesNeeded: number;
  /** Whether this can be achieved safely in one session */
  feasible: boolean;
  /** Advisory note */
  note: string;
}

/**
 * Melanin-dependent UVB conversion efficiency relative to Fitzpatrick Type II.
 * Type I: fair, burns easily — higher efficiency (more UVB penetrates, less melanin)
 * Type VI: darkest — lowest efficiency (melanin absorbs most UVB)
 *
 * Ref: Clemens TL et al. (1982) Lancet 1:74-6
 *      Armas LA et al. (2007) J Clin Endocrinol Metab 92:2130-5
 */
const SKIN_EFFICIENCY: Record<FitzpatrickType, number> = {
  1: 1.3,     // Very fair, always burns
  2: 1.0,     // Fair, baseline reference
  3: 0.75,    // Medium, tans easily
  4: 0.55,    // Olive/moderate brown
  5: 0.33,    // Brown
  6: 0.20,    // Dark brown/black
};

/**
 * Maximum safe sun exposure (minutes) before erythema at UV Index 6.
 * Based on Minimal Erythemal Dose (MED) by skin type.
 *
 * Ref: Fitzpatrick TB (1988) Arch Dermatol 124:869-71
 *      Rhodes LE et al. (2010) Br J Dermatol 163:1118-25
 */
const SAFE_MAX_MINUTES: Record<FitzpatrickType, number> = {
  1: 10,
  2: 15,
  3: 20,
  4: 30,
  5: 45,
  6: 60,
};

/**
 * Baseline synthesis rate: 25 mcg per 15 min at UV=6, Fitz II, 25% body.
 * Derived from Holick 2007 whole-body MED estimate.
 */
const BASE_RATE_MCG_PER_MIN = 25 / 15; // ~1.667 mcg/min
const BASE_UV = 6;
const BASE_COVERAGE = 0.25;

/** Sunscreen SPF 30+ blocks ~95% of UVB (Matsuoka 1987, Holick 2007) */
const SUNSCREEN_FACTOR = 0.05;

/** Plateau cap: photodegradation limits per-session yield (Holick 2007) */
const MAX_PER_SESSION_MCG = 62.5; // ~2500 IU

/**
 * Estimate vitamin D₃ synthesized from sun exposure.
 *
 * @param params - Exposure parameters
 * @returns Estimated synthesis amount with explanation
 */
export function estimateVitaminDSynthesis(params: VitaminDSynthesisParams): VitaminDSynthesisResult {
  const {
    durationMinutes,
    uvIndex,
    skinType,
    bodyCoverage = BASE_COVERAGE,
    sunscreen = false,
  } = params;

  // UV < 3: insufficient UVB for meaningful vitamin D synthesis
  // Ref: Webb 2006, WHO Global Solar UV Index Guide
  if (uvIndex < 3) {
    return {
      mcg: 0,
      iu: 0,
      explanation: `UV index ${uvIndex} is too low for vitamin D synthesis (need ≥ 3). ` +
        `This commonly occurs in winter at latitudes above ~35°, early morning, or late afternoon.`,
    };
  }

  const skinEff = SKIN_EFFICIENCY[skinType] ?? 1.0;
  const uvScale = uvIndex / BASE_UV;
  const coverageScale = bodyCoverage / BASE_COVERAGE;
  const sunscreenMult = sunscreen ? SUNSCREEN_FACTOR : 1.0;

  const rawMcg = BASE_RATE_MCG_PER_MIN
    * durationMinutes
    * uvScale
    * skinEff
    * coverageScale
    * sunscreenMult;

  // Cap at plateau (photoisomerization equilibrium)
  const mcg = Math.round(Math.min(rawMcg, MAX_PER_SESSION_MCG) * 10) / 10;
  const iu = Math.round(mcg * 40);

  const parts: string[] = [];
  parts.push(`${durationMinutes} min at UV ${uvIndex} (skin type ${skinType})`);
  parts.push(`≈ ${mcg} mcg (${iu} IU) vitamin D₃`);

  if (sunscreen) {
    parts.push('(sunscreen reduces synthesis by ~95%)');
  }

  if (rawMcg >= MAX_PER_SESSION_MCG) {
    parts.push('(capped at session maximum — longer exposure does not increase synthesis)');
  }

  const safeMax = SAFE_MAX_MINUTES[skinType] ?? 15;
  if (durationMinutes > safeMax) {
    parts.push(`⚠ Exceeds safe exposure for skin type ${skinType} (${safeMax} min max)`);
  }

  return {
    mcg,
    iu,
    explanation: parts.join('. ') + '.',
  };
}

/**
 * Recommend sun exposure duration to close a vitamin D deficit.
 * Prioritizes safe, sub-erythemal exposure.
 *
 * @param params - Deficit and conditions
 * @returns Recommended exposure with feasibility assessment
 */
export function recommendSunExposure(params: SunExposureParams): SunExposureResult {
  const {
    deficitMcg,
    uvIndex,
    skinType,
    bodyCoverage = BASE_COVERAGE,
  } = params;

  // UV < 3: sun exposure won't help
  if (uvIndex < 3) {
    return {
      minutesNeeded: Infinity,
      feasible: false,
      note: `UV index ${uvIndex} is too low for vitamin D synthesis. ` +
        `Consider vitamin D-rich foods (fatty fish, fortified milk, egg yolks) ` +
        `or a vitamin D3 supplement (cholecalciferol).`,
    };
  }

  // Reverse the synthesis formula: deficit = rate * time * factors
  // time = deficit / (rate * factors)
  const skinEff = SKIN_EFFICIENCY[skinType] ?? 1.0;
  const uvScale = uvIndex / BASE_UV;
  const coverageScale = bodyCoverage / BASE_COVERAGE;

  const effectiveRate = BASE_RATE_MCG_PER_MIN * uvScale * skinEff * coverageScale;

  // Account for plateau cap
  const cappedDeficit = Math.min(deficitMcg, MAX_PER_SESSION_MCG);
  const minutesNeeded = Math.ceil(cappedDeficit / effectiveRate);

  const safeMax = SAFE_MAX_MINUTES[skinType] ?? 15;
  const feasible = minutesNeeded <= safeMax;

  let note: string;
  if (feasible) {
    note = `${minutesNeeded} minutes of sun exposure (UV ${uvIndex}, skin type ${skinType}) ` +
      `could provide ~${Math.round(cappedDeficit)} mcg vitamin D₃. ` +
      `Expose face, arms, and hands without sunscreen. ` +
      `Apply sunscreen after ${minutesNeeded} minutes to prevent burns.`;
  } else if (deficitMcg > MAX_PER_SESSION_MCG) {
    note = `Your deficit (${Math.round(deficitMcg)} mcg) exceeds what one sun session can provide. ` +
      `Get ${safeMax} minutes of sun daily and complement with vitamin D-rich foods ` +
      `(salmon, sardines, fortified dairy) or a D3 supplement.`;
  } else {
    note = `You'd need ${minutesNeeded} minutes, but safe limit for skin type ${skinType} ` +
      `is ${safeMax} minutes at UV ${uvIndex}. Get ${safeMax} minutes of sun and ` +
      `cover the remaining deficit with food (fatty fish, eggs, fortified milk) ` +
      `or a vitamin D3 supplement if needed.`;
  }

  return {
    minutesNeeded: Math.min(minutesNeeded, safeMax),
    feasible,
    note,
  };
}
