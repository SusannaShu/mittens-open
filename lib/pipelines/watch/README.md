# Watch Pipeline (On-Demand Web + Social Lookup)

## Why

"Hey Mittens, is there any free food from nycforfree today?"
"Anything interesting on HackerNews right now?"
"Any new soft robotics papers? Humanoid only, not marine."

Mittens goes and looks, reads the content, filters it, and comes back
with cards. Same conversational pattern as the email pipeline — user
asks, Mittens fetches, brain filters, user gets results.

No polling. No cron jobs. No always-on scraper. Just ask when you want.

## How it fits into Mittens

Triggered from chat, same as email. The brain plans what to fetch and
how to filter, then code + brain phases execute.

```
                       Mittens Pipeline Architecture
                       ─────────────────────────────

  Photo input ──→ triage ──→ food / activity / pantry / sleep
  Text input  ──→ triage ──→ chat (+ side effects)
  Text input  ──→ triage ──→ email (Gmail agent)
  Text input  ──→ triage ──→ watch (web + social lookup)
                                │
                                ▼
                  ┌────────────────────────────────┐
                  │  Phase 1: PLAN (brain)          │
                  │  "what site, what filter?"      │
                  │                                 │
                  │  Phase 2: FETCH (code)          │
                  │  get the content                │
                  │                                 │
                  │  Phase 3: FILTER (brain)        │
                  │  keep only what user wants      │
                  │                                 │
                  │  Phase 4: EXTRACT (brain)       │
                  │  pull out structured details    │
                  │                                 │
                  │  Phase 5: CARDS (UI)            │
                  │  show results                   │
                  └────────────────────────────────┘
```

## Example Flows

### "any free food from nycforfree?"

```
PLAN    (brain)  → intent: check nycforfree website + IG stories
                   filter: food events only
                   sources: [nycforfree.com, instagram.com/nycforfree]

FETCH   (code)   → nycforfree.com: scrape event listings
                   IG stories: call Strapi scraper endpoint on demand
                   (Strapi runs Instaloader once, returns story images)

FILTER  (brain)  → brain.vision() each story image:
                   "free dumplings Chinatown" → keep
                   "free concert Central Park" → skip (not food)
                 → brain.text() website listings:
                   "free pizza meetup" → keep
                   "free museum admission" → skip

EXTRACT (brain)  → for kept items, brain extracts:
                   {what, where, when, cost, details}

CARDS   (UI)     → show food event cards with [Save] [Add to Calendar]
```

### "anything on hackernews?"

```
PLAN    (brain)  → intent: check HackerNews front page
                   filter: use lifeview/workview (no explicit filter)
                   source: news.ycombinator.com

FETCH   (code)   → HN Firebase API: top 30 stories
                   get title, url, points, comments

FILTER  (brain)  → brain.text() batch of 5 titles at a time:
                   user interests: robotics, design, startups
                   keep: "Show HN: Laundry folding robot" (robotics)
                   skip: "Bitcoin hits $200k" (not in interests)

EXTRACT          → (skip — title + link is enough for HN)

CARDS   (UI)     → show HN story cards with [Read] [Save for later]
```

### "new soft robotics papers? humanoid only"

```
PLAN    (brain)  → intent: check arXiv cs.RO recent
                   filter: "humanoid shape only, not marine animal"
                   source: arxiv.org/list/cs.RO/recent

FETCH   (code)   → arXiv API or RSS feed
                   get title, authors, abstract, date

FILTER  (brain)  → brain.text() each paper title + first line of abstract:
                   "Tendon-Driven Humanoid Gripper" → keep
                   "Octopus-Inspired Underwater Locomotion" → skip (marine)

EXTRACT          → (skip — title + authors + abstract link is enough)

CARDS   (UI)     → show paper cards with [Read Abstract] [Save]
```

## Phase 1: Plan (brain)

User's chat message → brain figures out:
- Which source(s) to check
- What filter to apply
- Whether it needs vision (stories/images) or just text

