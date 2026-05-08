# Mittens schedule science review

A check on the sunrise-anchored wake, bedtime, and 3-meals-a-day logic in `lib/services/alarmScheduler.ts`. Covers: what the current math actually does, whether the underlying assumptions match current evidence on circadian health, the edge cases where the math breaks, and concrete changes to consider for the rewrite.

## 1. What the current code does

From `lib/services/alarmScheduler.ts::scheduleBedtimeAlarms()`:

```
wakeTime   = todaySunrise
breakfast  = wakeTime
lunch      = wakeTime + 5h 50m
dinner     = wakeTime + 11h 40m
bedtime    = tomorrowSunrise - sleepHours      // sleepHours default 8
checkin    = bedtime - 1h
```

Put plainly: wake at sunrise, eat three meals spaced evenly 5h 50m apart starting at the moment you wake, and go to bed exactly `sleepHours` before tomorrow's sunrise. The 5h 50m meal spacing is the consequence of spreading three meals over an 11h 40m window, which is itself `16h waking day − 4h 20m "don't eat right before bed" buffer` when `sleepHours = 8`.

## 2. What the current evidence says

### Sleep regularity beats sleep duration

The single strongest finding in recent sleep research — UK Biobank cohort of ~61,000 adults, published in SLEEP 2024 — is that sleep *regularity* (going to bed and waking at consistent clock times) predicts all-cause mortality more strongly than sleep *duration*. The top-quintile SRI scorers slept and woke within a ~1-hour window day to day; the bottom quintile drifted by ~3 hours. Higher regularity was associated with 20–48% lower all-cause mortality.

Implication for mittens: an algorithm that shifts wake time by minutes each day (tracking sunrise) is fine. One that shifts it by hours across seasons is actively harmful.

### Morning light exposure is real, but "wake with sunrise" is a proxy, not the mechanism

Morning bright light advances the circadian phase, triggers the cortisol awakening response, and starts the ~14–16h melatonin-onset timer. What the research actually shows is that getting 5–10 minutes of outdoor light shortly after waking produces these effects — it doesn't require waking at the precise moment of sunrise. Waking at a consistent time and stepping outside works just as well.

### Chronotype is ~20–50% genetic

Large GWAS studies identify 351+ variants contributing to morningness/eveningness. Forcing an evening chronotype onto a lark's schedule produces measurable social jetlag and is associated with worse mood, higher obesity risk, and elevated depression and type 2 diabetes risk. This cuts both ways: a strict sunrise-anchored app helps morning-types and harms evening-types.

### Three meals a day holds up

Meta-analytic evidence favors 2–3 meals/day over both 1 meal and 5–6 small meals. Three meals is associated with better diet quality, stronger hunger/satiety signaling (ghrelin rises before meals, PYY rises after), and lower risk of diabetes and cardiovascular disease vs. 1–2 meals. The "graze all day" model has lost ground.

### Early time-restricted eating (eTRE) is the strongest meal-timing signal

Eating earlier in the waking day consistently outperforms eating later, even at matched calories. Typical eTRE windows are 6–10 hours ending in the early evening. Eating windows that extend late in the evening are associated with *worse* glucose, weight, and cardiometabolic outcomes. The current mittens eating window (breakfast at wake through dinner 11h40m later) is ~11h 40m — above the 10h eTRE ceiling.

### Breakfast within ~30–90 min of waking

The cortisol awakening response peaks 30–45 min after waking. Eating within 30–90 min of wake supports the normal cortisol rhythm; skipping breakfast is linked to a flattened/elevated-afternoon cortisol pattern. Eating *at the exact moment of waking* isn't harmful, but it's earlier than what most guidance recommends and doesn't align with when most people are actually hungry.

### Dinner-to-bedtime gap: 3 hours minimum, 4–6 hours ideal

Observational and controlled evidence (including an RCT on dinner timing and sleep architecture) converges on a 2–3h minimum gap between last eating and bed, with 4–6h associated with better sleep duration and lower reflux/wake-after-sleep-onset. Eating within 1h of bed measurably fragments sleep.

## 3. Math check — does the current logic produce healthy times?

Assume a mid-latitude location (e.g., NYC, ~40°N) with sunrise ≈ 6:30 AM. Using defaults (`sleepHours = 8`):

