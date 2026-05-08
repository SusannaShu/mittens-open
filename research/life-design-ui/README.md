# Life Design UI Reference
## Based on Bill Burnett & Dave Evans' "Designing Your Life"

This directory contains UI specs and references for implementing the Life Design features in Mittens. These should be referenced when building the daily reflection, Good Time Journal, and Odyssey Plan UI components.

---

## 1. Dashboard Gauges (Life Balance)

Four horizontal bar gauges showing overall life balance. Each gauge goes from 0 to FULL.

```
DASHBOARD
+--------------------------------------------+
| Love    [=====---------] 0 ---------- FULL |
| Play    [===-----------] 0 ---------- FULL |
| Work    [==============-] 0 ---------- FULL |
| Health  [========------] 0 ---------- FULL |
+--------------------------------------------+
```

**Implementation notes:**
- Four categories: Love, Play, Work, Health
- Each is a horizontal progress bar, 0 to 100
- User self-rates periodically (weekly? monthly?)
- Mittens can auto-suggest based on activity log data:
  - **Work:** hours worked, engagement ratings
  - **Health:** nutrition gaps, exercise frequency, sleep quality
  - **Play:** soul entries, touch_grass time, hobbies
  - **Love:** social interactions, relationships (future)
- Rendered as simple horizontal bars in our black-and-white design system
- Could be a card on the Profile tab or part of a weekly reflection

---

## 2. Good Time Journal -- Activity Log

Each activity entry has:
- Activity description (text, left side)
- **Engagement** gauge (Lo -> Flow -> Hi) -- were you in flow state?
- **Energy** gauge (NEG -> 0 -> POS) -- did it drain or energize you?

```
GOOD TIME JOURNAL -- ACTIVITY LOG
+----------------------------------------------------+
| [Activity description lines]    [Engagement] [Energy]|
|                                  Lo-Flow-Hi  NEG-0-POS|
| ____________________________    ⌒           ⌒       |
| ____________________________                         |
| ____________________________                         |
+----------------------------------------------------+
| [Activity description lines]    [Engagement] [Energy]|
|                                  Lo-Flow-Hi  NEG-0-POS|
| ____________________________    ⌒           ⌒       |
| ____________________________                         |
+----------------------------------------------------+
```

**Implementation notes:**
- Each activity from the daily timeline becomes a row
- **Engagement** = semicircle gauge, left(Lo) to right(Hi), with "Flow" marked at the peak
  - Lo: going through the motions
  - Flow: completely absorbed, lost track of time
  - Hi: very engaged but not quite flow
- **Energy** = semicircle gauge, left(NEG) to right(POS), with "0" at center
  - NEG: activity drained your energy
  - 0: neutral
  - POS: activity gave you energy
- In our app: simplify to a slider or 3-point scale (low/medium/high) to keep it lightweight
- Mittens asks during evening reflection: "How engaged were you during [activity]? Did it give you energy?"
- Over time, build pattern recognition: "Building Mittens = high engagement + high energy. Admin work = low engagement + negative energy."

**Mobile UI suggestion:**
- During evening reflection, show each time block as a card
- Swipe or tap to rate engagement (1-5 dots or a simple slider)
- Swipe or tap to rate energy (1-5 dots or a simple slider)
- Keep it FAST -- should take <2 minutes to rate a full day

---

## 3. Odyssey Plan (3 Alternative Lives)

Three 5-year timelines, each rated on four dimensions via gauge dials.

```
ODYSSEY PLAN
+----------------------------------------------------+
| Alternative Plan #__    6 word title: __________    |
| Questions this plan addresses: _________________    |
|                                                      |
| Year:  0    1    2    3    4    5                    |
|       [  ] [  ] [  ] [  ] [  ] [  ]                |
|       (timeline blocks for each year)               |
|                                                      |
|  RESOURCES    I LIKE IT    CONFIDENCE    COHERENCE  |
|    ⌒            ⌒           ⌒            ⌒         |
|  0---100     COLD--HOT    EMPTY-FULL    0---100     |
+----------------------------------------------------+
```

**Three plans:**
- **Plan 1:** Current trajectory -- what happens if you keep doing what you're doing
- **Plan 2:** What you'd do if Plan 1 was suddenly impossible
- **Plan 3:** What you'd do if money and what others think didn't matter

**Four rating gauges per plan:**
- **Resources** (0-100): Do you have the time, money, skills, contacts to pull this off?
- **I Like It** (Cold-Hot): How excited are you about this plan on a gut level?
- **Confidence** (Empty-Full): Do you believe you could make this work?
- **Coherence** (0-100): Does this plan align with your values and who you want to be?

