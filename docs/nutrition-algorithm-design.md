# Nutrition AI — Logic Review & Algorithm Redesign

Author: Claude (for Susanna)
Date: 2026-04-17
Status: proposal

---

## 1. TL;DR

Your meal-plan pipeline has a real and subtle bug: **when a recommended food would overshoot a nutrient, the backend just trims or drops that food — it never looks for a replacement.** The food was chosen to close a specific gap; shrinking it silently means the gap isn't closed either, yet nothing else is swapped in to cover it.

The state-of-the-art in AI-for-nutrition (Feb 2026 medRxiv, NutriGen Feb 2025, multiple Frontiers reviews) has converged on a **hybrid pattern: LLM proposes candidates, a mathematical solver picks the optimal combination, supplements fill what food can't reach.** Pure-LLM systems underperform pure-solver systems on nutrient accuracy; pure-solver systems lose on personalization. Only the hybrid wins on both.

Proposed redesign: **Plan → Solve → Adjust → Supplement**, with an explicit replacement loop that asks the LLM for low-{overshoot} alternatives when the first solve leaves a gap. Supplements are a first-class fallback, not an afterthought. Bioavailability is applied as a post-processing layer.

---

## 2. Logic review of the current pipeline

Backend location: `building-fashion-future/backend_strapi/api/daily-meal-plan/controllers/daily-meal-plan.js` (~560 lines).

### What the pipeline actually does

| Phase | What it does | File:line |
| --- | --- | --- |
| **1. AI creativity** | Gemini 2.5 Flash picks foods per meal slot using `PHASE1_PROMPT`. Prompt names the gaps, dislikes, pantry, meal count. Temp 0.2. Output capped at 3 items/meal. | `daily-meal-plan.js:165-228` |
| **2. Nutrient estimation** | Calls `geminiVision.estimateNutrients()` to build 19-nutrient profiles for each picked food. | `daily-meal-plan.js:258` |
| **3. Safety pass** | For each food, computes `headroom = UL − running_total`, a per-nutrient `maxRatio = headroom / amount`, a soft cap at 150% RDA for micros. Then: if `maxRatio ≤ 0.2` → skip the food; if `< 0.9` → trim portion to `maxRatio × 100%`; else full portion. Then compute `gapCoverage` and `safetyWarnings`. | `daily-meal-plan.js:288-514` |

### The bug you're asking about

**There is no replacement step.** The "overshoot check" only modulates the portion of the food that was already picked. If your plan is `[oysters for zinc, liver for iron, spinach for folate]` and the liver would push vitamin A past its UL, the code will trim the liver to (say) 30% portion. That may keep vitamin A under the UL, but now the iron gap that liver was supposed to close is also only 30% closed — and no new iron source was added.

Concretely:

- **Phase 1 optimizes for gap-closing,** instructed via prompt.
- **Phase 3 independently enforces UL,** with no feedback to Phase 1.
- **The two objectives fight each other,** and Phase 3 silently wins by shrinking portions.
- **No retry, no substitution, no "ask the LLM for a different iron source."**

The `gapCoverage.status` can report `"no_impact"` for a nutrient after the plan is built, and the user sees "Iron still at 42%" — but by that point it's too late: the plan has already been rendered to the UI with only a passive warning.

### Other weaknesses I noticed while reading the code

These aren't the headline issue but they compound it:

