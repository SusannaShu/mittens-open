# Local-First Architecture: SQLite + Provider Wiring

Now that Gemma 4 E2B is verified on the Pixel 7a (text: 2.1s, vision: 23.8s), the next step is building the local data layer and wiring the provider abstraction into the actual app call sites.

## Current State

**Done (from previous conversation):**
- Provider interfaces: `InferenceProvider`, `DataProvider` (stub)
- `GeminiCloudProvider` wrapping existing Strapi API
- `GemmaLocalProvider` wrapping LiteRT-LM native module
- `providerFactory.ts` with mode-based switching
- LiteRT-LM native module (`modules/litert-lm/`)
- Model download, load, text + vision inference working on Pixel 7a
- Profile UI for selecting AI model (Gemma/Flash/Sonnet/Opus)

**Not done:**
- Providers are NOT wired into the app. Chat still calls `chatWithMittens()` directly via RTK Query, not through the provider factory.
- No local database. All data goes to Strapi cloud.
- No `LocalDataProvider` implementation.
- No sync engine for local → cloud.
- Mode toggle doesn't affect data flow, only AI model selection.

## User Review Required

> [!IMPORTANT]
> **Scope**: This plan builds the complete local data layer (SQLite) and wires the provider factory into the real call sites. After this, selecting "Gemma Local" mode will use on-device inference AND local storage -- a fully offline-capable app.

> [!WARNING]
> **expo-sqlite installation**: Requires adding `expo-sqlite` to dependencies. This shouldn't require a prebuild since Expo SDK 54 includes it, but may need `npx expo install expo-sqlite` to ensure version compatibility.

> [!IMPORTANT]
> **Incremental approach**: We wire providers into call sites one-at-a-time (messages first, then meals, then activities) so we can verify each layer works before moving to the next. The app remains fully functional in cloud mode throughout.

---

## Proposed Changes

### 1. SQLite Database Layer

#### [NEW] [database.ts](file:///Users/susannahuang/Documents/GitHub/mittens-app/lib/database.ts)

SQLite initialization and schema creation using `expo-sqlite`. Creates all tables mirroring the Strapi models:

- `mittens_messages` -- chat history (first to migrate, simplest)
- `nutrition_logs` -- meal entries with JSON items + nutrients
- `activity_logs` -- activity entries
- `sleep_logs` -- sleep entries
- `known_places` -- saved places
- `daily_meal_plans` -- meal planning
- `planned_schedules` -- daily schedules
- `nutrition_profile` -- user profile (single row)
- `memory` -- structured memory tiers
- `sync_queue` -- tracks unsynced records for cloud push

Key design decisions:
- JSON columns for complex nested data (items, nutrients, memory tiers)
- `synced_at` column on every table (NULL = never synced)
- `sync_queue` table tracks which records need to be pushed to cloud
- All CRUD operations return the same shapes as the Strapi API responses

---

#### [NEW] [localDataProvider.ts](file:///Users/susannahuang/Documents/GitHub/mittens-app/lib/providers/localDataProvider.ts)

Full `DataProvider` implementation backed by SQLite. Implements:

- `loadMessages()` / `saveMessage()` -- chat persistence
- `logMeal()` / `getMeal()` / `updateMeal()` / `deleteMeal()` / `getDailyMeals()` -- nutrition
- `getDailySummary()` -- computes totals from local nutrition_logs
- `getUnsyncedRecords()` / `markSynced()` -- sync manifest

Each method writes to SQLite and enqueues a sync record. The sync queue can be processed later to push to Strapi.

---

### 2. Provider Factory Wiring

#### [MODIFY] [providerFactory.ts](file:///Users/susannahuang/Documents/GitHub/mittens-app/lib/providers/providerFactory.ts)

Add `getDataProvider()` function alongside existing `getInferenceProvider()`:
- Cloud mode: returns a `CloudDataProvider` (wraps existing RTK Query)
- Local mode: returns `LocalDataProvider` (new SQLite implementation)

---

#### [NEW] [cloudDataProvider.ts](file:///Users/susannahuang/Documents/GitHub/mittens-app/lib/providers/cloudDataProvider.ts)

Wraps existing RTK Query API calls (`nutritionApi`, `messagesApi`, `profileApi`) to conform to the `DataProvider` interface. No behavior change -- purely structural wrapper.

---

### 3. Hook Integration (Wire Providers into Real Call Sites)

#### [MODIFY] [useChatHandlers.ts](file:///Users/susannahuang/Documents/GitHub/mittens-app/lib/hooks/useChatHandlers.ts)