| Event | Time | Comment |
|---|---|---|
| Wake / breakfast | 6:30 AM | Breakfast at wake is earlier than the typical 30–90 min guidance but not harmful |
| Lunch | 12:20 PM | Fine |
| Dinner | 6:10 PM | Fine |
| Bedtime | 10:30 PM | Fine — assumes tomorrow's sunrise ≈ today's, which holds outside DST transitions |
| Dinner-to-bed gap | 4h 20m | In the ideal 4–6h window |
| Eating window | 11h 40m | Slightly wider than the 8–10h eTRE sweet spot |

In the summer sweet-spot case the math works. The problems show up in three places:

### 3a. Seasonal sunrise drift destroys sleep regularity

At 40°N (NYC), civil sunrise varies from ~4:24 AM in mid-June to ~7:19 AM in early January — a ~2h 55m swing across the year. If wake time follows sunrise exactly, the user's wake time drifts by ~10–20 min/week in spring and fall. Over a month this is enough to degrade the Sleep Regularity Index meaningfully, and that index is the single strongest sleep predictor of mortality. The algorithm is optimizing for "align with the sun" at the cost of the metric that actually predicts health outcomes.

### 3b. At high latitudes, the math produces absurd times

At 60°N (Helsinki, Oslo, Stockholm, Anchorage), sunrise swings from ~3:40 AM in summer to ~9:30 AM in winter. In midsummer, with `sleepHours = 8`, the scheduler would set bedtime to 7:38 PM — not usable. In midwinter it would push wake to 9:30 AM. The scheduler has no bounds or clamps on this.

### 3c. The 11h 40m meal span is hardcoded, doesn't scale with `sleepHours`

`sleepHours` only changes bedtime; meals are still anchored to `wakeTime + {0, 5h50m, 11h40m}` regardless. Result:

| sleepHours | Bedtime | Dinner | Dinner→bed gap |
|---|---|---|---|
| 6 | 12:30 AM | 6:10 PM | 6h 20m (too front-loaded for such a long day) |
| 7 | 11:30 PM | 6:10 PM | 5h 20m ✓ |
| 8 | 10:30 PM | 6:10 PM | 4h 20m ✓ |
| 9 | 9:30 PM | 6:10 PM | 3h 20m (marginal) |
| 10 | 8:30 PM | 6:10 PM | 2h 20m (below the 3h minimum) |

The 4–6h dinner-to-bed target only holds at the default `sleepHours = 8`. Someone who needs 9+ hours (teens, recovery, illness) gets an increasingly cramped dinner-to-bed gap.

### 3d. DST transitions are handled by the OS, but the user feels them

Because sunrise comes from `sunrise-sunset.org` as UTC and is converted by the OS, DST changes arrive as sudden ~1h jumps in wake and bedtime on the transition day. The scheduler doesn't smooth this. On spring-forward, users effectively lose ~1h of sleep that night (bedtime scheduled pre-shift, wake scheduled post-shift). This is a known DST problem but worth calling out because the current algorithm makes no attempt to ease it.

### 3e. "Breakfast = sunrise" is the weakest link, not the math

The math works. The assumption underneath it — that you should eat the instant you wake — is the one that diverges from the evidence. Most guidance points to 30–90 min after wake.

## 4. Is the core idea — "anchor the day to sunrise" — the best approach?

Partly yes, partly no. What's right: morning light is real and matters, three meals a day holds up, eating earlier in the waking day is genuinely better than eating late, and a consistent dinner-to-bed buffer matters. What's wrong: tying *wake time itself* to sunrise sacrifices sleep regularity (the strongest known sleep-health metric), ignores genetic chronotype (a third to a half of people are evening types whose health suffers when forced early), and produces unusable schedules above ~55° latitude.

A better framing: treat the user's *typical wake time* as the anchor, treat sunrise as a *reminder to get morning light* (and optionally a soft nudge for people who want to drift toward an earlier schedule), and derive bedtime from wake time + sleep need rather than from tomorrow's sunrise.

## 5. Concrete recommendations for the rewrite

The overall architecture (one daily anchor → derive meals and bedtime from it) is good. Change what the anchor is and add a few buffers.

**Change the anchor.** Let the user set a target wake time. For people who *want* to drift toward sunrise, offer an optional "shift toward sunrise by ≤15 min/week" mode — this gets the circadian alignment benefit without destroying sleep regularity.

