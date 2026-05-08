# Mittens notification manager + Apple Health — implementation spec

Spec for turning mittens into the single notification surface for the channels it can reach, and integrating Apple Health for cycle-phase-aware nutrition. Companion to `docs/lmst-schedule-spec.md` and `docs/schedule-science-review.md`.

## 1. Goals

- Mittens is the **only app that breaks through Focus mode**. Everything else stays silent.
- Mittens ingests **Gmail** and **iMessage** (via a Mac companion), classifies each message for time-sensitivity, and surfaces only what truly needs attention.
- Sending goes through a **draft-only** flow: mittens writes, user taps send.
- Mittens integrates **Apple Health** for cycle-phase nutrition (iron, magnesium, B6), sleep-schedule validation, recovery signals, and workout-aware macros.
- All sensitive data (email content, iMessages, health data) handled with minimum-necessary exposure and user-revocable access.

## 2. Non-goals

- No SMS/iMessage reading on iOS (structurally impossible without a Mac companion).
- No system-level notification capture from other apps on iOS (Apple disallows it).
- No social-media DM integration in v1 (Instagram, WhatsApp, Snapchat out of scope — APIs too restricted or nonexistent).
- No auto-send in v1 — drafts only.
- No HIPAA / medical-grade claims on health data; nutrient adjustments are wellness-level suggestions.

## 3. Architecture overview

```
┌──────────────────┐       ┌──────────────────────┐
│ Gmail  (OAuth)   │───┐   │  iMessage Mac app    │
└──────────────────┘   │   │ (reads chat.db,      │
                       │   │  sends via Messages) │
                       │   └──────────────────────┘
                       │              │
                       ▼              ▼
           ┌──────────────────────────────────┐
           │  Mittens Backend (Strapi)        │
           │  - /inbound-message (webhook)    │
           │  - classification pipeline (LLM) │
           │  - contact-priority store        │
           │  - outbound draft store          │
           └──────────────────────────────────┘
                         │
                         ▼ APNs push
           ┌──────────────────────────────────┐
           │  Mittens iOS app                 │
           │  - unified inbox UI              │
           │  - draft review + send           │
           │  - HealthKit read (local)        │
           │  - Focus-mode setup guide        │
           └──────────────────────────────────┘
```

Three data paths:
1. **Inbound from Gmail** → Gmail watch webhook → backend → classifier → push to iOS.
2. **Inbound from iMessage** → Mac companion tails `chat.db` → posts to backend → classifier → push to iOS.
3. **Apple Health** → queried locally on iOS via HealthKit, never leaves the device unless explicitly shared (e.g., period dates synced to backend for cross-device nutrient calculation).

Outbound flows:
- **Draft a Gmail reply**: iOS requests backend → backend (LLM + thread context) generates draft → iOS displays → user taps send → backend calls Gmail API.
- **Draft an iMessage reply**: iOS → backend → draft → iOS displays → user taps send → backend posts to Mac companion → Mac sends via Messages.app AppleScript.

## 4. Gmail integration

### 4.1 OAuth