1. **Nutrient estimates are noisy, and nothing downstream accounts for that.** `gemini-vision.js:94-161` asks Gemini to estimate nutrients per food — and per Susanna's empirical testing, this is actually the right call: USDA FoodData Central is strong on a narrow set of raw foods but weak on cooking-method variants and portion estimation from a photo; Open Food Facts is thin on micronutrients entirely. LLM estimation wins in practice. But the resulting nutrient vector still carries ~15-30% estimation error, and nothing in the current pipeline represents that uncertainty. UL checks treat the estimate as exact, which means the pipeline can both (a) approve unsafe plans when the real nutrient load was underestimated and (b) reject safe foods when overestimated. The fix is in the solver, not the estimator — see §4.6.
2. **Cumulative-total UL check is order-dependent.** Foods are evaluated in the order Phase 1 returned them. The first food gets full headroom; later foods in the same meal may be trimmed or skipped just because they were listed last. Not deterministic w.r.t. the "best" allocation.
3. **150%-of-RDA soft cap is a magic number** with no source cited in code. Some micros are safe at 300% (vitamin C), others risky at 110% (vitamin A retinol). A single multiplier underserves both.
4. **`absorptionMultiplier` is activity-level, not meal-level.** The literature on bioavailability (iron + vitamin C synergy, calcium blocking iron, phytates in grains, polyphenols in coffee) describes *pairwise, same-meal* effects. Those aren't modeled.
5. **Multiplicative activity stacking.** `absorptionMod *= act.absorptionMultiplier` at `nutrition-log.js:642` compounds — three activities at +10% each become 33.1%, not 30%. Minor in practice, but worth flagging.
6. **No supplement path.** Some gaps (vitamin D in winter, B12 for vegans, iron for menstruating women) cannot be closed from food alone without overshooting calories or other nutrients. The literature (CRN, Linus Pauling Institute, Optifood analyses) treats supplementation as the clinically correct fallback. Your pipeline has no output for this.
7. **No feedback loop.** No signal back from "did the user eat what you suggested?" The next plan doesn't learn.

---

## 3. Research — how others have solved AI-for-nutrition

The field has basically settled into three families of approaches. The recent winning pattern is a hybrid of 1 and 3.

### Family 1: Mathematical optimization (the classical workhorse)

Goes back to the **Stigler diet problem (1945)** and matured into **linear programming (LP)**, **mixed-integer linear programming (MILP)**, and **goal programming** for diet design.

- Optifood, WFP's "Fill the Nutrient Gap" (FNG), and CONGA are production tools used by public-health agencies to identify nutrient gaps and design food-based recommendations at the population level. See Vossenaar et al., *Nutrients* 2019, on pregnant/lactating women in Niger: LP analysis found that even an *optimized* local diet could not meet RDA for 8 of 11 micronutrients without supplementation.
- A **Jan 2025 arXiv paper** (2501.04143) uses Gurobi to solve "the perfect meal" as an LP with fractional portion weights and nutrient-ratio constraints.
- A **2023 systematic review** in *J. Optimization* (Donkor et al.) catalogs LP applications in diet optimization, noting most existing work addresses only 1–2 constraints — which is exactly Mittens' opportunity.

**Strength:** guaranteed feasibility and optimality w.r.t. the model. **Weakness:** LLMs beat solvers on personalization, variety, cultural fit, and recipe-level practicality.

### Family 2: Multi-objective evolutionary algorithms (for conflicting objectives)

Used when "close nutrient gaps" fights with "cost", "CO₂ footprint", "prep time", "variety", and "user preference".

- NSGA-II (Deb et al. 2002, the canonical reference — 50k+ citations) is the default.
- **Application of MOEA to balanced school lunches** (Mathematics 2021, MDPI) — Brazilian school-lunch menus optimized against cost + nutrient error. Newer benchmarks (AGEMOEA, SMSEMOA, in *Expert Systems with Applications* 2024) outperform NSGA-II on menu problems.
- Works well when you can express "penalty for missing RDA" and "penalty for exceeding UL" as separate objectives and let the algorithm find the Pareto frontier.

**Strength:** handles conflicting objectives gracefully. **Weakness:** slower than LP; harder to guarantee hard UL constraints (you get a frontier, not a single safe answer). Usually not needed if LP/MILP is sufficient.

### Family 3: LLM-based systems

Your current approach.