**Implementation notes:**
- Each plan has a 6-word title (forces clarity: "Build Mittens into a company")
- 5-year timeline with milestone blocks per year
- Gauge dials for each of the 4 dimensions
- In our app: could be a dedicated section accessible from Profile
- Quarterly review: Mittens prompts you to revisit and update
- Mittens references Good Time Journal data: "Based on your engagement patterns, Plan 2 has the highest alignment with what energizes you"

**Mobile UI suggestion:**
- Swipeable cards for each of the 3 plans
- 5-year timeline as a horizontal scrollable row of blocks
- Gauges as simple arc/semicircle components or horizontal sliders
- Comparison view: all 3 plans side by side on their 4 dimensions

---

## 4. Failure Log

Table format tracking failures and categorizing them for learning.

```
FAILURE LOG
+----------+----------+----------+-----------+----------+
| Failure  | Screwup  | Weakness | Growth    | Insight  |
|          |          |          | Opport.   |          |
+----------+----------+----------+-----------+----------+
| Thought  |    ✓     |          |           |          |
| I was    |          |          |           |          |
| muted    |          |          |           |          |
+----------+----------+----------+-----------+----------+
| Audible  |          |    ✓     |           |          |
| pauses   |          |          |           |          |
+----------+----------+----------+-----------+----------+
| Unclear  |          |          |    ✓      |          |
| prese-   |          |          |           |          |
| ntation  |          |          |           |          |
+----------+----------+----------+-----------+----------+
```

**Three failure categories:**
- **Screwup:** You know better, you just messed up. Fix: build a habit/checklist.
- **Weakness:** A real gap in your abilities. Fix: accept or train.
- **Growth Opportunity:** You're stretching into something new that didn't work yet. Fix: keep trying, iterate.

**Insight column:** What did you learn? What will you do differently?

**Implementation notes:**
- Mittens can auto-detect patterns: "You've skipped lunch 3 times at D12 this week" -> screwup
- User can manually log failures in chat: "I bombed that presentation"
- Mittens asks: "Was that a screwup, weakness, or growth opportunity?" and "What's the insight?"
- Stored failures feed back into proactive suggestions: next presentation -> "Last time you felt unclear, want to run through your points with me?"

**Mobile UI suggestion:**
- List view of failure entries with category badges
- Tap to expand and add insight
- Weekly/monthly summary: "3 screwups (all lunch-skipping), 1 growth opportunity (investor pitch)"
- Keep tone compassionate, not judgmental

---

## 5. Daily Timeline / Calendar View

This is the NEW concept: the chat, when viewed in calendar mode, renders as time blocks.

```
DAILY TIMELINE -- April 8, 2026
+--------------------------------------------+
| 6:30 AM  ☀ Sunrise. Morning briefing.      |
|                                             |
| 7:00 AM  🍳 Breakfast: oats + yogurt       |
|          [=====] engagement  [=====] energy |
|                                             |
| 10:00 AM ⬛ Work: Building Mittens @ D12   |
|   - - - - - - - - - - - - - - - - - - -   |
| 12:30 PM 🥗 Lunch: salad from Sweetgreen   |
|          [=====] engagement  [=====] energy |
|   - - - - - - - - - - - - - - - - - - -   |
| 1:00 PM  ⬛ Work: Building Mittens @ D12   |
|                                             |
| 3:00 PM  ⬛ END WORK                       |
|          [=====] engagement  [=====] energy |
|                                             |
| 3:45 PM  🌿 Touch grass: Central Park      |
|          1h45m sun, UV 6, vitamin D ✓       |
|          [=====] engagement  [=====] energy |
|                                             |
| 5:30 PM  🍽 Dinner: homemade stir fry      |
|          [=====] engagement  [=====] energy |
|                                             |
| 7:00 PM  ⬛ Work: Paper writing @ home     |
|                                             |
| 9:15 PM  😴 Wind down. Bedtime prep.       |
|          [=====] engagement  [=====] energy |
+--------------------------------------------+
|                                             |
| DAILY SUMMARY                               |
| Work: 7h | Touch grass: 1h45 | Rest: 1h   |
| ♡ Love [====-----] Play [===------]        |
| ⬛ Work [=========] ✚ Health [======--]     |
+--------------------------------------------+
```

**Implementation notes:**
- During evening wind-down, Mittens generates this from the day's activity log + internal timeline
- Each block shows: time range, activity type (color/icon coded), location, duration
- Engagement + Energy gauges per block (user rates during reflection)
- Bottom: daily summary with dashboard gauges (Work/Health/Play/Love)
- Chat view and timeline view are two presentations of the same data
- Mittens extracts health data from the timeline: hours sitting, sun exposure, meals, movement
