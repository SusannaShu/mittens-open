# Mittens Roadmap

## Vision

Mittens is your AI habit tracker, educator, and life co-designer. **Get your sh*t together** -- physical health first, or mental health will never keep up.

Mittens teaches you how to live a healthy, balanced, and fulfilling life based on research and science. Nutritious meals, hydration, sleep, movement, sun exposure, avoiding long hours of sitting. Everything involves AI and machine learning to make data input effortless and find the best solutions for you. Not a nag. Not a guilt trip. A real education on how to live well, practiced daily.

**Health is the #1 priority.** Everything else -- productivity, social life, life design -- serves keeping you healthy. Sleep, nutrition, movement, sun, hydration.

**Rigorous and science-based.** Every tracked factor in Mittens is backed by peer-reviewed research. We don't guess what matters -- we research it (NIH, Harvard, CDC, Sleep Foundation, MSU). But we also recognize that science describes averages, not individuals. The Memory system lets users and Mittens store personal conditions (medications, medical conditions, shift work, preferences) so Mittens interprets data through your specific context, not generic recommendations.

**Offline-first, privacy-first.** Your health data is yours. Run local Gemma models on your phone, use your own API key, save everything locally. Sync to Strapi or pay for cloud tokens only when you choose to. Full trust. Works everywhere, with or without internet.

**One app. No sub-apps. No master-app spinoff.** Everything lives here.

The chat is the primary interface. You talk to Mittens (text, photo, or voice) and Mittens talks back -- with contextual nudges, proactive suggestions, and a nightly conversational check-in. Text box is the main input; voice works via in-app mic button (speech-to-text fills the text box, TTS speaks reply back) and hands-free via Siri ("Hey Siri, tell Mittens...").

**Runtime:** Expo dev client on physical iOS/Android device (not Expo Go). Required for native CoreLocation, CMMotionActivity, HealthKit access, and local model execution.

**Model:** Default Gemini 2.5 Flash (free tier). Users can choose Claude Sonnet/Opus in Profile > Integrations, or run local Gemma on-device for free, offline inference. Stage 1 capabilities check always uses Gemini Flash for cost efficiency; Stage 2 (main reply, SmartExtract) uses the user's chosen model.

**Motto:** Mittens is not just an app -- it's a manifesto of what I believe and how I live my life. Different conditions, issues, and life approaches always welcomed. Get your sh*t together.