- **NutriGen** (arXiv 2502.20601, Khamesian et al. Feb 2025, code on GitHub). Uses GPT-3.5 / Llama-3.1-8B + prompt engineering + a structured nutrition DB, gets 1.5–3.7% error on **caloric** targets. Good at variety and personalization; **weaker on per-nutrient UL enforcement** — same issue you're hitting.
- **ChatDiet** (arXiv 2403.00781, 2024). LLM-augmented food recommender chatbot. Conversational, but also weak on hard constraints.
- **Closed-loop multi-agent** (arXiv 2601.04491). Image-based logging feeds an LLM-driven multi-agent controller that adapts the *next* meal plan based on what the user actually ate. This is the direction I'd recommend you explore after fixing the overshoot issue.
- **Commercial**: PlateJoy (algorithm co-developed with RDs, ~50 data points, deduplicates ingredients across recipes, strong on practicality), Eat This Much (calorie + macro allocator, weaker on micronutrients), MyFitnessPal AI (tracking-heavy, not optimization-heavy). None publish their algorithm details — but consistently, the apps that feel good use a **curated recipe DB** rather than asking the LLM to invent nutrient values.

**Strength:** natural language, preferences, cultural fit, recipe-level realism, variety. **Weakness:** LLMs can't *solve* a constrained optimization. They hallucinate and overshoot.

### The winning pattern: LLM + solver hybrid

Published Feb 2026, medRxiv 10.64898/2026.02.14.26346312: **"ChatGPT with Mixed-Integer Linear Programming for Precision Nutrition Recommendations."** Compared three approaches on five clinically complex patient profiles:

| Criterion | LLM only | MILP only | MILP + LLM |
| --- | --- | --- | --- |
| Nutrient Accuracy | lowest | **4.93** | 3.96 |
| Personalization | lowest | weak | **3.81** |
| Practicality | lowest | weak | **3.99** |
| Variety | lowest | 4.10 | ≥ 3.6 |

**The hybrid won across all four criteria.** MILP-only slightly beats hybrid on pure nutrient accuracy but loses badly on practicality and personalization, which is what keeps users engaged.

This pattern is the direct answer to your question.

---

## 4. Proposed algorithm — "Plan → Solve → Adjust → Supplement"

Keep the LLM. Add a solver. Add an explicit replacement loop. Add supplements as a first-class output. Layer bioavailability on top.

### 4.1 Overall flow

```
┌────────────────────┐
│ 1. PLAN (LLM)      │  Ask Gemini for ~2x more candidate foods than needed,
│   candidate set    │  tagged by gap each food targets, plus 1-2 alternates
└─────────┬──────────┘  per food (same-category, user-preferred swaps).
          │
          ▼
┌────────────────────┐
│ 2. ESTIMATE        │  Keep current Gemini-based estimation — it's better on
│   nutrients        │  cooking method + portion-from-photo than DB lookup.
│   (+ confidence)   │  ADD: ask Gemini to also return a confidence tier
│                    │  per food (high/med/low) and a ±% for the micros it's
│                    │  least sure about. Feed into solver safety margin.
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 3. SOLVE (MILP)    │  Pick portions over ALL candidates to:
│   optimal portion  │    minimize gap + overshoot penalty
│   combination      │    subject to UL hard constraints + calorie envelope
└─────────┬──────────┘
          │
          ▼
   ┌─────────────┐
   │ Uncovered    │── no ──▶ Go to step 5
   │ gap > 20%? │
   └──────┬──────┘
          │ yes
          ▼
┌────────────────────┐
│ 4. ADJUST (LLM)    │  Ask LLM: "need more {nutrient}, but cannot add
│   replacement loop │  {overshoot_nutrient}. Suggest 3 foods dense in
│   (max 2 passes)   │  {nutrient} but LOW in {overshoot_nutrient}."
└─────────┬──────────┘  Add to candidates, re-solve.
          │
          ▼
┌────────────────────┐
│ 5. SUPPLEMENT      │  For any gap still uncovered after 2 loops, compute
│   fallback         │  exact deficit, recommend supplement form + dose
│                    │  from curated DB. Flag co-administration rules.
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 6. BIOAVAILABILITY │  Post-process: apply pairwise same-meal effects
│   adjust           │  (iron + vit C synergy, calcium blocks iron, etc.).
│                    │  Output plan + "eat X at lunch, not with Y at dinner."
└────────────────────┘
```