**E2B prompt (compact):**
```
User wants web info. Parse intent.
Input: "any free food from nycforfree?"
Return JSON: {sources:[{url,type:"web"|"ig_stories",handle}],filter:"food events only",needs_vision:true}
```

**Remembering preferences:** if the user has asked about nycforfree before,
Mittens can store the source + filter note in `watch_sources` as a shortcut.
Next time, "any food from nycforfree?" skips the planning step — Mittens
already knows the source, filter, and fetch method.

## Phase 2: Fetch (code only, no AI)

### Web pages
Three strategies, auto-detected:
1. **RSS/Atom** — try `{url}/rss`, `{url}/feed` first
2. **Known API** — HN Firebase, arXiv OAI-PMH, Reddit JSON
3. **HTML scrape** — Cheerio extraction as fallback

### Instagram stories
On-demand call to Strapi endpoint:
```
POST /api/watch-scraper/fetch-stories
{ handle: "nycforfree" }

→ Strapi runs Instaloader, grabs current stories
→ returns: [{ image_url, timestamp, media_type }]
```

No polling — Strapi only scrapes when Mittens asks. Stories are
ephemeral (24h) so this is always fetching "what's up right now."

**Instaloader auth:** IG credentials stored in Strapi .env. Single
authenticated session. Rate-safe for on-demand use (a few calls/day).

### Dedup
Optional — if user asks about the same source twice in a day, skip
items already shown. Track by item hash in `watch_items` table.

## Phase 3: Filter (brain)

Every item goes through the brain. This is the core value — Mittens
doesn't just fetch, it **understands** what you want.

### Text content → brain.text()
```
Filter for user. Keep only: "food events"
Items:
1. "Free dumpling tasting - Chinatown Sat 2pm"
2. "Free concert - Central Park Sun 4pm"
3. "Free pizza meetup - East Village Fri 7pm"
Return JSON: {keep:[1,3],skip:[2]}
```

### Visual content (IG stories) → brain.vision()
```
Is this story about food?
Filter: "food events only, skip non-food"
Return JSON: {keep:true|false,reason:"one line"}
```

**Vision on E2B:** ~23.8s per image. For 5-8 stories, ~2 min total.
Acceptable since the user just asked and is waiting. Larger brains
are faster.

### Using lifeview/workview as implicit filter
When no explicit filter is given ("anything on HackerNews?"), the brain
uses the user's lifeview + workview keywords as the filter criteria.

## Phase 4: Extract (brain)

For kept items, optionally extract structured details.

**Text items:** often unnecessary — title + link is enough for HN/arXiv.

**Visual items (stories):** brain.vision() reads the image and extracts:
```ts
{
  what: "Free dumpling tasting",
  where: "88 East Broadway, Chinatown",
  when: "Saturday Apr 27, 2pm-5pm",
  cost: "free",
  details: "First come first served, limit 2 per person"
}
```

## Phase 5: Cards (UI)

Results shown in chat as cards.

### Web content card
```
┌─────────────────────────────────────────┐
│ 📰 HackerNews                          │
│                                         │
│ "Show HN: Robot that folds laundry"     │
│  284 points · 127 comments · 3h ago     │
│  Mittens: matches your robotics interest│
│                                  [→]    │
└─────────────────────────────────────────┘
```

### Story content card (food)
```
┌─────────────────────────────────────────┐
│ 📸 @nycforfree · story · 2h ago        │
│                                         │
│ ┌───────────────────────────────────┐   │
│ │         [story image]             │   │
│ └───────────────────────────────────┘   │
│                                         │
│ 🍜 Free dumpling tasting               │
│ 📍 88 East Broadway, Chinatown          │
│ 🕐 Today 2pm-5pm                       │
│ 💰 Free · first come first served      │
│                                         │
│ [Save]  [Add to Calendar]  [Dismiss]   │
└─────────────────────────────────────────┘
```

## Saved Sources (optional convenience)

If a user keeps asking about the same sources, Mittens can suggest
saving it as a shortcut:

