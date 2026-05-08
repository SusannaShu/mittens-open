# Email Pipeline

## Why

Users get dozens of order confirmations, shipping updates, and receipts buried
in their inbox. But that's just the start -- Mittens can also search emails
to answer questions, extract calendar events, and even compose/send emails.

The key insight: **the user tells Mittens what they want**, and Mittens figures
out the right action sequence. This is a **composable Gmail agent**, not a
single-purpose pipeline.

## How it fits into Mittens

Same brain-agnostic contract as food/activity/sleep. The difference: the email
pipeline is triggered from chat (text-only, never photos) and uses a
**plan-then-execute** pattern. The brain plans which actions to chain, then
the runner dispatches them.

```
                       Mittens Pipeline Architecture
                       ─────────────────────────────

  Photo input ──→ triage ──→ food / activity / pantry / sleep
  Text input  ──→ triage ──→ chat (+ side effects)
  Text input  ──→ triage ──→ email (Gmail agent)
                                │
                                ▼
                  ┌────────────────────────────────┐
                  │  Phase 1: PLAN (brain)          │
                  │  "what does the user want?"     │
                  │                                 │
                  │  Phase 2+: EXECUTE action chain │
                  │  (varies by action type)        │
                  └────────────────────────────────┘
```

## Action Types

### search_orders (find order confirmations)
```
"find my depop dress" / "show me my recent clothing orders"

PLAN → SEARCH → FILTER → READ → PARSE_ORDERS → REVIEW_CARDS
```

### search_read (find + read emails, answer questions)
```
"check my emails with olivia, did she say sunday or monday?"

PLAN → SEARCH → READ → ANSWER
```

### search_read_act (find + read + do something)
```
"...and add that to my calendar"

PLAN → SEARCH → READ → EXTRACT_EVENT → CALENDAR_CONFIRM
```

### compose_send (write + send a new email)
```
"send an email to gretchen saying I'm late"

PLAN → RESOLVE_CONTACT → COMPOSE → DRAFT_CARD (user confirms) → SEND
```

## Gmail OAuth

Separate from Google Calendar -- independent OAuth flow, independent token.

**Scopes (all requested upfront):**
- `gmail.readonly` -- search + read
- `gmail.send` -- send emails
- `gmail.compose` -- create drafts

**Token storage:** local AsyncStorage + Strapi (dual write).

**Connect flow:**
1. User triggers email action in chat
2. If not connected → prompt to connect (or connect from Profile)
3. OAuth flow → backend token exchange → store token
4. Profile tab shows Gmail connected state

## Action Modules

| Module | Type | Purpose |
|--------|------|---------|
| `plan.ts` | Brain | Classify intent, extract search/compose params |
| `search.ts` | Code | Gmail API query builder + message search |
| `read.ts` | Code | Fetch full email + HTML sanitization |
| `filterOrders.ts` | Code | Deterministic order relevance scoring |
| `retailers.ts` | Data | Known retailer domains + patterns |
| `parseOrders.ts` | Brain | Extract structured order items |
| `answer.ts` | Brain | Answer questions from email content |
| `compose.ts` | Brain | Write email drafts |
| `send.ts` | Code | Gmail API send (RFC 2822) |
| `resolveContact.ts` | Code | Find email address from name |
| `extractEvent.ts` | Brain | Extract calendar event from email |

## File Structure

```
lib/pipelines/email/
├── README.md              # this file
├── plan.ts                # Phase 1: brain plans action sequence
├── search.ts              # action: Gmail API search
├── read.ts                # action: fetch + sanitize email body
├── filterOrders.ts        # action: deterministic order scoring
├── retailers.ts           # data: known retailer domains
├── parseOrders.ts         # action: brain extracts order items
├── answer.ts              # action: brain answers question from email
├── compose.ts             # action: brain writes email draft
├── send.ts                # action: Gmail API send
├── resolveContact.ts      # action: find email from name
└── extractEvent.ts        # action: brain extracts calendar event

lib/services/
└── gmailService.ts        # OAuth flow, token management (separate from calendar)
```

## Context Window Considerations

| Action | Brain? | Tokens in | Tokens out |
|--------|--------|-----------|------------|
| Plan | Yes | ~30-50 (user message) | ~60 (plan JSON) |
| Search | No | -- | -- |
| Read | No | -- | -- |
| Filter | No | -- | -- |
| Parse Orders | Yes | ~50-100 (one cleaned email) | ~60 (order items JSON) |
| Answer | Yes | ~100-200 (email context) | ~50 (answer text) |
| Compose | Yes | ~30-50 (intent) | ~60 (draft JSON) |
| Extract Event | Yes | ~100-200 (email context) | ~40 (event JSON) |
| Send | No | -- | -- |
| Resolve | No | -- | -- |

Each brain call stays within E2B's context window. The code phases in between
(search, filter, read, sanitize) are what make this possible.

## Error Handling

- **Gmail not connected:** prompt to connect in chat (or Profile)
- **Token expired:** attempt refresh via Strapi, prompt re-auth if refresh fails
- **No results:** "I couldn't find matching emails. Want to try different terms?"
- **Parse failure:** show raw email snippet as fallback
- **Send failure:** show error, keep draft for retry
- **Rate limit:** queue and backoff, show "still searching..."

## Safety

- **compose_send NEVER auto-sends.** Always shows a draft card for human review.
- **gmail.readonly** scope is read-only -- no modifications to user's inbox.
- **Token stored locally** as source of truth; Strapi has a copy for sync.

## Data Flow to SUSU Closet

Order items go to local `wardrobe_items` SQLite table. Future sync:
Mittens → Strapi → SUSU Closet.

## Future Extensions

- **Recurring scan:** background job checks for new orders daily
- **Price tracking:** compare purchase prices across retailers
- **Return window alerts:** "Your return window closes in 3 days"
- **Trading map integration:** items marked "want to trade" flow to SUSU Map
- **Receipt extraction:** parse totals for budgeting
- **Email triage:** morning debrief of important emails
- **Smart unsubscribe:** detect newsletters, offer to unsubscribe