### 4.2 The solver step in detail

This replaces the current Phase 3 trim/skip block in `daily-meal-plan.js:288-514`.

**Decision variables** for each candidate food *i*:

- `x_i ∈ [0, 1.5]` — portion multiplier, continuous
- Optionally `z_i ∈ {0,1}` — include/exclude, if you want minimum-portion-or-nothing semantics (MILP)

**Hard constraints (must be satisfied):**

For each nutrient *n* with a UL:

```
current_intake[n] + sum_i (x_i * nutrients[i][n]) <= UL[n]
```

For each meal slot *m*:

```
sum_{i in slot m} z_i >= 1         (at least one item)
sum_{i in slot m} z_i <= 3         (keep your existing 3-item cap)
```

For calories:

```
target_cal * 0.9 <= sum_i x_i * nutrients[i].calories <= target_cal * 1.1
```

**Objective (minimize):**

```
  w_gap   * sum_n max(0, RDA[n] - (intake[n] + plan_contrib[n])) / RDA[n]
+ w_over  * sum_n max(0, plan_contrib[n] - 1.2 * RDA[n]) / RDA[n]
+ w_var   * variety_penalty(selected_foods)
+ w_pref  * dislike_penalty(selected_foods)
+ w_port  * sum_i penalty_if_portion_weird(x_i)
```

Suggested weights to start: `w_gap = 10`, `w_over = 3`, `w_var = 1`, `w_pref = 2`, `w_port = 1`. Tune against real user plans.

**Implementation options for Node/Strapi:**

- **`javascript-lp-solver`** (npm, pure JS, zero native deps, ~fine for <100 variables — your problem is ~15-30 vars). Start here.
- **`glpk.js`** (GLPK compiled to JS/WASM, handles MILP properly).
- If you ever outgrow those: call a Python microservice that runs **PuLP + CBC** or **Google OR-Tools**. OR-Tools is free, industrial-grade, and the closest thing to Gurobi without the license.

### 4.3 The replacement loop (the thing you're missing today)

Pseudocode for what goes between the first solve and the supplement step:

```js
let candidates = phase1Candidates;
for (let pass = 0; pass < 2; pass++) {
  const solution = solve(candidates, constraints);
  const uncoveredGaps = gaps.filter(g =>
    (solution.coverage[g.nutrient] / g.rda) < 0.80
  );
  if (uncoveredGaps.length === 0) break;

  // Find which UL constraints bound the problem
  const bindingOvershoots = solution.bindingConstraints
    .filter(c => c.type === 'UL')
    .map(c => c.nutrient);

  // Ask LLM for replacements that break the conflict
  const newFoods = await askGeminiForReplacements({
    needMore: uncoveredGaps.map(g => g.name),
    avoidHighIn: bindingOvershoots,
    dislikes: user.dislikes,
    pantry: user.pantry,
  });
  candidates.push(...await estimateNutrients(newFoods));
}
const finalPlan = solve(candidates, constraints);
```

The LLM prompt for adjustment is the critical piece. Something like:

> The user still needs {X mg} more {iron}. We cannot add foods high in {vitamin A} because that would exceed the safe upper limit. Suggest 3 foods that are rich in {iron} but contain less than {threshold mcg} of {vitamin A} per serving. Format: JSON array of `{name, portion_g, reason}`. Exclude: {dislikes}.

This is what Phase 1 was *supposed* to do but can't, because at Phase 1 time the solver hasn't run yet.

### 4.4 Supplement fallback

When food-only solutions can't close a gap within UL constraints, route to supplementation. Literature says this is correct (CRN position statement; Linus Pauling Institute's "Micronutrient Inadequacies: The Remedy"; the Dietary Guidelines for Americans, which explicitly endorse supplementation for nutrients consistently under-consumed).