- Library: use `expo-auth-session` with Google provider, or `react-native-app-auth` for OAuth 2.0.
- Scopes needed: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.modify` (for marking read + labels).
- Store refresh token **server-side** (Strapi, encrypted at rest). Never ship refresh tokens back to the device after initial exchange.
- Expose endpoints:
  - `POST /integrations/gmail/oauth-start` → returns auth URL
  - `POST /integrations/gmail/oauth-callback` → exchanges code for tokens, stores encrypted, creates subscription
  - `DELETE /integrations/gmail` → revokes and wipes tokens

### 4.2 Real-time inbox delivery

- Use **Gmail Push via Cloud Pub/Sub**: call `users.watch` with a topic name. Gmail publishes notifications to Pub/Sub when messages arrive; a push subscription forwards to a backend webhook.
- Webhook: `POST /integrations/gmail/webhook` verifies Pub/Sub signature, then fetches new messages via `users.history.list` + `users.messages.get`.
- Fall back to polling every 2 min if Pub/Sub setup is skipped in v1 (simpler, no GCP).
- Watch expires after 7 days — schedule a daily cron to renew.

### 4.3 Message ingestion

For each new message:
```ts
{
  source: 'gmail',
  externalId: message.id,
  threadId: message.threadId,
  from: {name, email},
  to: [...],
  subject,
  snippet,
  bodyPlain,        // stripped HTML
  receivedAt: ISO,
  labels: [...],
  hasAttachment: bool,
}
```

Pass to the classification pipeline (§6). Store in a `inbound-message` collection on Strapi.

### 4.4 Sending

- Endpoint: `POST /integrations/gmail/send` with `{ threadId, inReplyTo, subject, body }`.
- Uses Gmail API `users.messages.send` with RFC-2822 composition.
- Automatically sets `In-Reply-To` and `References` headers when replying to preserve threading.
- Saves to `outbound-message` with `status: sent`.

## 5. iMessage Mac companion

### 5.1 Form factor

- A small **macOS menu-bar app** (Swift, SwiftUI, or Electron if preferred). Name it `mittens-relay` or similar.
- Target: user's always-on MacBook Air.
- Requires **Full Disk Access** (for reading `~/Library/Messages/chat.db`) and **Automation** permission for `Messages.app` (for sending). Both granted via System Settings once.
- Auto-launch on login (`launchd` agent). Hidden menu-bar icon with "Connected to mittens backend ✓" indicator.

### 5.2 Inbound tail

- Watch `~/Library/Messages/chat.db` for changes using `DispatchSource.makeFileSystemObjectSource` on the file descriptor, or poll every 5 seconds.
- Read new rows from the `message` table joined with `handle` (for sender) and `chat` (for thread).
- Filter: only messages where `is_from_me = 0` (received, not sent by user). Optional: only from contacts in user's address book.
- For each new message, POST to backend `/integrations/imessage/inbound`:

```json
{
  "source": "imessage",
  "externalId": "guid-from-chat.db",
  "threadId": "chat_identifier",
  "from": { "handle": "+14155551234 or email@icloud.com", "contactName": "resolved from Contacts" },
  "isGroup": true/false,
  "groupName": "...",
  "body": "message text",
  "receivedAt": "ISO",
  "attachments": ["/path/to/file or pushed as blob"]
}
```

Authenticate with a per-user API key generated at Mac-app pairing time.

### 5.3 Outbound send

- Backend → Mac companion via a long-lived **WebSocket** or polled endpoint (`GET /integrations/imessage/outbox?since=...`).
- On receiving a `send` command, companion runs AppleScript:
```applescript
tell application "Messages"
  set targetService to 1st service whose service type = iMessage
  set targetBuddy to buddy "{recipient}" of targetService
  send "{body}" to targetBuddy
