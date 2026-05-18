# Mittens: ambient on-device AI for self-care

**The Gemma 4 Good Hackathon — Health & Sciences (with Digital Equity & Inclusivity)**

Code: [github.com/SusannaShu/mittens-open](https://github.com/SusannaShu/mittens-open) · Video: *(link)* · Demo: see `mittens-open/README.md` for setup

---

## The hook

Mittens is a wearable pendant + phone app that logs your life *for* you instead of asking you to log it yourself. It runs Gemma 4 on-device. No cloud, no accounts, no monthly bill.

I built it for myself — I'm neurodivergent and active logging breaks for me the same way it breaks for most people who actually need it. Then I realized the same primitives matter even more for someone with early dementia, or anyone whose attention is too precious to spend taking pictures of their lunch.

## The problem nobody is solving

Self-tracking apps assume you have the executive function to use them. The cruel joke is that the people who would benefit most from tracking — people with ADHD, autism, depression, early cognitive decline, elders unfamiliar with modern UI — are the people for whom every tap is a tax. The category response so far has been "more notifications." That's the wrong direction.

The interesting question is: **what becomes possible if the AI watches passively, runs on the device you already wear, and respects that your health data is yours?**

Three constraints follow from that question:

1. **Passive over active.** A pendant that observes you should infer what's happening — what you ate, that you walked, that you're staring at a screen — without asking you to perform the logging.
2. **Local over cloud.** Health and ambient camera data are the last things that should leave the device. Cloud is also a cost, an energy footprint, and a single point of failure for people in low-connectivity environments.
3. **Explainable over magic.** Every number Mittens shows has a tappable trail back to the log, the rule, and the peer-reviewed citation that produced it. If a small on-device model is going to make claims about your health, you have to be able to audit them.

Gemma 4 is the first open model that makes all three constraints simultaneously achievable.

## What Mittens does today

**Nutrition pipeline.** Photograph a meal (phone camera) and Mittens runs two phases: a Gemma 4 vision call identifies every item, then a separate knowledge call estimates 19 nutrients against USDA FoodData. The split matters — collapsing it into one call destroys accuracy because the model has to think about two unrelated things at once. The user picks between the USDA exact match and the AI estimate, side by side. Bioavailability rules are applied deterministically in code: vitamin C enhances iron absorption, calcium blocks it, plant vs animal vitamin A is tracked separately. Meal planning uses an MILP solver to close nutrient gaps across the day. Every gauge in the UI is tappable: which logs affected it, by how much, and the DOI-linked research behind the rule.

**Auto-activity from location.** Continuous GPS plus the iOS Motion Activity classifier auto-classifies movement as walking, biking, running, or transit and writes it to your calendar as an activity block. No "I went for a walk" entry needed. Vitamin D synthesis is estimated from sun exposure (geolocation + time of day + skin type); "nature exposure" is one of seven research-backed health pillars Mittens tracks.

**Pendant ambient sensing.** A XIAO ESP32S3 pendant in a leather case captures VGA JPEGs on IMU motion, streams them over BLE to the phone, and the same vision pipeline that runs on phone photos runs on pendant frames. Push-to-talk button records up to 10s of 16 kHz audio; Gemma 4 E2B processes audio natively, with iOS Speech framework as fallback for brain configurations that don't accept raw audio. The pendant detects when you're looking at a screen and starts a focus timer; it detects when you haven't eaten in a while and reminds you; it speaks the reminder through phone TTS so you don't need to look at anything.

**On-device face recognition for memory.** Hold the button and say "this is [Name]". A native Apple Vision + CoreML module extracts a 128-dim face embedding and saves it to local SQLite. Next time the pendant sees that person during ambient capture, cosine similarity recognizes them and Gemma 4 generates a context-aware greeting that includes the relationship, interaction history, and any memories you've logged. Recognition reinforces over time — every new sighting from a different angle is appended to the person's profile. This is the feature with the clearest extension to dementia care: imagine a parent who can't reliably recognize their adult child, getting a quiet "your daughter Susanna is here, she visited last Sunday and you talked about the garden" in their ear.

**Reflection and life balance.** Stanford Life Design philosophy practiced daily. Lifeview/workview reflections; nightly check-in that starts with your most important unreflected activity; a life balance gauge that breaks health into seven pillars (nutrition, movement, sleep, gut health, nature exposure, circadian hygiene, brain hygiene), every metric audit-traceable to logs and research.

## Why Gemma 4 specifically

Mittens is not "Gemma 4 as a chatbot backend." Gemma 4 is the architectural spine:

- **On-device E2B via LiteRT-LM.** I wrote a custom Expo native module (`modules/litert-lm`, iOS Swift + Android Kotlin) that runs Gemma 4 E2B locally on the phone in ~150 tokens of context. This is the default brain. No internet required.
- **Native multimodal.** The nutrition pipeline literally cannot work without a model that handles vision and text in the same context. E2B does both on-device. Pendant audio is processed by E2B's native audio path — no separate STT step when running on-device.
- **Brain-agnostic pipelines.** `lib/brain/selector.ts` lets the user pick between E2B (on-device, free), Gemma 4 26B (self-hosted via Ollama tunnel, free), or BYOK (any OpenAI-compatible API). Every pipeline checks `brain.contextWindow` and adapts prompt format — compact JSON keys for E2B, verbose for larger models. Swap brains in Profile, no pipeline code changes. This makes Gemma 4 genuinely the *foundation*, not an interchangeable LLM call.
- **Open weights** $0/month. Reproducible. Auditable. Mittens couldn't exist on a closed proprietary model — the privacy story collapses the moment you have to ship user frames to someone else's API.

## Architecture

```
You ask Mittens something          Pendant captures something
         |                                  |
         v                                  v
      triage  -->  which pipeline(s)?  <--  auto-triage by event type
         |                                  |
         +-->  food       (photo/text -> nutrients)
         +-->  activity   (movement -> AEIOU + life categories)
         +-->  pantry     (fridge photo -> inventory)
         +-->  sleep      (sleep mention -> sleep log)
         +-->  chat       (conversation -> reply + side effects)
         +-->  people     ("this is [Name]" -> face embedding -> recognition)
```

Every input — pendant frame, phone photo, typed text, voice, manual form — flows through the same pipelines. Pipelines own all the intelligence: prompt construction, phase sequencing, response parsing, re-run logic. Brains are dumb text-in/text-out wrappers. All data lives in local SQLite. There is no cloud sync and no account system. Your phone is your backup.

Stack: Expo dev client (React Native + TypeScript), Redux Toolkit, SQLite, custom LiteRT-LM native module for on-device Gemma, custom ExpoFaceRecognition module (Apple Vision + CoreML), Google Calendar OAuth, BLE for pendant comms.

## Impact

**Direct user (me).** Mittens is the first health tracker I've actually used because it doesn't ask me to perform the tracking. The break timer that fires from the pendant detecting screen time has done more for my work pattern than any Pomodoro app I've installed and abandoned.

**Adjacent users — dementia and elder care.** But many times I build and think about my grandma who raised me but sometimes can't remember my face and don't know how to read. Mittens' face location tracking + ambient camera capture + on-device voice prompts could help an elder and their family to know what's going on with them, be healthier, happier and get support in place even with no internet access. The data is theirs; what they choose to share with loved ones is a separate decision they make consciously. This is the inverse of how most health-monitoring tech is built for elders today (cloud-first, family-account-first, opaque).

**Wider users — anyone in a low-connectivity, privacy-sensitive, or low-resource environment.** Mittens runs without internet after first setup. The default brain is free. The hardware bill of materials is under $30. This is the demographic the Gemma 4 Good Hackathon brief was written for — people for whom cloud AI is not an option, technically or ethically.

**Energy footprint.** Every Gemma 4 call that runs on your phone is a Gemma 4 call that didn't run in a data center cooled with municipal water. At individual scale this is symbolic. At fleet scale it isn't.

## Limitations (honest)

I want to be clear about what works today and what doesn't.

- **Pendant camera quality.** The XIAO ESP32S3 captures VGA JPEGs. The nutrition pipeline works end-to-end on pendant frames — but at this image quality, the pendant can reliably tell that *you are eating*, while precise ingredient identification and nutrient analysis still benefits from a phone photo. The pipeline is ready; the sensor is the bottleneck. Better camera modules exist; the next pendant revision uses one.
- **iOS-first.** Native LiteRT-LM and face recognition modules are written for iOS Swift first, Android Kotlin second. Android works but has fewer hours of dogfooding.
- **Pantry inventory and the "watch" web/social pipeline are partial.** They appear in the README; I would not lead a demo with them yet.

None of these are limitations of Gemma 4 or the pipeline architecture. They're hardware and time-on-task limitations. Both are addressable; one of them just needs better sensors and the other needs more weekends.

## What's next

A wrist band (IMU for finer activity recognition, skin temperature, PPG for HRV and sleep staging). A custom-PCB pendant with a higher-quality camera, longer battery, and a waterproof titanium case. A peer-to-peer "trading map" so the inventory pipeline closes a loop with the local community. And — quietly, in the background — adapting the elder-care framing into something I could actually put in front of a family member, with the consent and data-sharing primitives the dementia case demands.

## Try it

The repo at [github.com/SusannaShu/mittens-open](https://github.com/SusannaShu/mittens-open) has full setup instructions. You need an Expo dev client (not Expo Go) because the on-device Gemma module is native. The pendant is optional — the phone app works on its own — but the pendant is what makes the passive-logging story real.

Cost: $0/month. Brains: Gemma 4 E2B on-device, Gemma 4 26B self-hosted, or BYOK. Data: yours, on your device.

Mittens lives on your body, not in a data center.

---

*Built solo by Susanna Shu. First pendant conversation: May 10, 2026.*