Data model:

```ts
interface SupplementRec {
  nutrient: string;           // e.g., "vitamin_d"
  deficitAmount: number;      // mcg/mg still needed after plan
  form: string;               // e.g., "cholecalciferol (D3)"
  suggestedDose: number;
  unit: string;
  rationale: string;          // "Winter + indoor lifestyle; food alone capped at 60% RDA"
  timingNote?: string;        // "Take with a meal containing fat"
  avoidWith?: string[];       // ["iron supplements within 2hrs"]
  cautions?: string[];        // "Stop 2 weeks before surgery"
}
```

Curate a small JSON table of ~20 common supplements with safe ranges, forms, and co-administration rules. Don't ask the LLM to invent these — clinical risk.

### 4.5 Estimation uncertainty — a safety margin in the solver

Because Gemini's nutrient estimates are still point estimates with real error, the solver should not treat ULs as exact thresholds. Two simple patches:

**Safety margin on ULs.** Use `UL_effective = UL × (1 − ε)` inside the solver, where `ε` reflects estimation uncertainty. Suggested starting values:

- `ε = 0.15` for foods Gemini marked "high confidence" (canonical items — chicken breast, banana, bowl of rice)
- `ε = 0.25` for "medium confidence" (composite dishes, mixed salads)
- `ε = 0.35` for "low confidence" (complex restaurant dishes, novel foods, low-light photos)

You already pass `verified` and `nutrient_source` through the pipeline; add a `confidence` field alongside. Ask Gemini for it in Phase 2 explicitly: "return `confidence: 'high' | 'medium' | 'low'` based on how certain you are about the micronutrient values." This is cheap and meaningfully safer than pretending estimates are exact.

**Graceful-degradation rule.** If the solver's best solution still breaches a UL *with* the safety margin applied, don't ship the plan — drop back to a more conservative mode where any food with `confidence == 'low'` is replaced with a `confidence == 'high'` alternate, even if variety takes a hit. Better to repeat chicken breast than to silently exceed vitamin A.

**Selective DB cross-check — only where it actually helps.** Don't replace Gemini's estimates, but do cross-check on the handful of canonical "trap" foods where DB values are solid and the nutrient-density is extreme enough to matter for UL safety:

- Liver (retinol), brazil nuts (selenium), sardines (calcium + vitamin D), fortified cereals (B-vitamins + iron), salmon (vitamin D + omega-3), spinach/kale (vitamin K)
- If Gemini identifies one of these and its estimate differs from USDA FDC by more than 2× on a UL-gated nutrient, trust the DB for *that nutrient only*. Keeps Gemini's portion/cooking intelligence while catching the specific outlier cases where a hallucinated retinol number could matter clinically.
- ~20 foods is enough; the problem is not "DB is better in general" but "there's a narrow set of foods where the micronutrient density is high enough and the DB value is stable enough that an LLM miss is actually dangerous."

### 4.6 Bioavailability post-processing

A small rules table applied after the plan is finalized:

```js
const BIOAVAILABILITY_RULES = [
  { when: meal => hasIron(meal) && hasVitaminC(meal, 25),
    effect: { iron: 1.5 }, note: "Vit C boosts iron absorption" },
  { when: meal => hasIron(meal) && hasCalcium(meal, 300),
    effect: { iron: 0.6 }, note: "Calcium blocks iron; separate by 2hrs" },
  { when: meal => hasIron(meal) && hasTeaOrCoffee(meal),
    effect: { iron: 0.6 }, note: "Polyphenols block iron" },
  { when: meal => hasFatSoluble(meal) && !hasFat(meal, 5),
    effect: { vitamin_a: 0.5, vitamin_d: 0.5, vitamin_e: 0.5, vitamin_k: 0.5 },
    note: "Fat-soluble vitamins need ~5g+ fat to absorb" },
  { when: meal => hasZinc(meal) && hasPhytates(meal),
    effect: { zinc: 0.7 }, note: "Whole grains/legumes reduce zinc absorption" },
];
```