Currently calls `chatWithMittens` RTK mutation directly. Add a mode-aware path:
- Cloud mode: unchanged (RTK Query to Strapi)
- Local mode: call `getInferenceProvider().chat()` directly, save message via `getDataProvider().saveMessage()`

The key change: when in local mode, chat bypasses Strapi entirely. The message goes to on-device Gemma, and the response is saved to local SQLite.

---

#### [MODIFY] [useChatMessages.ts](file:///Users/susannahuang/Documents/GitHub/mittens-app/lib/hooks/useChatMessages.ts)

Currently loads messages from `loadMessages()` (Strapi API). Add mode-aware loading:
- Cloud mode: unchanged
- Local mode: load from `getDataProvider().loadMessages()` (SQLite)

---

### 4. Mode Selection UI

#### [MODIFY] [ProfileIntegrationsSection.tsx](file:///Users/susannahuang/Documents/GitHub/mittens-app/components/profile/ProfileIntegrationsSection.tsx)

Enhance the existing AI Model selector to also control the data mode:
- When "Gemma Local" is selected: set `mittens_mode = 'local'` in AsyncStorage
- When any cloud model is selected: set `mittens_mode = 'cloud'`
- Show a clear indicator of current mode ("All data on device" vs "Synced to cloud")
- Add a "Sync to cloud" button visible in local mode (for optional cloud backup)

---

### 5. Sync Engine (Local → Cloud)

#### [NEW] [syncEngine.ts](file:///Users/susannahuang/Documents/GitHub/mittens-app/lib/services/syncEngine.ts)

Background sync that pushes unsynced local records to Strapi when the user opts in:
- Reads from `sync_queue` table
- For each record: POST/PUT to Strapi, mark as synced on success
- Photo sync: upload local photos to Cloudinary, update cloud_image_ids
- Runs on-demand (user taps "Sync") or periodically when on WiFi

---

## Implementation Order

| Step | What | Risk |
|------|------|------|
| 1 | Install `expo-sqlite`, create `database.ts` with schema | Low -- no behavior change |
| 2 | Build `LocalDataProvider` for messages only | Low -- messages are simplest |
| 3 | Wire `useChatMessages.ts` to load from local in local mode | Medium -- first real mode switching |
| 4 | Wire `useChatHandlers.ts` to send via local provider in local mode | Medium -- chat goes fully local |
| 5 | Extend `LocalDataProvider` for nutrition (meals, daily summaries) | Medium -- more complex data shapes |
| 6 | Update `ProfileIntegrationsSection` for mode toggle | Low -- UI only |
| 7 | Build `syncEngine.ts` for local → cloud push | Medium -- needs careful conflict resolution |

## Open Questions

> [!IMPORTANT]
> **Daily summary computation**: In cloud mode, Strapi computes daily nutrient totals, gaps, and recommendations server-side. In local mode, this computation needs to happen on-device. Should we:
> - (A) Port the full `rda-calculator` logic to TypeScript and run it locally?
> - (B) Keep daily summary computation cloud-only for now, and in local mode show a simplified "totals only" view?
> - (C) Use Gemma to compute gaps/recommendations from the raw nutrient data?

> [!IMPORTANT]
> **Message sync direction**: When a user starts in local mode, accumulates history, then switches to cloud mode, should we:
> - (A) Auto-push all local messages to Strapi on mode switch?
> - (B) Keep them separate (local history stays local, cloud starts fresh)?
> - (C) Offer a one-time "Upload to cloud" option?

> [!IMPORTANT]
> **Hybrid inference**: The current `chatWithMittens` in `api.ts` (lines 259-298) already has a hybrid flow where Strapi sends Stage 1/2 prompts back for local execution. Should we:
> - (A) Keep this hybrid flow as the default (Strapi controls routing, Gemma does inference)?
> - (B) In full local mode, bypass Strapi entirely (Gemma does routing + inference, SQLite stores results)?
> - (C) Let the user choose between "Local AI, Cloud Data" and "Fully Local"?

## Verification Plan

### Automated Tests
- `npx expo run:android` -- verify expo-sqlite schema creates without errors
- Insert + query a test message in SQLite -- verify round-trip

### Manual Verification (on Pixel 7a)
1. Select "Gemma Local" on Profile tab
2. Verify mode indicator shows "All data on device"
3. Send a chat message -- verify it goes through Gemma (not Strapi)
4. Kill app, reopen -- verify message history loads from SQLite
5. Switch to "Gemini Flash" -- verify chat resumes using Strapi
6. (If sync built) Tap "Sync to Cloud" -- verify messages appear in Strapi