end tell
```
- For group messages, target the existing chat by its GUID/identifier (AppleScript path is gnarlier; may need to use `send ... to chat id "..."` variant).
- Report back to backend with `{ status: "sent" | "failed", errorMessage?, sentAt }`.

### 5.4 Pairing flow

- User opens mittens on iOS → Settings → "Connect iMessage (Mac)" → shows a 6-digit pairing code.
- User installs mittens-relay on Mac → pastes code → Mac exchanges it for a permanent API key with backend.
- Backend associates Mac API key with user. Mac begins relaying.
- Single Mac per user in v1 (multi-Mac later).

### 5.5 Privacy posture

- iMessage data is **extremely sensitive**. Minimize backend retention:
  - Keep message content only for 30 days, then purge body (keep metadata for threading/UX).
  - Encrypt at rest on backend using a per-user key derived from the user's password (envelope encryption).
  - Default to **not sending any attachment content** to backend — only a placeholder with "image/video from X." Full content stays on Mac.
- Add a prominent "Delete all iMessage data from mittens" button in Settings.
- Document clearly in onboarding: "Your iMessages are read from your Mac and relayed to mittens' server. You can disconnect anytime."

### 5.6 When the Mac is off

- Mac companion sends a heartbeat every 60 seconds. If backend misses 3 heartbeats (>3 min), mark `imessageStatus: 'offline'`.
- iOS app shows a small amber indicator: "iMessage relay offline — recent messages may be missed."
- On reconnection, Mac replays new messages since `lastSeenMessageRowId`.

### 5.7 Alternatives considered (documented for future)

- **BlueBubbles** open-source backend does this already — could adopt or fork instead of building from scratch. Worth a 1-day eval before writing the companion.
- **Beeper** is proprietary but also solves this — not an option to embed.
- **iCloud Messages sync** — no public API to read iCloud backups programmatically.

## 6. Classification pipeline

All inbound messages (Gmail + iMessage) hit a single classification service.

### 6.1 Input

```ts
interface ClassificationInput {
  source: 'gmail' | 'imessage';
  from: { name?: string; handle: string };
  subject?: string;
  body: string;
  thread?: { priorMessages: Array<{ from: string; body: string; at: string }> };
  receivedAt: string;
  contactPriority?: 'vip' | 'known' | 'unknown';  // from contact store
}
```

### 6.2 Contact priority store

New Strapi collection `contact-priority`:

```json
{
  "userId": "...",
  "handle": "email@example.com or +1415...",
  "displayName": "...",
  "priority": "vip" | "known" | "unknown" | "muted",
  "source": "user_tagged" | "inferred_frequency" | "inferred_reply_rate",
  "lastInteractionAt": "ISO"
}
```

Inference rules:
- Auto-promote to `known` after 3 two-way exchanges in 30 days.
- Auto-promote to `vip` if user manually stars a contact OR replies within 5 min on average across 5+ exchanges.
- Never auto-demote; user must explicitly mute.
- User-editable in a Settings → Contacts screen.

### 6.3 LLM classification call

Run on backend (not on-device — needs consistent model + thread context). Use Claude Haiku or a small model for latency (<1s per message).

System prompt (summarized):
> You classify incoming personal messages for a time-sensitive notification app. Output strict JSON with fields: priority (`critical` | `high` | `normal` | `low`), isTimeSensitive (bool), actionableBy (ISO timestamp or null for "no deadline"), summary (one sentence), suggestedAction (`reply_urgent` | `reply_casual` | `acknowledge` | `ignore` | `add_to_calendar`), urgencyReason (short explanation).
>
> Criteria:
> - `critical`: time-sensitive AND actionable within <4 hours AND from known/vip contact. Examples: "running late to our 2pm meeting," "class canceled today," "flight gate changed."
> - `high`: actionable within <24h OR vip contact. Examples: "want to grab dinner tomorrow?", important work email.
> - `normal`: no urgency, default bucket for personal messages.
> - `low`: newsletters, receipts, automated notifications, group-chat small talk.
> - `isTimeSensitive = true` ONLY if the message references a specific upcoming event time.

### 6.4 Notification decision

```ts
function shouldPushNotify(classification, contactPriority, userPrefs) {
  if (classification.priority === 'critical') return true;
  if (classification.priority === 'high' && contactPriority !== 'muted') return true;
  if (classification.priority === 'normal' && contactPriority === 'vip') return true;
  return false;  // accumulates for hourly digest
}
```

Non-pushed messages accumulate into an **hourly digest** notification: "You have 7 non-urgent messages in the last hour." Tap to review.

### 6.5 Output storage

Every classified message gets persisted with:
```json
{
  "inboundMessageId": "...",
  "priority": "high",
  "isTimeSensitive": true,
  "actionableBy": "2026-04-19T18:00:00Z",
  "summary": "Alex changed dinner from 7pm to 6:30pm tonight",
  "suggestedAction": "reply_casual",
  "urgencyReason": "Event tonight, within 4h",
  "classifiedAt": "ISO",
  "model": "claude-haiku-4-5",
  "notified": true,
  "userOverride": null  // "false_positive" | "false_negative" | null
}
```

User can mark classifications wrong from the iOS UI (long-press a notification → "This shouldn't have notified me"). Overrides feed a future reranking prompt.

## 7. Draft-generation + send flow

### 7.1 Trigger

User taps a notification OR opens the mittens inbox and selects a message. iOS app calls `POST /messages/:id/draft`.

### 7.2 Generation

Backend fetches thread context (last N messages in thread), user preferences (tone, signature), and calls LLM:
> Draft a reply to the following message. User's typical tone: [pulled from past sends or onboarding Q]. Keep it [length preference]. Don't invent facts. If the reply requires information the user hasn't provided, say so explicitly in the draft.

Return: `{ draft: string, confidence: 'high' | 'medium' | 'low', questionsForUser: string[] }`

### 7.3 Review UI

iOS shows:
- Original message
- Draft (editable text field, pre-populated)
- "Send" button (primary)
- "Regenerate" button (calls LLM again with a "different style" nudge)
- "Snooze 1h" / "Don't reply" options

No send happens until user taps Send. This is the "Draft only" mode from your choice.

### 7.4 Send execution

- Gmail: `POST /integrations/gmail/send` with draft body + threading headers.
- iMessage: `POST /integrations/imessage/send` → backend queues for Mac → Mac sends via AppleScript.
- Persist outbound message with `source`, `status`, `sentAt`.

### 7.5 Confidence floor

If LLM `confidence === 'low'` or `questionsForUser.length > 0`, iOS shows an extra "Mittens is unsure — please review carefully" banner. This catches cases where the model is guessing.

## 8. Apple Health integration

### 8.1 Library

Use **@kingstinct/react-native-healthkit** — fullest coverage including menstrual cycle, sleep stages, HRV, wrist temperature. Requires a custom Expo dev client (mittens is already past Expo Go due to `expo-location` background tasks, so no regression).

Install:
```
npm install @kingstinct/react-native-healthkit
npx pod-install
```

Add HealthKit capability in `app.json` iOS entitlements + Info.plist usage strings:
```json
"NSHealthShareUsageDescription": "Mittens uses your health data to personalize nutrition recommendations (iron during menses, recovery on low-HRV days) and validate that your schedule is improving your sleep.",
"NSHealthUpdateUsageDescription": "Mittens writes logged meals back to Apple Health so your nutrition data stays in one place."
```

### 8.2 Requested permissions (full-read scope)

Read:
- `HKCategoryTypeIdentifier.menstrualFlow`
- `HKCategoryTypeIdentifier.intermenstrualBleeding`
- `HKCategoryTypeIdentifier.sleepAnalysis`
- `HKQuantityTypeIdentifier.heartRate`
- `HKQuantityTypeIdentifier.restingHeartRate`
- `HKQuantityTypeIdentifier.heartRateVariabilitySDNN`
- `HKQuantityTypeIdentifier.stepCount`
- `HKQuantityTypeIdentifier.activeEnergyBurned`
- `HKQuantityTypeIdentifier.basalEnergyBurned`
- `HKWorkoutType`
- `HKQuantityTypeIdentifier.bodyMass`
- `HKQuantityTypeIdentifier.appleSleepingWristTemperature` (Watch Series 8+)
- `HKQuantityTypeIdentifier.vo2Max`
- `HKQuantityTypeIdentifier.respiratoryRate`
- `HKCategoryTypeIdentifier.mindfulSession`
- Cycle-symptom categories: `abdominalCramps`, `moodChanges`, `headache`, `bloating`, etc.

Write (for meal-sync in a future phase):
- `HKCorrelationTypeIdentifier.food` — write logged nutrition back to Health.

### 8.3 Background read

HealthKit doesn't push — iOS apps poll. Use `observeQuery` which fires when new data is available, even when app is backgrounded. For cycle start detection specifically, register an observer on `menstrualFlow` and trigger an update when a new sample arrives.

### 8.4 Sync strategy

- On app foreground: fetch everything since `lastSyncedAt`.
- On HK observer fire: fetch only the new sample's type.
- Sync results to backend collection `health-snapshot`:

```json
{
  "userId": "...",
  "sampledAt": "ISO",
  "sleep": { "totalMin": 450, "efficiency": 0.89, "deepMin": 75, "remMin": 90, "bedtime": "ISO", "wakeTime": "ISO" },
  "hrv": { "ms": 52, "7dayAvg": 58 },
  "restingHr": 62,
  "wristTempDelta": -0.2,
  "activeEnergy": 420,
  "steps": 8400,
  "workouts": [{ "type": "strength", "durationMin": 45, "energyKcal": 280 }],
  "cycle": {
    "currentPhase": "luteal",
    "phaseDay": 5,
    "cycleDay": 22,
    "nextPeriodEta": "2026-04-24",
    "symptomsLoggedToday": ["cramps", "bloating"]
  }
}
```

### 8.5 On-device vs backend

Store raw samples only on device (HealthKit is the source of truth). Send **derived summaries** to backend for cross-device consistency and to power nutrient calculations. Don't send raw HR timeseries.

## 9. Cycle-phase nutrient adjustments

### 9.1 Phase detection

From HealthKit `menstrualFlow` samples + wrist-temperature shift:

```ts
type CyclePhase = 'menses' | 'follicular' | 'periovulatory' | 'luteal';