**Derive bedtime from wake, not from tomorrow's sunrise.**
```
bedtime = wakeTime - sleepHours   (previous calendar day)
```
This is what the user originally described. It's mathematically equivalent when sunrise is stable day-to-day but survives DST, seasonal drift, and high latitudes cleanly.

**Parameterize meal spacing instead of hardcoding 5h 50m / 11h 40m.**
```
breakfastOffset = 45 min                    // after wake, configurable 30–90 min
dinnerBeforeBed = 4h                        // configurable 3–6h
breakfastTime   = wake + breakfastOffset
dinnerTime      = bedtime - dinnerBeforeBed
lunchTime       = midpoint(breakfast, dinner)
```
This scales correctly with any `sleepHours` and keeps the dinner-to-bed gap where the evidence puts it.

**Keep three meals as the default, but allow 2.** Evidence supports both; four or more does worse on hunger signaling and diet quality.

**Sunrise becomes a light-exposure prompt, not a wake alarm.** Push a "get 10 min of outdoor light" nudge around the user's actual wake time. This captures the circadian-alignment benefit of the original design without the sleep-regularity cost.

**Chronotype-aware defaults.** Ask during onboarding (morning type / intermediate / evening type) and set the wake anchor accordingly. Forcing an evening-type to wake at sunrise is the scenario with the clearest evidence of harm.

**Cap the eating window at 10h.** Most of the eTRE benefit shows up here. The current 11h 40m is just slightly over.

**Clamp at high latitudes.** If `|sunrise - 06:30| > 1.5h`, warn the user and either (a) pin to a fixed wake time or (b) use solar noon − 6h as a more stable anchor.

**Smooth DST.** On the DST transition day, shift wake and bedtime by 15–20 min/day over 3–4 days rather than accepting the OS's 1h jump.

## 6. Summary of the "is this the healthiest way?" answer

The core instincts behind legacy mittens — anchor the day to sunrise, eat three meals, stop eating well before bed, sleep a set number of hours — are aligned with current evidence. The specific formulas get roughly the right times at mid-latitudes with an 8-hour sleep target. The weaknesses are: wake = sunrise hurts the metric (sleep regularity) that predicts mortality most strongly, breakfast = wake is earlier than recommended, and the algorithm degrades badly at high latitudes, on DST transitions, and for non-default sleep durations. Replacing the anchor with a user-set wake time, deriving bedtime from that, and parameterizing the meal offsets fixes all of these without losing the original design intuition.

## Sources

- [Sleep regularity is a stronger predictor of mortality risk than sleep duration — SLEEP (2024)](https://academic.oup.com/sleep/article/47/1/zsad253/7280269)
- [The role of sunlight in sleep regulation — PMC (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12502225/)
- [Genetic Basis of Chronotype in Humans — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6084759/)
- [Morning or night person — Saxena Lab / Harvard MGH](https://saxena.mgh.harvard.edu/news/morning-or-night-person-it-depends-on-many-more-genes-than-we-thought/)
- [Time-restricted Eating for Prevention and Management of Metabolic Diseases — Endocrine Reviews](https://academic.oup.com/edrv/article/43/2/405/6371193)
- [Beneficial Effects of Early Time-Restricted Feeding — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8143522/)
- [Meal frequency and timing in health and disease — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4250148/)
- [Impact of Meal Frequency on Anthropometric Outcomes: Systematic Review — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7490164/)
- [Association between meal timing and sleep quality — PLOS One](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0308172)
- [Effects of Dinner Timing on Sleep Stage Distribution — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8131073/)
- [Eating or Drinking Up to 1 Hour Before Bedtime May Impair Sleep Quality — AJMC](https://www.ajmc.com/view/eating-or-drinking-up-to-one-hour-before-bedtime-may-impair-sleep-quality)
- [The Window Matters: TRE and Cortisol/Melatonin — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8399962/)
- [Female breakfast skippers display a disrupted cortisol rhythm — PubMed](https://pubmed.ncbi.nlm.nih.gov/25545767/)
- [Effects of seasons and weather on sleep patterns — npj Digital Medicine](https://www.nature.com/articles/s41746-021-00435-2)
- [Biological Rhythms During Residence in Polar Regions — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3793275/)