Apply after the MILP solve, recompute coverage, surface the interaction notes in the UI as little chips under each meal.

---

## 5. Integration into the existing backend

These are concrete, low-risk edit targets in `building-fashion-future/backend_strapi/api/daily-meal-plan/`:

| Change | File | What |
| --- | --- | --- |
| Expand candidate pool in Phase 1 prompt | `daily-meal-plan.js:165-196` | Ask for 5-8 foods per meal with 1-2 alternates each; tag each with `targets_gap: "iron"` |
| Add `confidence` field to Phase 2 output | `gemini-vision.js:94-161` | Ask Gemini to return `confidence: "high"/"medium"/"low"` per food. No DB swap — Gemini's portion + cooking-method reasoning outperforms USDA FDC / OpenFoodFacts in practice (confirmed empirically on this app). |
| Replace trim/skip block with solver | `daily-meal-plan.js:288-514` | New `solveMealPlan()` calling `javascript-lp-solver` or `glpk.js`; apply UL safety margin by confidence tier |
| Selective DB cross-check on ~20 canonical foods | new file `services/trapFoodCheck.js` | Only for liver/brazil nuts/sardines/etc. where DB values are stable and an LLM miss is clinically risky |
| Add replacement loop | same file, after first solve | Max 2 passes; each pass calls new `askGeminiForReplacements()` |
| Add supplement recommender | new file `api/supplement-rec/services/recommend.js` | Rule-based against a curated supplement DB |
| Bioavailability post-processor | new file `api/daily-meal-plan/services/bioavailability.js` | Apply rules to final plan |
| Return shape additions | `daily-meal-plan.js:488-502` + `types.ts` in frontend | Add `supplements: SupplementRec[]`, `bioavailabilityNotes: string[]`, `replacementLog: Array<{pass, food, reason}>` for debugging |

### Staged rollout — because "just want it to work" means ship something fast

**Week 1 — stop the bleeding (low effort, high value):**

- Replace trim/skip with a single-pass greedy: for each uncovered gap after trimming, ask Gemini for one replacement food and retry. This alone fixes the bug you asked about.
- Add supplement fallback with a curated 10-nutrient table.

**Week 2-3 — real solver:**

- Drop in `javascript-lp-solver`. Model soft gap penalty + hard UL constraints. Keep the LLM candidate generation.
- Swap the greedy retry for a proper replacement loop (max 2 passes).

**Week 4-6 — quality layer:**

- Selective USDA FDC cross-check on the ~20 "trap foods" from §4.5 — trust DB only when Gemini's value on a UL-gated nutrient differs by ≥2×. Don't replace Gemini's estimates wholesale; prior testing on this app showed DB lookup loses to Gemini on cooking-method + portion-from-photo + micros.
- Bioavailability post-processor.
- Telemetry: log `(plan_id, solved_in_ms, loops_used, uncovered_gaps_pre, uncovered_gaps_post, supplements_recommended)` to measure whether the change actually closes gaps.

**Later (feedback loop):**

- Track what the user logs vs what was planned. Feed back as a "preference score" per food. Over weeks, the candidate generator learns.
- Consider the closed-loop multi-agent architecture (arXiv 2601.04491) if you ever want next-meal adaptation.

---

## 6. Evaluation — how to know if it's actually better

Build a small eval harness *before* shipping. 10-20 seed user profiles with realistic gap sets, run both pipelines, compare:

- **Gap-closure rate:** % of gaps brought to ≥80% RDA by the plan (hard metric; should go up)
- **UL breach rate:** % of plans with any nutrient > UL (should go to ~0)
- **Silent under-delivery:** % of plans where a food was trimmed and the gap it was meant to close ended up uncovered (the bug metric; should go to ~0)
- **Variety score:** unique foods across a 7-day plan (should not regress)
- **Preference adherence:** % of recommended foods that survive a user's dislike list (should be ~100%)
- **Latency:** end-to-end ms for plan generation (solver adds some cost; stay under 3s)