function detectPhase(cycleData): { phase, phaseDay, cycleDay } {
  const cycleStart = lastMenstrualFlowStart();
  const cycleDay = daysBetween(cycleStart, today);
  const ovulationDay = detectOvulation(cycleData); // wrist temp nadir + ~14d heuristic
  if (cycleDay <= 5 && hasFlowToday()) return { phase: 'menses', cycleDay, phaseDay: cycleDay };
  if (cycleDay < ovulationDay - 2) return { phase: 'follicular', cycleDay, phaseDay: cycleDay - 5 };
  if (cycleDay >= ovulationDay - 2 && cycleDay <= ovulationDay + 2) return { phase: 'periovulatory', cycleDay, phaseDay: cycleDay - (ovulationDay - 2) };
  return { phase: 'luteal', cycleDay, phaseDay: cycleDay - (ovulationDay + 2) };
}
```

### 9.2 Nutrient adjustment rules

Modify `backend_strapi/api/nutrition-log/services/rda-calculator.js` to accept cycle phase and apply multipliers. Evidence-backed adjustments only:

| Phase | Nutrient | Adjustment | Rationale |
|---|---|---|---|
| Menses | Iron | ×1.5 (baseline 18mg → 27mg) | Blood loss recovery; evidence shows ~14% of women iron-deficient at early follicular |
| Menses | Vitamin C | pair with iron, ×1.3 | Enhances non-heme iron absorption 2-3x |
| Menses | Magnesium | ×1.15 | Cramp management |
| Follicular | Folate | ×1.2 | Low at menses, needs to rise; supports fertility |
| Luteal | Magnesium | ×1.2 | PMS symptom management, cramp prevention |
| Luteal | Vitamin B6 | ×1.25 | Evidence for mood + PMS relief, especially combined with magnesium |
| Luteal | Complex carbs | +10% of daily kcal | Serotonin support, appetite regulation |

Additional modifiers from logged symptoms:
- Heavy flow logged → iron ×1.7 (not just 1.5)
- Cramps logged → magnesium ×1.3, vitamin D maintained
- Mood symptoms → B6 + omega-3 boost

Apply multipliers to RDA calculation; mittens' existing gap detection then flags shortfall and recommends foods.

### 9.3 Sleep-derived adjustments

From HealthKit sleep samples:
- Sleep < 6h last night: suggest +10% carbs at breakfast (appetite hormone disruption mitigation), remind about hydration.
- Sleep efficiency < 70% for 3+ nights: surface as a health concern, suggest reviewing LMST schedule.

### 9.4 Recovery-derived adjustments

From HRV + RHR:
- HRV drop >15% from 7-day baseline: suggest protein maintenance, +magnesium/omega-3, a lighter workout.
- RHR elevated >5 bpm for 3 days: prompt "Are you getting sick?" + immune-support micronutrients (vitamin C, D, zinc).

### 9.5 Workout-derived adjustments

- Strength workout > 30 min: protein target ×1.2, timed within 2h post-workout.
- Endurance > 60 min: add 500mg sodium recommendation, carb replenishment suggestion.
- Back-to-back training days: additional 300kcal on hard days.

## 10. Focus mode integration

### 10.1 Guidance, not control

iOS Focus modes cannot be programmatically configured by a third-party app. Instead:
- During onboarding, show a walkthrough screen: "For mittens to be your single notification surface, set up a Focus mode. We'll walk you through it."
- Deep-link to Settings where possible: `App-Prefs:Focus` (works on some iOS versions).
- Show screenshots of: Settings → Focus → + → Custom → "Mittens" → Allow only mittens notifications → set a schedule if desired.

### 10.2 Detection of Focus state

iOS doesn't expose current Focus state directly, but:
- If push notifications to mittens are failing to deliver (device unresponsive), assume user has "Do Not Disturb" configured but didn't allow mittens. Surface a re-setup prompt on next app open.
- When mittens sends a notification, include `"interruptionLevel": "timeSensitive"` in the APNs payload for critical items — this bypasses standard Focus modes but NOT "Do Not Disturb unless emergency." Use sparingly; overuse triggers user annoyance + Apple guidance violations.

### 10.3 Critical-alert entitlement (optional, high bar)

For truly critical things (user-defined VIP contacts flagged high priority), Apple offers a Critical Alerts entitlement that bypasses all Focus/DND modes. Apply for this if desired; Apple manually reviews. Not in v1 scope.

## 11. Data model changes

### 11.1 New Strapi collections

- `gmail-integration` — per-user OAuth tokens, watch expiry, historyId.
- `imessage-integration` — per-user API key for Mac companion, pairing status, last heartbeat.
- `inbound-message` — normalized inbound messages from any source (see §4.3).
- `outbound-message` — drafts and sent messages with status.
- `message-classification` — LLM output per inbound message.
- `contact-priority` — user's contact priority store.
- `health-snapshot` — daily derived health metrics.
- `cycle-log` — menstrual cycle phase history + symptoms.

### 11.2 Profile additions

Extend `nutrition-profile`:
```json
{
  "sex": "female" | "male",        // already exists
  "tracksMenstrualCycle": { "type": "boolean", "default": false },
  "notificationPreferences": {
    "type": "json",
    "default": { "digestFrequency": "hourly", "quietHoursStart": null, "quietHoursEnd": null }
  },
  "healthKitAuthorized": { "type": "boolean", "default": false },
  "gmailConnected": { "type": "boolean", "default": false },
  "imessageConnected": { "type": "boolean", "default": false }
}
```

## 12. Privacy and security

- **Encryption at rest**: email bodies and iMessage bodies on Strapi are encrypted with a per-user envelope key derived from user's password hash. Rotation on password change.
- **Minimum retention**: iMessage bodies purged after 30 days (summary retained), Gmail bodies after 60 days, classification metadata kept longer.
- **TLS everywhere**: Mac ↔ backend, backend ↔ iOS. No plaintext transport.
- **User data export + delete**: GDPR-style endpoints `GET /me/export` and `DELETE /me/all-data`. Both must wipe the Mac companion's local state too (send a `purge` command over the WebSocket).
- **Audit log**: every outbound send logged with timestamp, recipient, source, draft origin (LLM-generated vs user-edited %).
- **LLM prompt hygiene**: the classification system prompt never includes the user's own prior messages beyond the thread being classified. No cross-conversation blending.
- **No third-party analytics** on message content. Only aggregate counts (messages classified, send rate).

## 13. Onboarding additions

Add these screens after the LMST onboarding (spec'd in `lmst-schedule-spec.md`):

**Step 7 — Connect Gmail**
- "Mittens can intercept time-sensitive emails and draft replies. Connect your Gmail?"
- Buttons: [Connect Gmail] [Skip for now]
- On connect, OAuth flow.

**Step 8 — Connect iMessage (optional, if user indicated Mac available)**
- "To manage iMessage, mittens needs a small helper app on your Mac. Show instructions?"
- Pairing-code screen displayed, instructions to install the Mac app.
- This step can be deferred and completed later from Settings.

**Step 9 — Apple Health**
- "Mittens uses your health data to personalize nutrition and validate your schedule. Share health data?"
- HealthKit permission sheet triggers on tap.

**Step 10 — Focus mode walkthrough**
- Illustrated guide to setting up "Mittens-only" Focus.
- Deep-link to Settings when possible.
- "Mark complete" button (best we can do without programmatic detection).

**Step 11 — Contact priorities (lightweight)**
- "Tag 3–5 VIP contacts so mittens knows who to always notify you about."
- Pull from Contacts; user taps a few names.

## 14. Migration for existing users

- New fields default to off (`gmailConnected: false`, etc.) so existing flows are unaffected.
- Surface a one-time card: "Mittens can now manage your notifications. Connect Gmail / iMessage / Health?" with a link to the new onboarding-style flow.
- No destructive migrations.

## 15. Edge cases

| Case | Behavior |
|---|---|
| Gmail refresh token invalidated (user revoked access) | Next API call fails with 401 → backend marks `gmailConnected=false`, pushes a re-auth prompt to iOS. |
| Mac companion offline for > 24h | iOS shows amber indicator, explains in Settings. Don't spam notifications. |
| LLM classifier down | Default every message to `normal` priority, fall back to contact-priority-only routing. Log for retry. |
| User on a trip crosses into airplane mode mid-draft | Draft persists locally on iOS until connectivity. Send queued. |
| User taps Send but iMessage recipient's number isn't in their contacts | Backend returns error; iOS prompts "Add contact?" before send. |
| HealthKit data unavailable (no Apple Watch, no iPhone sleep tracking) | Gracefully degrade: period-only mode, skip HRV/sleep-based adjustments. |
| User's cycle is irregular | Use observed cycle length statistics (median ± MAD) instead of assuming 28 days. Fall back to literal observed flow when prediction uncertainty is high. |
| Male users / non-menstruating users | `tracksMenstrualCycle = false` by default, all cycle logic short-circuited. |
| User uses multiple email accounts | v1: single Gmail account. Additional accounts backlog. |
| Group iMessage thread with high volume | Throttle: per-thread cap of 1 notification per 10 min unless priority === `critical`. |
| Phishing email misclassified as critical | User can report from UI; feeds a spam-training list. Mittens should NEVER auto-send in response to an inbound email (we're draft-only in v1, so safe by design). |

## 16. Acceptance criteria

1. Gmail OAuth completes, tokens stored encrypted on backend, never leaked to client post-exchange.
2. New Gmail message from a non-VIP friend with "can we move dinner to 6:30 tonight?" produces `priority: critical` or `high`, `isTimeSensitive: true`, and fires a push notification within 60s of receipt.
3. Newsletter email produces `priority: low` and does NOT push-notify — it aggregates into hourly digest.
4. Mac companion installed on a test Mac successfully pairs with iOS via a 6-digit code and begins relaying messages within 10s of receipt.
5. "Head home by 6" iMessage from a known contact fires a mittens push within 15s of the Mac receiving it.
6. Draft generation produces a reply matching user's tone from past-sent samples; user can edit and send.
7. Send via Gmail successfully threads (reply appears in same thread, `In-Reply-To` set).
8. Send via iMessage delivers to the correct handle (verified manually).
9. HealthKit permission sheet appears during onboarding; user grants access and sees cycle phase in Today view within 30s.
10. During menses, the iron recommendation increases by ≥50% vs follicular baseline; during luteal, magnesium + B6 increase per §9.2.
11. HRV drop >15% triggers a "recovery day" banner with nutrient-and-training adjustments.
12. All message bodies on backend are AES-encrypted at rest; a DB dump does not reveal content.
13. `DELETE /me/all-data` wipes both backend and Mac companion local state.
14. Draft-only mode enforced: no code path calls `gmail.send` or iMessage AppleScript outside of an explicit user tap.

## 17. Open questions for product / design

- Digest cadence default: hourly, or aligned with LMST meal times (breakfast/lunch/dinner digest)?
- Should mittens auto-create calendar events from "see you Tue 7pm" in messages, or prompt first?
- VIP contacts: inherited from iOS Favorites, or managed inside mittens only?
- Retention policy: the 30/60-day values above are starting points; revisit with legal/privacy review.
- Critical Alerts entitlement: pursue now or defer?

## 18. File summary

**New files (iOS app):**
- `mittens-app/lib/services/gmailApi.ts` — OAuth, watch setup, message fetch, send
- `mittens-app/lib/services/imessageApi.ts` — pairing, status, send routing
- `mittens-app/lib/services/healthKit.ts` — permissions, observers, snapshot builder
- `mittens-app/lib/services/cyclePhase.ts` — phase detection from HK data
- `mittens-app/lib/services/inboxClassification.ts` — client-side rendering of backend classifications
- `mittens-app/lib/services/draftGenerator.ts` — thin client for backend draft endpoint
- `mittens-app/app/inbox.tsx` — unified inbox tab
- `mittens-app/app/(tabs)/settings/integrations.tsx` — integration management
- `mittens-app/app/(tabs)/settings/contacts.tsx` — contact priority management
- `mittens-app/app/onboarding/integrations.tsx` — steps 7–11

**New packages (backend — Strapi):**
- `building-fashion-future/backend_strapi/api/gmail-integration/` — controllers, models, services
- `.../api/imessage-integration/` — same
- `.../api/inbound-message/` — normalized message store + webhooks
- `.../api/outbound-message/` — draft + send log
- `.../api/message-classification/` — LLM pipeline
- `.../api/contact-priority/` — priority store
- `.../api/health-snapshot/` — daily health rollup
- `.../api/cycle-log/` — cycle phase history

**New standalone repo:**
- `mittens-relay-mac/` — macOS menu-bar companion (Swift/SwiftUI recommended). Separate repo + distribution (DMG or Homebrew tap). Build + sign separately.

**Modified files:**
- `mittens-app/app/onboarding.tsx` — extend with integration steps
- `mittens-app/lib/types.ts` — new interfaces for messages, classifications, health snapshots, cycle
- `building-fashion-future/backend_strapi/api/nutrition-profile/models/nutrition-profile.settings.json` — add integration flags
- `building-fashion-future/backend_strapi/api/nutrition-log/services/rda-calculator.js` — accept cycle phase, apply multipliers per §9.2

## 19. Phased rollout (suggested)

- **Phase 1 (2–3 weeks):** Apple Health integration + cycle-phase nutrition. Lowest risk, highest-value isolated feature. No backend changes needed beyond RDA calculator.
- **Phase 2 (3–4 weeks):** Gmail integration + classification pipeline + unified inbox + draft flow. Validates the classification architecture end-to-end on a single channel.
- **Phase 3 (3–4 weeks):** iMessage Mac companion. Highest-effort piece; worth evaluating BlueBubbles as an alternative in week 1.
- **Phase 4:** Focus mode polish, contact priority inference tuning, critical alerts entitlement, multi-account support.

## 20. Sources

- [Apple HealthKit — menstrual flow & cycle tracking](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/menstrualflow)
- [@kingstinct/react-native-healthkit — GitHub](https://github.com/kingstinct/react-native-healthkit)
- [Gmail API — push notifications via Pub/Sub](https://developers.google.com/gmail/api/guides/push)
- [BlueBubbles — open-source iMessage backend](https://bluebubbles.app/)
- [An Overview of the Impact of the Menstrual Cycle on Nutrient Metabolism — PMC (2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC13074570/)
- [Minerals and the Menstrual Cycle — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11013220/)
- [Supplements for Each Menstrual Cycle Phase — Biologica](https://biologica.com/blogs/womens-health-research/supplements-menstrual-cycle-phases)
- [Apple Critical Alerts entitlement](https://developer.apple.com/documentation/usernotifications/sending_critical_alerts)
