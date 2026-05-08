# Mittens Open (Hackathon Edition)

> This repository is a sanitized, local-first fork of the private `mittens-app` codebase, prepared for the [Hackathon Name/Release].

Mittens is a local-first iOS application designed to track life activities, nutrition, sleep, and overall well-being using on-device AI. This open version removes all proprietary cloud infrastructure, backend connectivity (Strapi), and private APIs, operating completely offline using SQLite and the E2B (Exec to Browser) inference models.

## Architecture (Open Version)

- **Framework**: React Native 0.81 + Expo 54
- **Database**: Local SQLite (via `expo-sqlite`)
- **State Management**: Redux Toolkit + RTK Query (stubbed to use SQLite directly)
- **AI Inference**: On-device local models (Gemma/SmolVLM2)

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Prebuild iOS Project**
   Because this app uses custom native modules (LiteRT, BLE, etc.), you must prebuild the project before running:
   ```bash
   npx expo prebuild --platform ios --clean
   ```

3. **Run on iOS Simulator**
   ```bash
   npx expo run:ios
   ```

## Cloud Infrastructure Placeholders

In the original `mittens-app`, several features relied heavily on a private Strapi v5 backend, Socket.IO, and external APIs. To ensure the app remains fully functional off-grid, these have been replaced with Markdown placeholders or SQLite stubs:

- **Dev Hub**: Originally a remote server monitor for Docker logs.
- **Dev Notes Pipeline**: Originally an NLP ingestion pipeline that created GitHub issues.
- **Outreach Hub**: Originally a CRM and email processor.
- **Sync Engine**: The entire `syncEngine.ts` file has been stripped as data no longer pushes to a backend.

These screens still exist in the app but now contain static text explaining their original architecture.

## Repository Notes

- The Git history has been deliberately stripped to remove any trace of production API keys or sensitive commit histories from the private repository.
- `lib/api.ts` has been rewritten as a no-op stub.
- All cloud AI providers (Gemini, Claude, Groq) have been deleted from `lib/brain/`.

## License
MIT