**Hackathon alignment.** This vision aligns with the [Gemma 4 Good Hackathon](https://www.kaggle.com/competitions/gemma-4-good-hackathon) -- harnessing Gemma to drive positive change. Mittens is built to run locally, respect privacy, and make health education accessible to everyone.

---

## Tab Structure

| Tab | Icon | Purpose |
|-----|------|---------|
| **Today** | sun | Daily nutrient dashboard, meals, pantry, life balance gauges, focus timer, sleep + activity logging |
| **Mittens** | message-circle | Chat + camera combined. The primary interface. Text, snap photos, talk. |
| **Reflect** | calendar | Daily reflection, engagement/energy ratings, cross-day pattern analysis |
| **Places** | map | Location intelligence with movement trails, known places, geofencing |
| **Profile** | user | Life design identity -- bio, memory, integrations, model selection |

---

## Done

### Advanced Location & Health Intelligence
- **Location tracking & Geofencing**: CoreLocation significant change tracking converted into map visualizations with paths and automatic activity log conversions.
- **Focus Timer**: Native deep-work focus timer synchronized seamlessly with Google Calendar.
- **Solar & UV Intelligence**: Meal and sleep schedules dynamically adapt to Local Mean Solar Time (LMST). Vitamin D synthesis dynamically calculated using live geolocation and weather-inferred UV index.
- **Metabolic Hydration Story**: True hydration tracking that properly accounts for water content isolated from food logs.

### On-Device Intelligence (Private Mode)
- **Local Gemma inference working on Pixel 7a**: Gemma 4 E2B (instruction-tuned) running via LiteRT-LM SDK, model bundle fetched on-demand from Hugging Face (`litert-community/gemma-4-E2B-it-litert-lm`, 2.58 GB, not checked into repo). CPU default (Tensor G2 GPU delegate ~ CPU or slower due to kernel-launch overhead + thermal throttling).
- **Benchmarks (Pixel 7a CPU)**: Vision food ID ~22s, Stage 1 Router 7.16s, Food ID text 7.60s, Chat 29.74s, avg 14.83s.
- **Decoupled inference + storage**: AI engine selection (Gemma/Gemini/Claude) is independent from data storage mode (Cloud/Local). Default hybrid: Gemma for private on-device inference + Cloud (Strapi) for backed-up data. Users toggle each independently in Profile > Integrations.
- **Multi-photo vision**: All photos in a message are saved to permanent storage and sent to Gemma in a single `generateWithImages` call (LiteRT-LM supports `Message.of(ImageFile, ImageFile, ..., Text)` natively). Falls back to single-image analysis until native rebuild.
- **Auto-initialization**: Gemma model downloads and loads on app launch when inference mode is set to `gemma`, regardless of data storage mode. Non-blocking background init.
- **Corrupt download detection**: Multi-layer validation (`isModelDownloaded`, `validateAndCleanModel`) detects partial/corrupt 2.58 GB model files and auto-deletes them, preventing native `TF_LITE_PREFILL_DECODE` crashes.
- **Photo persistence**: Photos saved to permanent `documentDirectory/photos/` (not cache). URIs stored in message records for persistence across app restarts.
- **Caption-aware meal typing**: User's caption keywords (Breakfast/Lunch/Dinner/Snack) take priority over AI's time-based guess.
- **Per-call token caps tuned for small-model reality**: not about cost (local is free) -- about latency (linear in output tokens) and parse correctness (tight stop sequences prevent trailing explanations that break `JSON.parse`).
- **Cloud data sync when online**: When data mode is Cloud, Gemma inference results (messages, meals, activities) are saved to Strapi via existing API. Photos upload to Cloudinary during cloud save.

### Smart Nutrition & Life Design
- **Smart Meal Planning & Nutrition Tracking**: AI-driven mathematically optimized nutrient recommendations that adapt dynamically based on actual food logs, existing gaps, and preferences.
- **Pantry & Grocery Integration**: Generate meals instantly from what you have on hand, and smartly build your grocery list (with "dislike" rejection capability to fine-tune recommendations).
- **Holistic Health Focus**: Analyzes the "Life Balance" directly from activity logs through a rigorous health-first perspective.
- **Reflective Modals & Stanford Method**: Deep reflection through the calendar using the actionable "Stanford Designing Your Life" methodology, tracking accurate engagement and energy scores.
- **Smart Conversational System**: An omni-aware conversational log that captures daily routines intuitively.
- **Model Selection System**: Easily modify the "brain" powering Mittens to suit exact context and intelligence needs.

### Personalized Onboarding
- Multi-step flow: name, biometrics (Imperial/Metric), Fitzpatrick skin typing
- Stores native units, no lossy conversion

### Editable Biological Profile
- Dynamic edit form with `cm/kg` <-> `in/lbs` toggles
- Activity levels (Sedentary to Extra Active) with database sync
- Mifflin-St Jeor engine for real-time TDEE and macro calculations

### Two-Phase AI Extraction
- **Phase 1 (Vision, temp 0.7)**: Identifies food items, portions, cooking methods, and AEIOU activity context from photos. Does NOT estimate nutrients.
- **Phase 2 (Knowledge, temp 0.1)**: Text-only call using Phase 1 output. Estimates all 19 required nutrients per item. Lower temperature for precision.
- Separation prevents cognitive overload -- asking an AI to identify AND estimate in one call collapses accuracy.
- Both `smartExtract` (meal logging) and `generate` (meal planning) use this two-phase pattern.
- Manual text entry: "venti matcha latte from starbucks" also routes through Phase 2 for nutrient estimation.

### Nutrients-First Adaptive Meal Planning (MILP Solver)
- **Auto-generation**: Plan generates automatically when none exists for today. No manual button needed -- `useEffect` triggers the 7-step pipeline in the background with a loading state.
- Computes exact nutrient deficits first: "Iron: 44% (8mg of 18mg RDA). NEED 10mg more."
- Detects which meals have already been logged today -- only plans remaining meals
- **MILP Solver**: `javascript-lp-solver` replaces the old greedy approach. Globally optimizes food selection across all meals to maximize gap closure while respecting constraints.
- **Nutrient safety tiers** (IOM/NIH-based) control overshoot behavior:
  - Tier 0 (macros): No penalty (envelope constraints handle)
  - Tier 1 (Vitamin K, B12, potassium, magnesium, omega-3): No penalty -- no UL from food
  - Tier 2 (Vitamin C, B6, folate, E, calcium, D): Mild penalty only past 150% RDA
  - Tier 3 (Vitamin A, iron, zinc): Strong penalty past 100% RDA -- real toxicity risk
- **Individual ingredients**: LLM generates each ingredient as a separate candidate ("1 cup oatmeal", "2 tbsp peanut butter") instead of compound dishes. Solver selects optimal combinations.
- **Bioavailability pipeline**: Checks nutrient interaction pairs (e.g., calcium blocks iron absorption, vitamin C enhances it). Generates absorption notes per meal.
- **Supplement recommender**: When food alone can't close gaps (e.g., Vitamin D), recommends specific supplements with dosage.
- Phase 2 estimates nutrients for all planned items
- Computes `gapCoverage` map: `{iron: {currentPct: 44, afterPlanPct: 98, status: "covered"}}`
- **Clean grocery list**: Individual purchasable items (not recipe descriptions), with "Have it" (add to pantry) and "Dislike" action buttons
- Auto-regenerates in background when user confirms a meal in chat
- Activity nutrient impacts (exercise depletion, absorption modifiers) factored into gap calculations

### Clean Meal Plan UI
- **Meal cards**: Show only meal name + ingredients (comma-separated) + prep tip. Clean, scannable.
- **Tap for detail modal**: Tapping a meal card opens a slide-up modal showing:
  - Full ingredient list
  - Cooking instructions (prepTip)
  - Nutrient coverage with +% chips per nutrient gap closed
  - Bioavailability/absorption notes (positive in green, warnings in orange)
  - Sourcing breakdown (from fridge vs needs buying)
- **Nutrient bars**: Show only current intake (solid bar). No projected percentages -- plan details live in the modal.
- **Per-nutrient chat removed**: No "Ask Mittens" buttons on individual nutrients. Holistic "Discuss with Mittens" link for the full plan instead.

### Smart Fridge & Pantry Inventory
- Snap open fridge, Gemini identifies items with freshness ratings
- Inventory view with color-coded freshness dots
- Grocery intelligence: cross-references nutrient gaps and suggests what to buy

### AI-First Nutrient Estimation
- Gemini Vision estimates nutrients directly from food photos and descriptions (via Phase 2)
- USDA/Open Food Facts resolvers used when available (tiered: USDA > OFF > AI estimate)
- Activity entries (sun, workout, etc.) log separately with `entryType: 'activity'`
- Re-estimation: flag any AI-estimated nutrient for re-analysis with original image context

### "Talk to Mittens" Chat
- Natural language conversational AI with no-nonsense tone
- **Capabilities-aware pipeline**: Mittens sees a manifest of all data sources (READ: nutrition, pantry, mealPlan, activities, failures, sleep, calendar, locationHistory, messageSearch, memory) and decides what to pull per message. Also has WRITE actions (memoryUpdates, pantryUpdate, activityDetection, sleepLog, failureLog, reflectionUpdate) -- Mittens doesn't just read, it acts.
- Auto-logging: mention eating something and Mittens logs it
- **Ask-don't-guess AEIOU**: Only stores what the user explicitly shares. Rich context ("2-hour hike in prospect park with Jake, it was amazing") fills A/E/I automatically; only asks about what's still missing.
- **Immediate activity reflection**: After logging a new activity, Mittens asks about engagement/energy while the experience is fresh, not waiting for nightly check-in.
- **Weighted life categories**: Activities map to multiple dimensions with weights (friend's art show = {play: 0.6, love: 0.3, health: 0.1}). Not rigid single-category.
- Failure detection: identifies mistakes, forces classification (screwup/weakness/growth), demands actionable insight
- Reframe strategy: when stuck, guides through 4-step Designing Your Life reframe process
- Life memory: auto-saves enduring preferences, habits, and patterns from conversations. Can add new notes, update existing ones when things change ("now prefers evening workouts"), or remove outdated info.
- **Message search**: "remember when I told you about sarah's divorce?" -- Mittens searches past conversations by keyword and includes relevant history as context.
- **Data transparency**: Reply bubbles show "Checked: sleep data, activities" so users see what Mittens pulled.
- **Location-aware context**: Uses known location but doesn't over-assume environment ("coding + home" but doesn't guess "at desk" -- you might be working from bed).
- **Conversational activities**: Extended chats about people, gossip, team dynamics logged as social activities with play/love weighting.

### Nightly Conversational Check-in
- Conversational, one question at a time (not a report dump)
- Starts with a one-sentence recap, asks about the most important unreflected activity
- Pulls `sourceMessage` context so Mittens knows what the user already shared that day
- Tracks `pendingReview` in message metadata for multi-turn follow-up
- Covers all events: activities, meals, sleep, walking -- uses AEIOU metrics
- Auto-detected activities (from location geofence) get priority for confirmation

### Native Services (Dev Client)
- **Location service**: CoreLocation geofencing + significant change monitoring. Logs enter/exit at known places. Exit handler cross-references calendar events and updates with actual timing/location.
- **Google Calendar OAuth**: Syncs events at sunrise. Calendar events track `status` (scheduled/attended/modified/skipped), `actualStartTime`, `actualEndTime`, `actualLocation`.
- **Alarm scheduler**: Context-aware scheduling for sunrise briefing, nightly check-in, bedtime enforcement. Uses `react-native-push-notification`.
- **Sleep logging**: Sleep-log API with quality, duration, energy on waking, structured environment data, date-range queries.
- **Voice**: In-app mic button (speech-to-text), TTS reply playback via `expo-speech`.

### Life Design Engine (Profile Tab)
- All sections collapsible (collapsed by default) with icons
- Odyssey Plan placeholder (3 alternative life paths)
- Failure Log: live data table with category icons and insights
- Your Team placeholder: Mittens as default team member
- Integrations: Location service toggle, Calendar sync status, Sleep settings
- Nutrients moved to Today tab (Profile is for life design, not daily tracking)

### Life Balance Dashboard (Today Tab)
- Four horizontal gauge bars: Work, Health, Play, Love
- Always visible at the top of Today, expanded by default, collapsible
- Shows `--` with muted styling when no activity data exists
- Hint text: "Log activities with Mittens to populate your life balance."
- Auto-populates from activity-log dashboard API with weighted category distribution
- **Tappable gauges**: expand inline to show contributing activities with weighted time
- Tapping an activity in the breakdown opens ActivityEditModal
- Icons per dimension: monitor (Work), heart (Health), star (Play), users (Love)

### Reflect Tab (Calendar Journal)
- **Day view**: CalendarDayView with time blocks for activities, Google Calendar events, sleep, meals
- **Week view**: CalendarWeekView showing all event types (activities, calendar, sleep) across 7 days
- Google Calendar events deduped by `googleEventId` -- events already converted to activities don't show twice
- Calendar events are tappable: opens ActivityEditModal pre-populated for conversion to activity
- "Today" button for quick return to current date
- Date navigator with day-by-day scrolling
- Engagement scale (1-10) with Lo/Flow/Hi labels
- Energy scale (-5 to +5) with Drained/Neutral/Energized labels
- Cross-day pattern analysis (30 days): activity type frequency + avg engagement/energy
- Side-by-side layout for overlapping events (ported from Google Calendar)
- Click any block to open edit modal (ActivityEditModal, SleepEditModal, EditModal)
- Color-coded by type: activity (gray), meal (light gray), calendar (blue), sleep (purple)

### Reflected vs Unreflected vs Planned

All events in the calendar have a visual state determined by their temporal position and reflection data:

| State | Border | Reflection fields | Visual |
|---|---|---|---|
| **Planned** (future) | Dotted | Hidden (hasn't happened) | Dimmed opacity |
| **Unreflected** (past) | Dotted | Available but empty | Normal opacity |
| **Reflected** (past + data) | **Solid** | Filled | Normal opacity |
| **Synced calendar** | Dotted (blue) | Available if converted to activity | Normal opacity |

Reflection detection per type:
- Activity: has `engagement` or `energy` filled
- Sleep: has `quality` or `energy` filled
- Meal: has `energy` filled
- Calendar: never reflected (external, unless converted to activity)

### Science-Based Sleep Reflection

SleepEditModal with structured pills backed by peer-reviewed research:

| Factor | Options | Scientific Basis |
|---|---|---|
| Quality | Poor / Fair / Good / Great | Self-reported sleep quality |
| Energy on waking | -5 to +5 scale | Post-sleep energy (primary outcome in sleep research) |
| Room temperature | Too hot / Comfortable / Too cold | Cool rooms (65-68F) promote deeper sleep (Harvard, NIH) |
| Light exposure | Dark / Some light / Bright | Light suppresses melatonin production (NIH, CDC) |
| Noise level | Quiet / Some noise / Loud | Noise causes sleep fragmentation (Sleep Foundation) |
| Screen before bed | None / <30min / 30min+ | Blue light inhibits melatonin (UC Davis) |
| Caffeine timing | None / Before 2pm / After 2pm | 6-hour half-life affects sleep onset (Harvard) |

Environment data stored as structured JSON in `environment` field. Both initial logging and editing support all fields.

### Science-Based Meal Reflection

Eating context pills in ManualEntryModal and EditModal, backed by NIH, Harvard, MSU, and Cleveland Clinic:

| Factor | Options | Scientific Basis |
|---|---|---|
| Energy after eating | -5 to +5 scale | Post-prandial energy (metabolic indicator) |
| Eating pace | Rushed / Moderate / Slow | Slower eating improves satiety signals (Harvard, NIH) |
| Chewing | Minimal / Moderate / Thorough | Mechanical breakdown increases bioavailability (MSU, physiology.org) |
| Distraction | Focused / Some / Distracted | Distracted eating leads to overconsumption (NIH) |
| Stress level | Calm / Moderate / Stressed | Stress diverts blood from digestion (Cleveland Clinic) |
| Social context | Alone / With others | Social facilitation affects portion sizes (NIH) |

### Date-Flexible Logging
- ManualEntryModal accepts `initialDate` prop (used by Reflect tab to set date to currently viewed day)
- Date picker with chevron navigation (Yesterday / Today / Tomorrow / date labels)
- Sleep defaults to yesterday when logging before 2 PM (you're logging last night, not tonight)
- Future dates show "Planning" indicator and hide reflection fields (they haven't happened yet)
- Auto-apply time picker: time updates live as you type -- no explicit checkmark needed

### Sleep Log Enhancements
- New `energy` (integer -5 to +5) and `environment` (text/JSON) fields in sleep-log model
- SleepEditModal: full edit modal matching ActivityEditModal design, with all structured environment pills
- Delete sleep log support (backend + frontend)
- Date-range queries (`sleepStart_gte`, `sleepEnd_lte`) for week/month view data
- Click sleep blocks in Reflect to open SleepEditModal

### Meal Log Enhancements
- New `energy` (integer -5 to +5) and `eatingContext` (text) fields in nutrition-log model
- Eating context pills available in both initial logging (ManualEntryModal) and editing (EditModal)

### Week View Parity
- CalendarWeekView refactored to accept unified `CalendarEvent[]` (not just activities)
- Renders all event types: activities, meals, synced calendar events, sleep
- Side-by-side overlap layout (ported overlap algorithm from CalendarDayView)
- Reflected vs unreflected visual distinction (solid vs dotted borders)
- Future events dimmed
- Fetches calendar events and sleep logs for the full week range
- Click any block to open the appropriate edit modal via unified `handleEdit` handler

### SmartExtract -- Multi-Entry Detection (Two-Phase)
- **Phase 1**: ONE Gemini call reads ALL photos + user caption, extracts every entry (meals + activities) with AEIOU context. Does NOT estimate nutrients.
- **Phase 2**: Text-only call estimates nutrients for all identified food items using nutritional knowledge.
- Multi-intent: "hackathon icebreaker in chelsea, they gave a sandwich" + 3 photos = 1 meal + 1 social activity + 1 work activity
- AEIOU filled from what the user explicitly shared in text/photos. Dimensions not mentioned are left empty and asked about.
- Activities logged immediately with `sourceMessage` relation linking back to the chat message that triggered the log
- Backend dedup: same activity type within 30 min from same source is skipped
- After meal confirmation, meal plan auto-regenerates for remaining meals

### Unified Chat Log Cards
- ALL detected entries show as cards in chat, not just meals
- Horizontally scrollable cards when 2+ entries detected
- Meal cards: pending (white, Edit/Dismiss/Confirm actions)
- Activity cards: pre-confirmed (green border, checkmark, already logged by backend)
- Confirm button only applies to pending entries (meals)
- Gemini's conversational reply shown above cards
- Merged all non-fridge detection branches into one unified handler

### Editable Activity Logs (Today Tab)
- Activity rows now tappable with "Edit" button
- ActivityEditModal bottom sheet: edit title, duration, engagement (1-10), energy (-5 to +5)
- AEIOU preview shows auto-filled dimensions from SmartExtract
- Delete activity with confirmation
- Backend PUT /activity-log/:id/reflect expanded to accept logName, duration_min, activityType, location, intensity

### Unified Today Timeline
- LOGGED TODAY section merges meals + activities into one time-sorted timeline
- Each entry type has distinct icon (monitor=work, users=social, coffee=meal, etc.)
- Meals show "Edit" linking to existing meal edit modal
- Activities show "Edit" linking to new ActivityEditModal

### Merge Snap into Chat (Chat-First)
- **Camera lives inside chat.** Tap the camera icon in the chat input to snap or pick from gallery.
- **Text-only messages also trigger activities.** No photo needed.
- **Multi-intent extraction.** One prompt handles meals, workouts, work, social, etc.
- Remove the standalone Snap tab; all camera interaction flows through chat.

### The 7 Pillars of Health (Sub-Gauges)
Health gauge expanded into an interactive, 7-pillar model based on modern longevity and chronobiology research:
1. **Nutrition:** Macronutrients, micronutrients, RDA gaps.
2. **Movement:** 150-300 min/week Zone 2 cardio + 2x weekly strength.
3. **Sleep:** Quantity, quality, sleep debt tracking.
4. **Gut Health:** Dietary pattern tracking (target: 4-6 servings fermented foods/week, 8 fiber types/week, low ultra-processed ratio).
5. **Touch Grass (Nature):** Target 200-300 min/week in *actual* natural environments for peak cortisol/immune benefits.
6. **Circadian/Light Hygiene:** Morning sun exposure, limiting screen time before bed.
7. **Brain Hygiene:** Minimum 10-15 min/day of expressive journaling or mindfulness. Tracking 'doomscroll-free' days.

*UI:* Tapping the Health gauge expands the sub-bars inline. Tapping a sub-bar opens a modal with metrics, contributing logs, actionable suggestions, and a `[+] Why this matters` accordion citing peer-reviewed science. "Ask Mittens why" button generates a targeted chat prompt.

### 3-Phase Activity Impact Pipeline
All activity inputs (manual, chat, photo) run through a 3-phase pipeline:
- **Phase 1 (Recognition):** SmartExtract/manual form captures raw facts: what, where, how long. Empirical metadata only (METs, isStrength, isNature). No inference.
- **Phase 2 (Life Design Inference):** AI infers AEIOU + life category weights (work/health/play/love summing to 1.0) using 30-day pattern history. Per-category reasoning.
- **Phase 3 (Health Impact):** Deterministic computation of 7-pillar health deltas with peer-reviewed citation keys. Nutrient impact, METs validation. Temperature 0.0.
- Pipeline runs async after save (non-blocking). Results stored as `impactLedger` JSON on the activity entry.
- Implementation: `activity-impact-pipeline.js` service with `getPatternHistory()`, `inferLifeDesign()`, `computeHealthImpact()`, `runPipeline()`.

### Auditable Impact Ledger
Every health metric is explainable via reasoning and science-backed citations.
- **ImpactLedgerView** component in ActivityEditModal: shows life balance weights with reasoning, health pillar deltas with expandable inline citations (source, journal, DOI link), metabolic/nutrient impact, and "Ask Mittens why" button.
- **Health Pillar Drilldown**: tapping any pillar opens a modal showing contributing logs (which activities, meals, or sleep logs affected this pillar, by how much, and why) with tappable DOI links.
- **Citations database** (`citations.js` backend / `citations.ts` frontend): 25+ peer-reviewed sources (White et al., Xie et al., Stanford 2021, Valdes et al., etc.).
- `pillarContributors` aggregated in `getDashboardGauges()` with fallback for legacy entries.

### Enriched Activity Form
Activity tab in ManualEntryModal expanded beyond name/type/duration:
- Photo capture (1-3 photos, uploaded to Cloudinary)
- Location text input alongside duration
- Engagement scale (1-10 tappable pills)
- Energy scale (-5 to +5 tappable pills)
- AEIOU quick-select pills: Environment (Indoor/Outdoor/Nature/Urban/Home/Office), Interactions (Solo/1-2/Small/Large group), Objects (Screen/Physical/Nature/Mixed)
- All fields passed to backend and saved. Photos uploaded to Cloudinary and attached as image relations.

---

## Next Steps

### 1. Camera Pendant Wearable
A small wearable pendant (Xiao ESP32-S3 Sense: camera + IMU + BLE) that captures images on large movement and lets you double-tap to send messages to Mittens. The ultimate zero-friction logging device.
- **Automatic detection:** No manual logging -- the pendant takes pictures itself, so Mittens knows what you're doing, eating, and drinking, including condiment amounts.
- **Cooking intelligence — delta pattern:** Serial photos from meal prep run through Gemma in "what changed?" mode, not "what's everything?" Each frame returns `{added, removed, modified}` with a gesture field (`via`: squeeze / pour / sprinkle / chop / fold-in / flip / stir). Captures condiment pours, lemon squeezes, and cooking method directly -- things a finished plate can never show. Flags char severity per frame, applies nutrient-damage coefficients (heat-labile vit C / folate / B1 / B6) to the Impact Ledger.
- **Eating capture + duration:** Hand-to-mouth IMU pattern + frame → auto-logs meal. Start/end timestamps give eating duration → pace. Research observation (not prescription): fast eating (<15 min) links to weaker satiety signaling. Pattern surfaced, user decides.
- **Nutrient cascade shown live:** When a new item lands (lemon juice added to spinach plate), the metabolism engine applies interactions (vit C × non-heme iron bioavailability +2–3×). The audit UI shows what Gemma saw, what it added, and how the nutrient math moved.
- **Grocery store mode:** When the pendant detects you're at a grocery store, it tracks items you pick up and put in your cart, auto-updating your pantry with freshness timestamps.
- **Pantry awareness:** Every time the pendant sees your pantry/fridge items, it updates freshness estimates.
- **Movement-triggered capture with backoff:** IMU wake → camera capture. 3 consecutive "nothing interesting" frames (scratching, reaching for glasses) → sleep interval extends (30s → 2min → 5min) until next context change. Cheap false-positive path.
- **Double-tap messaging:** Quick hardware interaction to send voice/text messages to Mittens without pulling out your phone.

### 2. Smart Pantry Auto-Deduction
- When you log a home meal that includes items from your pantry, Mittens automatically deducts those quantities from inventory.
- Cross-references meal ingredients with pantry items by name and type.
- Your pantry stays accurate without manual updates -- cook with 2 eggs, and your egg count drops by 2.

### 3. Chat Organized by Day (Dual View)
- **All messages are timestamped.**
- Chat history has **date dividers** (like iMessage): "Wednesday, April 8"
- Each day is a folder/section you can scroll through
- Morning briefing is always the first message of each day
- Activity log entries appear inline as they're logged: meals, workouts, work sessions, etc.
- Chat becomes a **daily journal** you can look back on -- every day is a story
- **Timeline / Calendar View:** Toggle to see the same day as time blocks:
  ```
  6:30 AM   Sunrise. Morning briefing.
  7:00 AM   Breakfast: oats + yogurt
  10:00 AM  Work: Building Mittens @ D12
  12:30 PM  Lunch: salad from Sweetgreen
  1:00 PM   Work: Building Mittens @ D12
  3:45 PM   Touch grass: Central Park (1h45, UV 6)
  5:30 PM   Dinner: homemade stir fry
  7:00 PM   Work: Paper writing @ home
  9:15 PM   Wind down. Daily reflection.
  ```
- Each time block shows: duration, activity type, location
- During evening reflection, engagement/energy ratings are added per block
- Mittens extracts health data from the timeline: hours sitting, sun exposure, meals, movement

### 4. Morning Briefing
- Every morning at sunrise, Mittens sends a chat message. Dot indicator shows unread count.
- **Morning message includes:**
  - Today's schedule highlights from Google Calendar
  - Weather + UV index (vitamin D opportunities)
  - Nutrient gaps from yesterday
  - Proactive suggestions ("You've been grinding hard, I put 'touch grass' on your calendar at 4pm. Central Park looks nice today.")
  - Cycle-aware adjustments (iron, carbs) if synced
  - Workout context (gym day = protein bump)
  - Soul callbacks ("Cherry blossom season is starting, perfect time to visit Central Park")
- Runs as a scheduled job on the backend, pushed to the app.

### 5. Mittens' Internal Timeline
- **Mittens always knows what you're doing.** For every moment of the day, Mittens maintains a timeline:
  - **Synced calendar:** Google Calendar events (webhook + morning fetch via legacy `@mittens`)
  - **User-logged:** Activities the user sends via chat (text or photo)
  - **Inferred:** Gaps filled from location data, HealthKit, or patterns
- **If something isn't in the synced calendar, Mittens creates its own internal calendar entry.** "gonna work on building mittens at d12" becomes a work block on the internal timeline even if it's not on Google Calendar.
- **Duration inference:** If user doesn't specify how long, Mittens:
  1. Checks calendar for end time of matching event
  2. Checks location data (like legacy `@mittens` GPS tracking) -- still at D12? still working.
  3. Asks: "How long are you working?" or "Still at D12?"
  4. Infers from next activity: user sends a meal photo at 1pm, so work block was 10am-1pm.

### 6. Evening Reflection (Wind-Down)
- **When winding down, Mittens builds a visual timeline of your day** from all logged + inferred activities.
- The day renders as time blocks (like a calendar) so you can see exactly what you did:
  - 10am-3pm: Working at D12 (5h)
  - 3:45-5:30pm: Touch grass at Central Park (1h45)
  - 7-9pm: Paper writing at home (2h)
- **For each block, Mittens asks (Good Time Journal style):**
  - "How engaged were you?" (low / medium / high -- quick tap)
  - "Did it give you energy or drain you?" (drained / neutral / energized -- quick tap)
- **Then AEIOU -- digging into the WHY.** For activities with notable engagement or energy (high or low), Mittens follows up:
  - **A**ctivity: "What were you actually doing? Was it structured or unstructured? Were you leading or participating?"
  - **E**nvironment: "What was the place like? How did it make you feel?" (D12 lab = focused? coffee shop = creative?)
  - **I**nteractions: "Were you working with people or solo? Formal or informal? New interactions or familiar?"
  - **O**bjects: "What tools were you using?" (laptop, whiteboard, nature, food)
  - **U**sers: "Who else was there? What role did they play in making it good or bad?"
- Mittens uses AEIOU to **discover what you actually like and don't like.** Not just "I liked working at D12" but "I liked building Mittens solo on my laptop at D12 in the morning when the lab is quiet."
- Most AEIOU data is inferred from context (calendar location, photos, chat messages). Mittens only asks follow-up questions for the blocks that stand out.
- **Then Mittens fills the dashboard gauges** for the day:
  - **Work** (auto-calculated from hours + type)
  - **Health** (auto from nutrition, exercise, sleep, sun)
  - **Play** (from soul entries, touch_grass, hobbies)
  - **Love** (from social interactions, relationships)
- **Gap-filling:** If the calendar shows D12 10am-3pm but user didn't send anything during that time, Mittens asks:
  - "What did you do today at D12? How did you like it?"
  - "Were you sitting all day or did you get up and move around?"
- **Health extraction:** Mittens pulls health data from the timeline:
  - Total sitting hours (sedentary risk)
  - Sun exposure duration + vitamin D estimate
  - Meals logged vs. skipped
  - Exercise / movement blocks
  - Sleep timing vs. target
- Should take <2 minutes for quick rating, longer if user wants to dig into AEIOU for specific blocks.

### 7. Activity Log (Backend)
- Expand beyond `nutrition-log` to a general **activity log** with typed entries:
  - **meal** -- food with nutrients (existing flow, same results UI)
  - **workout** -- from HealthKit, calendar, or user snap/text
  - **work** -- grinding, studying, lab time, sedentary tracking
  - **social** -- hangouts, dinners, events
  - **touch_grass** -- outdoor time, nature, sun exposure, vitamin D
  - **soul** -- personal joy moments, interests, things that make the user happy
  - **rest** -- sleep, downtime, recovery
- Mittens infers activity type from photos, text, and calendar context
- Each type triggers its own confirmation UI before logging
- Logged activities feed back into the omni-context engine
- **Soul entries are special:** Mittens extracts interests (artists, places, seasonal events) and stores them as life memory tags. These power proactive callbacks weeks or months later.

### 7b. Life Metabolism Engine (Unified Tracking System)

**Core idea:** Your whole life is metabolism. Food is intake. Activities are burn. Mood modulates absorption. Sleep determines tomorrow's baseline. Location and calendar tell Mittens what you're doing without you saying a word. Every moment of your day feeds into one continuous metabolic picture.

This isn't a nutrient tracker with an activity feature bolted on. The metabolism engine is the **unified model** that connects everything: what you eat, what you do, how you feel, where you are, and what's on your calendar. Mittens tracks the full cycle.

---

#### The Full Day Cycle

```
  INTAKE (food)          BURN (activities)           MODIFIERS (state)
  +-----------+          +---------------+           +----------------+
  | breakfast  |          | biking to park |           | mood: social   |
  | lunch      |   NET    | sun at park    |   TRUE    | sleep: 7h good |
  | snacks     | ------> | coding 6h      | -------> | stress: medium |
  | dinner     |  nutrients| gym session   |  gaps     | cortisol: low  |
  +-----------+          +---------------+           +----------------+
                                                            |
                                                     absorption multiplier
                                                     (good mood + good sleep
                                                      = 100% absorption.
                                                      bad sleep + stress
                                                      = 70% absorption)
                                                            |
                                                      TOMORROW'S BASELINE
```

---

#### Nutrient Impact Profiles

Every activity has a metabolic fingerprint. These run continuously throughout the day as events are logged or inferred:

| Activity | Produces (+) | Depletes (-) | Modifiers | Notes |
|----------|-------------|-------------|-----------|-------|
| **Sun exposure** | +vitamin D (skin synthesis) | -- | -- | Scales with duration, UV index, skin type, coverage, sunscreen |
| **Biking / cycling** | +vitamin D (if outdoor) | -magnesium, -potassium, -sodium, -zinc, -iron (sweat), -calories | -- | Hot weather = more electrolyte loss. Distance matters. |
| **Running / cardio** | +vitamin D (if outdoor) | -magnesium, -potassium, -sodium, -iron, -B vitamins, -calories | -- | High impact = iron loss (foot-strike hemolysis) |
| **Strength training** | -- | -protein (muscle repair), -zinc, -magnesium, -calories | +protein absorption window (post-workout) | Post-workout protein window = 2h |
| **Walking** | +vitamin D (if outdoor) | -calories (mild) | -- | Low burn but sun benefit |
| **Desk work / coding** | -- | -B vitamins (mental energy), -magnesium (tension/cortisol), -vitamin A (screens) | -absorption (cortisol from long sessions) | 4h+ = cortisol spike = worse absorption for rest of day |
| **Stress / deadline** | -- | -B vitamins, -vitamin C, -magnesium, -zinc | -absorption (cortisol up = gut function down) | Acute stress more depleting than chronic |
| **Social / fun** | -- | -- | +absorption efficiency (lower cortisol, better gut) | Good mood = better nutrient utilization |
| **Sleep (good)** | +recovery efficiency, +next-day baseline | -- | +absorption next day | 8h quality = 100% baseline reset |
| **Sleep (bad)** | -- | -- | -20-30% absorption next day | Compounds: 2 bad nights = worse than 1 |
| **Rest / nap** | +recovery, +mental clarity | -- | reduces cortisol burden | Mid-day nap partially resets cortisol |
| **Commute (transit)** | -- | -B vitamins (stress if crowded) | -- | Passive time, low impact |
| **Cooking** | -- | -calories (mild) | +meal awareness (better portions) | Cooking your own food = better nutrient tracking |

---

#### How the Engine Computes Daily State

```
1. INTAKE: Sum all food nutrients (existing getDailyTotals)
2. BURN:   Sum all activity nutrient depletions
3. BOOST:  Sum all activity nutrient productions (vitamin D from sun, outdoor exercise)
4. NET:    net_nutrient = intake + boosts - burns
5. MOOD MODIFIER: aggregate mood/energy from events throughout the day
   - social lunch + fun hangout = cortisol down = absorption up
   - 6h grinding + deadline stress = cortisol up = absorption down
6. ABSORPTION: apply absorption multiplier to net nutrients
   - base = last night's sleep quality (100% if good, 70-80% if bad)
   - adjusted by mood/stress throughout the day
   - social buffer: hanging with friends partially offsets desk stress
7. TRUE GAPS: compare absorbed nutrients against RDA
8. TOMORROW: today's sleep quality sets tomorrow's absorption baseline
```

**Example full day:**
```
7:00  Breakfast: oats + yogurt + berries       [+calcium, +fiber, +B vitamins]
7:30  Bike to Central Park (45 min, 11 mi)     [-magnesium, -potassium, -iron, -sodium]
8:15  Sun at park (1h, UV 6, no sunscreen)      [+vitamin D: 15 mcg]
9:30  Bike home (45 min)                        [-magnesium, -potassium, -iron]
10:30 Code at D12 (4h straight)                 [-B vitamins, -magnesium, cortisol+]
12:30 Lunch: salad from Sweetgreen               [+iron, +folate, +vitamin C]
1:00  Code at D12 (3h more)                     [-B vitamins, cortisol++]
4:00  Hang with friends at coffee shop           [cortisol reset, +absorption]
6:00  Dinner: homemade stir fry                  [+iron, +zinc, +vitamin A]

Mittens says at 9pm:
"Big day. You biked 90 min and got great sun -- vitamin D is fully covered.
But 7h of desk work burned through your B vitamins and magnesium hard.
The hangout with friends helped your absorption recover from the cortisol.
Net: you're -23% magnesium, -15% B6. Dark chocolate and almonds tonight
would close the gap. Your iron took a double hit from biking (sweat)
but the stir fry partially covered it -- still -8% though.
Tomorrow: eat magnesium-rich breakfast. Maybe oats with pumpkin seeds."
```

---

#### Context Sources (How Mittens Knows)

Mittens doesn't need you to tell it everything. The engine pulls from:

| Source | What it provides | Update frequency |
|--------|-----------------|------------------|
| **Google Calendar** | Scheduled events, locations, people, event types | Webhook + morning fetch |
| **Location (geofence)** | Enter/exit known places (D12, Central Park, home, gym) | On enter/exit (passive) |
| **Location (significant change)** | ~500m moves via cell tower, combined with motion | On move (passive) |
| **Motion (CoreMotion)** | Stationary/walking/cycling/running/driving | Continuous (near-zero battery) |
| **Apple Health / HealthKit** | Workouts, steps, heart rate, sleep, menstrual cycle | Background observer |
| **Weather / UV** | Temperature, UV index, conditions at user's location | Hourly at current location |
| **User chat** | Explicit logs ("just had matcha", "heading to gym") | On message |
| **Photos** | EXIF timestamps, visual context (meal, outdoor, gym) | On capture |
| **Memory** | Habits, preferences, patterns ("never wears sunscreen") | Persistent, grows over time |

**The engine fuses all sources to build a continuous timeline.** Calendar says "yoga at 6pm" + motion says "walking" at 5:45pm + geofence says "entered gym" at 5:55pm = Mittens knows you walked to yoga and are at the gym. No manual logging needed.

---

#### Cascading Events (One Thing Affects Everything)

The key insight: **events don't happen in isolation.** A single activity cascades through the whole system:

```
User bikes to Central Park (45 min)
  -> depletes: magnesium, potassium, iron, sodium, calories
  -> if sunny: produces vitamin D during the ride too
  -> increases hunger -> next meal matters more
  -> reduces cortisol (exercise = stress relief) -> improves absorption
  -> but if it's hot: extra electrolyte depletion
  -> evening reflection: "how engaged were you?" -> energy data
  -> over time: "biking days correlate with better sleep and higher engagement"
```

```
User codes for 6 hours straight
  -> depletes: B vitamins, magnesium
  -> cortisol rises -> absorption efficiency drops
  -> Mittens nudges at hour 3: "get up and stretch, your magnesium is tanking"
  -> if followed by social hangout: cortisol partially resets
  -> if followed by more coding: compounds -- "you've been sedentary 8h today"
  -> evening reflection: "were you in flow or just grinding?"
  -> over time: "6h+ coding days always leave you drained. 4h max seems to be your sweet spot."
```

---

#### Implementation

- Each activity entry gets an `activityMeta.nutrientImpact` object computed at log time
- Impact magnitudes scale with duration, intensity, and conditions (weather, UV, temp)
- AI estimates initial impacts; user habits refine over time ("I always bike hard" = higher depletion)
- `getDailyTotals` aggregates: food intake + activity boosts - activity burns, then applies absorption multiplier
- Nutrient gap recommendations become activity-aware and explain WHY:
  - "You're low on magnesium (-23%). You biked 45 min and coded 6h today -- that's why."
  - "Great sun today -- 40 min at UV 6 with no sunscreen. Your vitamin D is covered."
- Mood-energy data from evening reflection feeds back into absorption model over time
- Sleep quality from HealthKit or user report sets next day's absorption baseline

### 8. Life Memory
- **Core (done):** Mittens saves notes in 5 categories: health, activities, energy, preferences, routines.
  - Actions: add new, update existing (with `oldNote` match), remove outdated.
  - Memory is always loaded into context -- Mittens sees what it already knows before responding.
  - "User says they switched to oat milk" -> updates the old "soy milk" preference.
  - Surfaced in Profile -> Memory section with manual notes.
- Mittens also takes notes on patterns observed over time:
  - "User works at D12 lab (Mon/Wed/Sat 10am-3pm)"
  - "User always gets oat milk in coffee"
  - "User has been working 12-hour days this week"
  - "User likes going to Central Park when weather is nice"
- **Soul memory (next)** -- things that bring you joy:
  - "User went to Brat concert, loves Charlie XCX" -- watch for tour dates, new releases
  - "User photographed cherry blossoms in Central Park in April" -- remind next spring
  - "User loves sunset photos from rooftops" -- suggest rooftop spots on clear evenings
  - "User collects interesting coffee shops" -- note new ones near calendar locations
- Memory informs proactive suggestions and conversational tone
- Soul callbacks appear naturally in morning briefings and chat: "Cherry blossom season is back! Less grinding, more grass touching."

### 9. Stanford Life Design Integration
- Bring in principles from Bill Burnett & Dave Evans' *Designing Your Life* framework.
- Mittens becomes a **life design system**, not just a health tracker.
- **UI reference:** See `research/life-design-ui/README.md` for detailed component specs, gauge designs, and mobile UI suggestions.

**Dashboard Gauges (Life Balance):**
- Four dimensions rated over time: **Love**, **Play**, **Work**, **Health**
- Each is a horizontal bar from 0 to FULL
- Mittens auto-populates from activity log data, user can adjust
- Tracked weekly/monthly to see trends in life balance
- Surfaced during evening reflection and weekly summaries

**Good Time Journal:**
- Every activity gets an optional **engagement** (Lo -> Flow -> Hi) and **energy** (NEG -> 0 -> POS) rating.
- Rendered as gauge dials per activity block during evening reflection (see timeline view).
- Ratings: simple tap interaction (low / medium / high) kept lightweight so user actually does it.
- Over time, Mittens identifies patterns: "You're most engaged when building Mittens, but drained by admin work. Maybe we should protect your mornings for deep work."

**AEIOU Analysis:**
- For each logged activity, Mittens captures or infers:
  - **A**ctivities -- what you were doing (coding, eating, walking)
  - **E**nvironments -- where (D12 lab, Central Park, home)
  - **I**nteractions -- who or what you interacted with (solo, with Sarah, with code)
  - **O**bjects -- tools or things involved (laptop, food, nature)
  - **U**sers -- who else was around (alone, team, crowd)
- Most of this is inferred automatically from calendar, photos, and messages -- user doesn't fill out a form.
- Mittens surfaces AEIOU insights: "You're happiest outdoors with friends. Your lowest energy days are solo desk work at home."

**Failure Log:**
- When things don't go well, Mittens helps you categorize:
  - **Screw-up** -- you know better, just messed up (forgot to eat lunch)
  - **Weakness** -- a real gap to work on (can't say no to overcommitting)
  - **Growth opportunity** -- a stretch that didn't work yet but could (presenting to investors)
- Table format: Failure | Screwup | Weakness | Growth Opportunity | Insight
- Mittens notices patterns: "You've skipped lunch 3 times this week when you're at D12. That's a screw-up pattern -- want me to set a reminder?"
- Keeps it compassionate, not judgmental.

**Odyssey Plan (3 Alternative Lives):**
- Periodically (quarterly?), Mittens helps you think about 3 alternative versions of your next year:
  - Plan 1: Current trajectory (what happens if you keep doing what you're doing)
  - Plan 2: What you'd do if Plan 1 was impossible
  - Plan 3: What you'd do if money and opinions didn't matter
- Each plan has: 6-word title, 5-year timeline with milestone blocks
- Rate each on 4 gauge dimensions: **Resources** (0-100), **I Like It** (Cold-Hot), **Confidence** (Empty-Full), **Coherence** (0-100)
- Mittens references your Good Time Journal data: "Based on your engagement patterns, Plan 2 has the highest alignment with what energizes you."
- Stored as a living document in the app, revisited each quarter.

**Life Design Team (Radical Collaboration):**
- From Burnett & Evans: "You do not design your life alone." Your team helps you hear your own ideas, provides counsel (not advice), and supports prototyping.
- **Mittens is always on your team.** Mittens fills the role of mentor, supporter, player, and counsel by default. If the user doesn't have anyone, Mittens IS the team. AI was not available when these principles were written -- Mittens changes that.
- **Team roles** (from the book):
  - **Allies / Supporters** -- People who care about your wellbeing. Provide feedback, encouragement, listening.
  - **Players** -- Actively involved in your life design. Do things with you: project partners, gym buddies.
  - **Intimates** -- Family and closest friends. Most affected by your choices. Always keep informed.
  - **Mentors** -- Provide counsel, not advice. Help you think for yourself, sharpen insights, reframe beliefs.
- **Counsel vs Advice:** A mentor helps you think. Advice pushes someone else's reality on you. Mittens always gives counsel -- asks questions, reframes, never prescribes.
- **Team rules:** Respectful, Confidential, Participative, Generative (build ideas, don't tear them down).
- **Relationship Map:** Auto-populated from AEIOU `users` field. Every person mentioned in activities gets tracked with name, role, context, interaction count, avg energy, avg engagement.
- **Team metrics:**
  - Who energizes you vs drains you (from activity energy ratings when person is in AEIOU)
  - Interaction frequency: "You haven't seen [name] in 2 weeks"
  - Role coverage: are all 4 roles filled? If not, Mittens fills the gap
  - Team meeting cadence (from calendar/activity logs)
- **Mittens as team member:**
  - Always available for counsel: "Let me reframe that for you"
  - Tracks your engagement/energy patterns better than any human could
  - Remembers every conversation, every failure, every insight
  - Never cancels, never judges, never gets tired
  - Knows your Odyssey Plan, your failure log, your AEIOU trends
  - Can be your only team member when you're starting out
- Default team on first run: just Mittens. As user shares who they spend time with, people appear and can be assigned roles.

**Reframe Strategy (Getting Unstuck):**
- Integrated into failure detection. When user can't articulate insight or gives vague answers:
  1. **Reframe the goal** -- Shrink the problem scope to something actionable
  2. **Gravity vs Design** -- Is this changeable? If not, accept and design around it
  3. **Break into sub-projects** -- Sequence specific, small tasks
  4. **Prototype** -- Design a time-bounded experiment, not a commitment

---

## Mid Term: Intelligence Layer

### 1. Apple Health Sync
- Read workouts, steps, menstrual cycle via HealthKit
- Workout data adjusts daily protein and caloric targets
- Cycle data adjusts iron and carb recommendations
- Steps data fine-tunes TDEE
- Sync: background observer + morning pull
- Add `healthKit` to capabilities manifest so Mittens can pull HealthKit data when relevant

### 2. Morning Briefing
- Every morning at sunrise, Mittens sends a chat message via push notification
- Pulls Google Calendar events (already synced), weather/UV, yesterday's nutrient gaps
- Proactive suggestions: "You've been grinding hard, I put 'touch grass' on your calendar at 4pm"
- Uses alarm scheduler infrastructure already built (sunrise alarm triggers backend call)

### 3. Weather + Vitamin D (Forecasting)
- **(Done)** Weather and location inferred UV index calculation for accurate Vitamin D synthesis.
- **(Next)** Calendar-aware forecasting: suggest outdoor time during free blocks with good UV
- **(Next)** "Tomorrow's weather is great and your calendar is open 2-4pm, I'll put 'touch grass' on your schedule"

### 4. 7-Day Trend Visualizations
- Replace static nutrient list with interactive charts (line/bar)
- Visual scrubbing through macro and micronutrient trends
- Trend-based coaching: "You've been low on Magnesium for 3 weeks, let's add spinach to your lunches"

### 5. Context Awareness (Motion Layer)
- **Layer 1 (done)**: Geofencing for known places + significant location changes via `locationService.ts`. Enter/exit triggers logged to `location-log`. Exit handler cross-references `calendar-event` and updates with actual timing/location.
- **Layer 2 (done)**: Google Calendar OAuth sync via `calendarService.ts`. Events stored in `calendar-event` with attendance tracking.
- **Layer 3 (done)**: Location intelligence with movement, polyline map trails, and location logs converted into activities directly from movement graphs.
- **Proactive location awareness**: If user is stationary at an unknown place for hours, Mittens asks where they are. If stationary at a known place, Mittens infers from calendar or asks.
- Sedentary alerts: 3+ hours stationary at desk locations
- Exercise inference: walking/biking from motion patterns + location deltas

### 6. Internal Timeline (User-Visible)
- **Mittens' internal awareness of your entire day**, surfaced as a user-visible UI
- **Calendar View**: toggle between chat and a time-block calendar showing:
  ```
  6:30 AM   Sunrise. Morning briefing.
  7:00 AM   Breakfast: oats + yogurt
  10:00 AM  Work: Building Mittens @ D12
  12:30 PM  Lunch: salad from Sweetgreen
  3:45 PM   Touch grass: Central Park (1h45, UV 6)
  5:30 PM   Biking home: Midtown to Flushing (11.4 mi)
  ```
- **Strava-style travel lines (done)**: for movement activities (biking, walking, running), render the polyline from significant location changes on a dark map view. Shows distance, duration, route shape. "Midtown to Flushing" with an orange trace over the map.
- Time blocks sourced from: calendar events, user-logged activities, motion + location inferences, HealthKit workouts
- Each block shows: duration, activity type icon, location, engagement/energy ratings (after reflection)

### 7. Wallpaper Widget + StandBy Calendar Screensaver
- **iOS widget (WidgetKit)** showing today's schedule as compact time blocks
- Block colors by activity type: work (blue), meal (green), social (purple), outdoors (yellow), rest (gray)
- Updates throughout the day as activities are logged
- Tap to open Mittens chat with context of current block
- Shows at-a-glance: "next up", current activity, daily nutrition gauge
- **Apple StandBy Mode / Screensaver Calendar View:**
  - When phone is charging in landscape (StandBy mode), display a full ambient calendar view
  - Inspired by Apple's StandBy clock aesthetic -- large, beautiful time display with today's schedule blocks flowing vertically beneath
  - Shows upcoming events, current activity, and next meal/activity in a glanceable format
  - Minimal, high-contrast design (black background, white text, subtle activity-type color accents)
  - Auto-updates as activities are logged and events pass
  - Could serve as a desk companion / ambient awareness display
  - Implementation: WidgetKit with `ActivityConfiguration` for Live Activities or a dedicated StandBy-compatible widget family

### 8. Evening Life Design Reflection (Bedtime Ritual)
- **Every night before bed, Mittens initiates the reflection.** This is the centerpiece of the app -- the moment where the day's raw data becomes self-knowledge. Not optional, not a widget. Mittens proactively says: "Ready to look at your day?"
- Mittens builds a **visual timeline** of the full day from all sources: calendar events, logged activities, inferred motion/location, meals, and chat messages.

**Phase 1: Your Day in Review (< 1 min)**
- Timeline view with time blocks showing everything that happened:
  ```
  7:00 AM   Breakfast: oats + yogurt             [+calcium, +fiber]
  7:30 AM   Bike to Central Park (45 min)         [-magnesium, -potassium]
  8:15 AM   Sun at park (1h, UV 6)                [+vitamin D: 15 mcg]
  10:30 AM  Code at D12 (4h)                      [-B vitamins, cortisol+]
  12:30 PM  Lunch: Sweetgreen salad               [+iron, +folate]
  1:00 PM   Code at D12 (3h more)                 [-B vitamins, cortisol++]
  4:00 PM   Hangout with friends                  [cortisol reset, +absorption]
  6:00 PM   Dinner: homemade stir fry             [+iron, +zinc]
  ```
- Each block shows the **metabolic impact** inline -- not just what you did, but what it did to your body
- Blocks auto-filled from calendar + location + motion. Mittens only asks about gaps.

**Phase 2: Rate Your Blocks (< 2 min)**
- **Quick tap ratings (Good Time Journal style):**
  - "How engaged were you?" (low / medium / high)
  - "Did it give you energy or drain you?" (drained / neutral / energized)
- Only prompted for activity blocks (not meals). Mittens pre-fills obvious ones: "biking = energized?" User confirms or corrects.
- **AEIOU analysis** for standout blocks (high or low engagement/energy):
  - Most AEIOU data is inferred from context; Mittens only asks follow-ups for the blocks that stand out

**Phase 3: Mittens Connects the Dots (< 1 min)**
- Mittens synthesizes the day into a **metabolic story**:
  - Nutrient balance: "You recovered from biking depletion with good meals, but 7h coding burned your B vitamins."
  - Energy pattern: "Your energy peaked during the park time and dipped after 4h coding. The hangout partially reset you."
  - Life balance: Dashboard gauges auto-populated -- Work, Health, Play, Love
  - Tomorrow's setup: "Your magnesium is low. Start with pumpkin seed oats. And your sleep last night was 6h -- tonight aim for 8 to reset absorption."
- Over time, Mittens surfaces **cross-day patterns**:
  - "Biking days correlate with better sleep and higher engagement"
  - "You're always drained after 4h+ desk work. 3h blocks with breaks seem to be your sweet spot."
  - "Social days = better nutrient absorption. You literally process food better when you're happy."
  - "Your B12 consistently drops on heavy coding days. Consider a B-complex supplement on grind days."

**Phase 4: Life Design Check-In (optional, weekly)**
- Mittens periodically zooms out: "This week: 32h work, 4h play, 2 social events, 3 outdoor sessions. Your Health gauge is strong but Play is low. What do you want more of this week?"
- Failure log prompts when patterns repeat: "You skipped lunch 3 times at D12 this week."
- Quarterly: Odyssey Plan revisit

### 9. Profile Rename (nutrition-profile -> profile)
- Current `nutrition-profile` collection is expanding beyond nutrition: memory, location prefs, life design data
- Rename to `profile` -- requires new Strapi API folder, migration of existing data, frontend API updates
- Low urgency but should happen before adding more non-nutrition fields

### 10. Refactor nutrition-log Controller
- `nutrition-log.js` is at 2200+ lines -- well over the 500-line rule
- Split into: `chat-handler.js` (capabilities pipeline + chat), `reflection-handler.js` (AEIOU + nightly), `meal-handler.js` (nutrition logging)
- Each file handles its own routes, shares common utilities

---

## Long Term: Full Life Assistant

### 1. Voice Interface -- "Hey Siri, Tell Mittens"
- **In-app mic button (done):** Mic icon in chat input bar. Speech-to-text fills text box via `expo-speech-recognition`. Voice-sent messages get TTS reply via `expo-speech`.
- **Siri Shortcut (next, hands-free, background):**
  - "Hey Siri, tell Mittens I just had matcha" -- Siri captures the message, POSTs to `/nutrition-log/chat`, speaks the reply
  - Works via AirPods, Apple Watch, HomePod, lock screen
  - No app open required. The Shortcut handles auth, API call, and response parsing
- **Implementation (2 layers):**
  - **Layer 1 (iOS Shortcuts, zero app code):** Build a Shortcut named "Tell Mittens" that takes dictated input, POSTs to backend, parses JSON reply, speaks it via Siri.
  - **Layer 2 (App Intents, future):** Native Swift `AppIntent` extension with phrase parameter. Production-grade but requires custom Expo config plugin.
- **True always-on wake word ("Hey Mittens") is not possible** -- Apple restricts always-on mic to Siri only.

### 2. Communication Monitoring
- **Mittens monitors your messages and emails** so you can turn off all notifications and not miss what matters.
- **Sources:**
  - iMessage (via Shortcuts automation or accessibility API)
  - Email (IMAP/Gmail API -- legacy `@mittens` already has email access)
  - Instagram DMs (via notification listener or API)
  - Any app with notification access
- **What Mittens does with messages:**
  - **Calendar updates:** "Your dentist appointment is confirmed for Thursday 2pm" -> silently adds to calendar. Mentioned in morning debrief, no notification.
  - **Schedule changes:** "Class is canceled tomorrow" -> silently removes from calendar. Mentioned in morning debrief. **Exception:** if it's imminent (e.g. class canceled and it starts in 5 min) -> Alarm: "Your class is canceled, don't go!"
  - **Action items:** "Can you send me that file?" -> queued as a to-do for morning debrief
  - **Social invites:** "Want to grab dinner Friday?" -> checks calendar, mentions in morning debrief

### 3. Notification Triage (Smart Filter)
- User turns off all notifications. Mittens becomes the **single gatekeeper** for what reaches you.
- **Three urgency levels:**

| Level | Delivery | Examples |
|-------|----------|----------|
| **Alarm** | Immediately. Sets phone alarm / loud notification. Cannot be silenced. | "You need to leave for dentist RIGHT NOW!" / "Go to bed or I'm shutting down your device." / "Your class starts in 5 min but it's canceled, don't go!" |
| **Important** | Silently handled (calendar updated, etc). Summarized in morning debrief. | Appointment confirmed, class canceled (not imminent), package delivered, payment due. |
| **Low** | Held until morning debrief. Never interrupts focus. | Friends asking to hang out, social media, newsletters, promotions. |

- **Focus mode:** "I'm trying to grind, don't notify me anything non-urgent until I'm done writing mittens" -> only Alarm-level notifications get through until user says they're done or session ends.
- Mittens learns your urgency preferences over time: "Mom's texts are always Important, marketing emails are always Low."

### 4. Morning Debrief (9am)
- Part of the morning briefing, but specifically for **queued notifications and silent updates:**
  - "While you were sleeping / grinding, here's what happened:"
  - Calendar changes -> "Your dentist appointment was confirmed for Thursday 2pm. Class on Tuesday was canceled -- already removed from your calendar."
  - Friends that texted -> "Sarah asked if you want to grab coffee Saturday. Want me to check your calendar?"
  - Emails that need action -> "Your professor sent a deadline reminder for Friday."
  - Social media -> "Nothing important, just the usual."
- Mittens triages and summarizes so you never have to scroll through 47 notifications.

### 5. Social Scheduling Agent
- **Mittens texts your friends for you.** When someone asks to hang out, Mittens handles it autonomously:
  1. Checks your calendar for availability
  2. Replies on your behalf: "Hi I'm Mittens, Susanna's assistant, she's not available Friday night but how about the weekend! She's pretty wide open"
  3. Negotiates time/activity: "Sounds good! You are confirmed for Saturday 2-5pm :)"
  4. Adds the confirmed hangout to your calendar with details (location, activity, who)
- Mittens identifies itself -- never pretends to be you
- Summarizes what it scheduled in the morning debrief: "I scheduled hotpot with Sarah for Saturday 2-5pm"
- User can set boundaries: "don't schedule anything before noon" / "max 2 hangouts per week" / "no plans on sundays"
- Social health tracking via Life Design Team relationship map (see Stanford Life Design Integration above)

### 6. Exercise Accountability
- **Mittens tracks exercise frequency and pushes you to move more.**
- Rules (configurable):
  - Target: X workouts per week (user sets, Mittens nags if behind)
  - "You haven't exercised in 4 days. Your calendar is open 5-6pm today -- gym or a walk?"
  - Integrates with HealthKit steps and workout data
  - Sedentary alerts: "You've been sitting at D12 for 3 hours. Get up and stretch."
  - Proactive scheduling: puts workout blocks on your calendar during free slots

### 7. Health Enforcement (Non-Negotiable)
- **Health is #1. Mittens will escalate if you ignore health basics:**
  - **Sleep:** "Go to bed. You need 8 hours and sunrise is at 6:20am." -> if ignored -> sets alarm -> if still ignored -> shuts down device (via legacy `@mittens` Shortcuts integration)
  - **Eating:** "You haven't eaten in 8 hours. Stop grinding." -> persistent until acknowledged
  - **Movement:** "You've been sitting for 4 hours straight." -> Sedentary alerts with escalation
  - **Hydration:** Simple reminders based on activity level
- These are the only things that can override focus mode.

### 8. Transfer Legacy Mittens Functions
- ~~Travel time alerts with GPS~~ (done: `travelTime.ts`)
- ~~Bedtime enforcement based on sunrise + sleep target~~ (done: `alarmScheduler.ts`)
- ~~Scheduled alarm setting via push notifications~~ (done: `alarmScheduler.ts`)
- Email cleanup / housekeeping tasks
- Device shutdown commands via Siri Shortcuts
- ~~Location-based inferences~~ (done: `locationService.ts` + `location-log`)

### ~~9. Model Flexibility~~ (done)
- ~~Default: Gemini 2.5 Flash (free tier)~~ (done)
- ~~Future tiers: GPT-4o, Claude, local models~~ (done: Claude Sonnet + Opus via Profile > Integrations > Mittens' Brain)
- ~~Users choose and pay for their preferred model~~ (done)
- ~~Abstract the AI layer behind a provider interface~~ (done: `_callClaudeJSON` in gemini-vision.js, provider selection in controllers)

### 10. Wearable Hardware: Pendant + Wrist

Mittens' hardware is a two-piece system. Pendant sees the world (chest POV camera); wrist feels the body (IMU + vitals). They split cleanly by sensor needs, power budget, and social visibility.

#### 10a. Camera Pendant (Xiao ESP32-S3 Sense)
- **Pendant camera wearable** provides real-time visual context -- what the user is doing, eating, and drinking.
- **Big-movement IMU wake → camera capture → BLE stream to phone.** Dumb firmware, near-zero idle power. False-wake backoff for scratching/fidget (30s → 2min → 5min sleep interval until next context change).
- **Delta-mode cooking pipeline:** while cooking context is active, every big-movement frame goes to phone, which calls Gemma with prior-state + new frame → `{added, removed, modified}` delta. Gesture field (`via`: squeeze/pour/sprinkle/chop/fold-in/flip/stir) captures what a finished plate can't.
- **Method + quality inference:** char severity per frame, cooking-state (crispy/soft/soggy/raw), nutrient-damage math for heat-labile vits (C, folate, thiamine, B6), acrylamide note for heavily charred starches.
- **Eating capture:** hand-to-mouth (wrist-preferred, pendant-fallback) + frame → auto-logs meal. Eating duration tracked → pace observation (not prescription).
- **Nutrient cascade shown live:** new item → metabolism engine applies interactions (lemon vit C × non-heme iron bioavailability +2–3×) → Impact Ledger shows what Gemma saw, what it added, and how the math moved. This is the "AI shows its work" demo moment.
- **Grocery store intelligence:** Detects items picked up and placed in cart, auto-updates pantry with freshness timestamps.
- **Within-location activity transitions:** Camera detects working vs cooking vs laundry at home -- GPS alone can't distinguish these.
- **Double-tap → mittens message:** Physical double-tap → BLE event → phone handles via chat pipeline → TTS replies through `voiceService.ts`. Hands-free, no phone unlock. The signature "feels like a pet" interaction.
- Wearable GPS feeds higher-resolution coordinate paths into `activity-log.meta.path` for Strava-style maps.
- Location system accepts external device input via existing API endpoints.
- **Until pendant is ready:** same-location = one activity block, Mittens asks once "what are you up to?", user reflects later if no reply.

#### 10b. Wrist Band (post-pendant, full health monitor)

The wrist is where Mittens becomes a full health-monitor platform, not just an activity tracker. Adding ~$5–8 of sensors to a small IMU band unlocks signals the pendant architecturally cannot get.

- **IMU (6-axis):** HAR classifier (walking / running / biking / stationary / typing / eating / drinking / cooking) runs on-device via TFLite Micro (~100KB model, trained on UCI HAR + WISDM). ~90% accuracy well-established. The unique wrist contribution is **eating-vs-typing-vs-drinking discrimination** — forearm supination + loading arc vs micro-rotations + tap cadence vs wrist tilt-up. Solves the "work+eat simultaneously" case pendant cannot.
- **Skin temperature (SHT31 or similar, ~$1):** fever detection; sleep-onset timing (skin temp rises at sleep onset); menstrual luteal-phase detection via ~0.3–0.5°C post-ovulation shift (the Oura approach).
- **PPG optical pulse (MAX30102 class, ~$3–5):** resting HR, HRV (stress + recovery axis), SpO2, sleep-stage inference (REM / deep / light via HRV variability), menstrual cycle HR patterns (~2–4 bpm shifts across phases).
- **Combined signals:** period prediction, sleep staging competitive with consumer wearables, stress/recovery metrics, and a resting-HR baseline Mittens can track against training load and sleep debt.
- **Power + thermal:** wrist stays small and cool because the camera/compute load lives on the pendant. Weeks on a coin cell for IMU-only; days for IMU + vitals depending on sampling rate.

#### Why split instead of one device
- **Hand-to-mouth needs the hand.** Pendant infers it from chest torque — noisy, ~70% accurate, misses small seated forkfuls. Wrist gets it >95% clean.
- **Camera needs chest POV.** Wrist cameras are bouncy and point at the floor.
- **Thermal + battery split.** One device doing both = worst-case thermal and battery in the most visible (chest) location.
- **Social acceptability.** Wristbands are invisible (everyone wears them already). Pendant is the novel bit and stays simple.

### 11. Local-First Architecture

**Status:** Hybrid mode working end-to-end. Gemma inference + Cloud storage is the default. AI engine and data storage are fully decoupled -- users toggle each independently. Multi-photo vision support added (native rebuild needed). Local-only mode also validated for fully offline use.

- **Local Gemma model** _(working, Pixel 7a)_: Gemma 4 E2B (instruction-tuned) running via LiteRT-LM SDK. Vision inference ~22s for food ID, Stage 1 Router 7.16s, Food ID text 7.60s, Chat 29.74s, avg 14.83s. CPU default.
- **Hybrid mode (default)** _(working)_: Gemma for inference + Strapi for data storage. Private AI, backed-up data. Photos upload to Cloudinary when in cloud data mode.
- **Local data storage** _(working)_: SQLite mirroring all Strapi collections. Full functionality offline. Data Storage toggle in Profile > Integrations with warning when switching to local-only.
- **Multi-photo vision** _(native rebuild needed)_: `generateWithImages` sends all photos to Gemma in one call. LiteRT-LM natively supports `Message.of(ImageFile, ImageFile, ..., Text)`. JS layer falls back to single image until rebuild.
- **Your own API key** _(BYOK tier)_: Bring your own Gemini/Claude/OpenAI key instead of using shared tokens.
- **Sync when you want**: Cloud sync to Strapi is opt-in. Pay for cloud tokens only when enabled.
- **Full trust**: All data stays on your phone unless you explicitly choose to share it.
- **Works everywhere**: No internet required. Your health data travels with you -- park bench, plane, hospital Wi-Fi dead zone.
- **Local storage management** _(future)_:
  - When in Cloud+Local hybrid, local SQLite caches last 7 days of data for offline access and fast reads.
  - Older data auto-pruned from device; always available via cloud API when online.
  - Storage budget shown in Profile > Data Storage: model size (~2.6GB) + local cache (~50MB) + photos.
  - "Clear local cache" button for manual cleanup without affecting cloud data.
  - Photo storage policy: keep on device / sync to Cloudinary / delete after analysis.

#### Three-tier brain model

| Tier | Brain | User pays Google/Anthropic | User pays us | For |
|---|---|---|---|---|
| **Local** | Gemma on-device | nobody | nobody | offline, no-spend, privacy-inclined users |
| **BYOK** | Gemini/Claude via user's own key | user, directly | nothing (or tiny sync fee) | devs, tech-savvy |
| **Managed** | Gemini/Claude via our key | us | subscription ~$5–10/mo | normal users who want it to just work |

Managed tier quota degrades gracefully: when users hit the cap, AI calls fall back to local Gemma rather than failing. No surprise bills. Every call shows token usage in-app regardless of tier.

### 12. Life View & Work View
- Task list tied to the user's "why" -- why you work and what your life view is.
- Not to nag or push, but to frame daily actions within a larger purpose.
- Periodically revisited as values evolve.
- Integrated with Odyssey Plan for coherence checking.