"You've asked about nycforfree a few times — want me to remember
this so you can just say 'any food today?' next time?"

Saved in `watch_sources` table — not for polling, just so Mittens
knows which site + filter to use when the user asks again.

```sql
CREATE TABLE IF NOT EXISTS watch_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  label TEXT,                            -- "@nycforfree" or "HackerNews"
  source_type TEXT DEFAULT 'web',        -- 'web' | 'ig_stories'
  filter_note TEXT,                      -- "only food events"
  fetch_method TEXT DEFAULT 'auto',      -- 'rss' | 'json_api' | 'html' | 'instaloader'
  platform TEXT,                         -- 'instagram' | 'hackernews' | 'arxiv' | null
  platform_id TEXT,                      -- IG handle, etc.
  created_at TEXT DEFAULT (datetime('now'))
);
```

## Watch Items (result cache)

```sql
CREATE TABLE IF NOT EXISTS watch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES watch_sources(id),
  item_hash TEXT NOT NULL,               -- dedup within session
  title TEXT,
  url TEXT,
  summary TEXT,
  image_url TEXT,
  image_local_path TEXT,
  author TEXT,
  published_at TEXT,
  extracted_data TEXT,                   -- JSON from Phase 4
  filter_reason TEXT,                    -- why brain kept it
  shown_at TEXT DEFAULT (datetime('now'))
);
```

## File Structure

```
lib/pipelines/watch/
├── README.md              # this file
├── plan.ts                # Phase 1: brain interprets user query
├── fetch.ts               # Phase 2: dispatcher (web vs IG)
├── feedParser.ts          # web: RSS/Atom parsing
├── htmlScraper.ts         # web: Cheerio HTML extraction
├── filter.ts              # Phase 3: brain.text() or brain.vision()
├── extract.ts             # Phase 4: brain extracts structured details
├── sources.ts             # saved source shortcuts (CRUD)
└── items.ts               # result cache (CRUD)

--- server side (Strapi) ---

strapi/src/api/watch-scraper/
├── controllers/fetch.ts   # POST /fetch-stories — on-demand IG scrape
├── services/insta.ts      # Instaloader wrapper
└── routes/fetch.ts        # route definition
```

## Context Window Budget

| Step | Brain? | Mode | Tokens in | Tokens out |
|------|--------|------|-----------|------------|
| Plan | Yes | text | ~30-50 | ~50 |
| Fetch | No | -- | -- | -- |
| Filter (text batch of 5) | Yes | text | ~80 | ~20 |
| Filter (visual per image) | Yes | vision | ~30 + image | ~15 |
| Extract (text) | Yes | text | ~60 | ~40 |
| Extract (visual) | Yes | vision | ~30 + image | ~40 |
| Cards | No | -- | -- | -- |

## Error Handling

- **Site unreachable:** "I couldn't reach nycforfree.com right now. Try again?"
- **IG scraper fails:** "Couldn't grab their stories right now. Want me
  to check their website instead?"
- **No relevant results:** "I checked @nycforfree — they have 4 stories
  up but none are about food right now."
- **Vision timeout:** "Still looking at their stories..." (show progress)

## Relationship to Email Pipeline

Watch and email are sibling pipelines. Both are:
- Triggered by chat (text-only, no photos)
- Plan-then-execute pattern
- Mix of code phases (fetch) and brain phases (filter/extract)
- Results shown as cards

The triage step in `triage.ts` routes to the right one:
- "check my email" → email pipeline
- "check hackernews" → watch pipeline
- "anything from nycforfree?" → watch pipeline

## Future Extensions

- **Scheduled checks:** opt-in periodic fetch for specific sources
  (becomes a background job, but only if user explicitly wants it)
- **Cross-source queries:** "any free food events anywhere?" checks
  multiple saved sources at once
- **Location-aware:** surface food events near current location first
- **Action chaining:** "Add to Calendar" triggers calendar pipeline
- **Share:** forward a card to a friend via email pipeline
