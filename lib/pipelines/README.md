# Pipelines Architecture

## Philosophy

Every user input (photo, text, manual form) flows through the same pipeline
structure regardless of which AI brain is selected. Pipelines own all the
intelligence: prompt construction, response parsing, phase sequencing, and
re-run logic. Brains are dumb text-in/text-out wrappers.

## How it works

```
User Input (photos + caption + manual fields)
     |
     v
  triage.ts  ──→  which pipeline(s)? can be multiple
     |
     ├──→ food pipeline    (meal photo/text → nutrient log)
     ├──→ activity pipeline (movement/event → activity log)
     ├──→ pantry pipeline   (fridge photo → inventory update)
     ├──→ sleep pipeline    (sleep mention → sleep log)
     ├──→ chat pipeline     (conversation → reply + side effects)
     ├──→ email pipeline    (Gmail agent: search, read, compose, send)
     └──→ watch pipeline    (web feeds: scrape → filter → cards)

Each pipeline has phases. Each phase:
  - Has typed input/output
  - Calls brain.text() or brain.vision() with a small focused prompt
  - Can be re-run independently (user edits → restart from that phase)
  - Shows progress in UI (loading state per phase)
  - Same code path for AI input AND manual input
```

## Key principles

1. **No heuristic triage** -- use brain.vision() to classify, because a photo
   could be food, selfie, sunset, fridge, running pic, or multiple at once.

2. **Multiple pipelines from one input** -- "biked to park and got smoothie"
   triggers food + activity + outdoor/UV pipelines simultaneously.

3. **Manual input = same pipeline minus AI** -- when user fills the manual
   entry form, it enters the pipeline at the right phase with pre-filled
   fields, skipping the AI classification step.

4. **Every UI field = a pipeline phase** -- engagement, energy, AEIOU,
   environment, skin exposure, social context -- each is a phase that AI
   can estimate OR user can fill manually. Same code processes both.

5. **Brain-agnostic** -- pipelines import from `brain/selector.ts` and call
   `brain.text(prompt)`. They never know if it's E2B, Gemma 26B, Gemini,
   or Claude responding.

6. **Prompt size adapts** -- each phase checks `brain.contextWindow` and
   uses compact format (short keys) for small models, verbose for large.

7. **Code phases where possible** -- email and watch pipelines introduce
   deterministic code phases (keyword filtering, RSS parsing, HTML sanitizing)
   between brain phases. Don't burn inference on work a regex can do.

8. **Background pipelines** -- email and watch can run on schedules
   (via BackgroundFetch + expo-notifications), not just on user input.
   Same phase structure, just triggered by a timer instead of a chat message.