This harness doubles as a regression suite — run it in CI when the prompt or solver weights change.

---

## 7. Sources

### Academic
- [ChatGPT with Mixed-Integer Linear Programming for Precision Nutrition Recommendations](https://www.medrxiv.org/content/10.64898/2026.02.14.26346312v1) — Feb 2026, medRxiv — the direct precedent for the hybrid approach
- [NutriGen: Personalized Meal Plan Generator Leveraging LLMs](https://arxiv.org/abs/2502.20601) — Khamesian et al., Feb 2025 — LLM-only baseline with caloric accuracy
- [NutriGen code (GitHub)](https://github.com/SamanKhamesian/NutriGen)
- [A Closed-Loop Multi-Agent System Driven by LLMs for Meal-Level Personalized Nutrition Management](https://arxiv.org/abs/2601.04491) — future direction
- [ChatDiet: Empowering Personalized Nutrition-Oriented Food Recommender Chatbots through an LLM-Augmented Framework](https://arxiv.org/html/2403.00781v2)
- [Linear Optimization for the Perfect Meal (Gurobi)](https://arxiv.org/abs/2501.04143) — Jan 2025
- [An AI-based nutrition recommendation system (Mediterranean)](https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2025.1546107/full) — Frontiers in Nutrition 2025
- [A Review of the Use of Linear Programming to Optimize Diets, Nutritiously, Economically and Environmentally](https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2018.00048/full) — Frontiers in Nutrition
- [A Systematic Review of Linear Programming Techniques Applied to Diet Optimisation](https://onlinelibrary.wiley.com/doi/10.1155/2023/1271115) — Donkor et al., J. Optimization 2023
- [Application of Multi-Objective Evolutionary Algorithms for Planning Healthy and Balanced School Lunches](https://www.mdpi.com/2227-7390/9/1/80) — Mathematics 2021
- [Open-source multi-objective optimization software for menu planning](https://www.sciencedirect.com/science/article/abs/pii/S0957417424010790) — ESWA 2024 (AGEMOEA, SMSEMOA)
- [Micronutrient interactions: effects on absorption and bioavailability](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/1C2517BF4026FED0003C86E0E993AF48/S000711450100109Xa.pdf/micronutrient_interactions_effects_on_absorption_and_bioavailability.pdf)
- [Iron Absorption: Factors, Limitations, and Improvement Methods](https://pubs.acs.org/doi/10.1021/acsomega.2c01833) — ACS Omega
- [NSGA-II: A Fast and Elitist Multiobjective Genetic Algorithm](https://sci2s.ugr.es/sites/default/files/files/Teaching/OtherPostGraduateCourses/Metaheuristicas/Deb_NSGAII.pdf) — Deb et al.

### Clinical / public-health
- [Comprehensive Nutrient Gap Assessment (CONGA)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7947985/)
- [Optifood LP analysis of pregnant/lactating women in Niger](https://www.mdpi.com/2072-6643/11/1/72) — concrete example of "food alone can't fix these gaps"
- [The "Fill the Nutrient Gap" analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC6767452/) — WFP methodology
- [Micronutrient Inadequacies: the Remedy — Linus Pauling Institute](https://lpi.oregonstate.edu/mic/micronutrient-inadequacies/remedy)
- [Addressing nutritional gaps with multivitamin and mineral supplements](https://pmc.ncbi.nlm.nih.gov/articles/PMC4109789/)
- [Nutrient gaps and how dietary supplements can help fill them — CRN](https://www.crnusa.org/access/Nutrient-gaps-and-supplements)

### Commercial
- [PlateJoy — Healthline review](https://www.healthline.com/nutrition/platejoy) — algorithm co-developed with RDs, ~50 data points
- [Eat This Much](https://www.eatthismuch.com/) — macro allocator
