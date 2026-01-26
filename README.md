# Pitch Avatar Load Testing

Playwright-based test suite for validating the PitchAvatar chat experience (UI, WebSocket,
and audio playback/recording) across dev, stage, and prod.

## Setup
1. Install dependencies:
   - `npm install`
2. Install Playwright browsers:
   - `npx playwright install`

## Configuration
Environment files load in this order: `DOTENV_CONFIG_PATH`, `.env.<CHAT_ENV>`, `.env`.
If nothing is set, `CHAT_ENV` defaults to `prod`.

Core settings:
- `CHAT_ENV`: `dev` | `stage` | `prod`
- `CHAT_URL`, `SCR_SHORT_LINK`, `API_BASE_URL`, `WS_BASE_URL`
- `CHAT_UI_USERS`, `CHAT_ASSIST_TIMEOUT_MS`, `CHAT_WS_ASSIST_TIMEOUT_MS`
- `CHAT_WORKERS` (override Playwright workers)

Audio and sync tuning: see `.env` for the full list of `CHAT_AUDIO_*` variables.

Examples:
- `npm run test:stage`
- `$env:CHAT_ENV="dev"; npm test`

## Running Tests
- All tests: `npm test`
- Smoke suite: `npm run test:smoke`
- Regression suite: `npm run test:regression`
- API-only tests: `npm run test:api`
- E2E tests: `npm run test:e2e`
- UI reply-time load test: `npm run test:ui`
- UI + WS validation: `npm run test:ui-ws`
- Environment presets: `npm run test:dev`, `npm run test:stage`, `npm run test:prod`

## Test Coverage (High Level)
- UI chat reply timing: `tests/e2e/chat-avatar-load.spec.ts`
- UI message chains: `tests/e2e/chat-avatar-chain.spec.ts`
- UI WebSocket capture: `tests/e2e/chat-avatar-ws-ui.spec.ts`
- API + WS flow: `tests/api/chat-avatar-api-ws.spec.ts`
- WebRTC audio presence and playback timing: `tests/e2e/chat-avatar-audio-webrtc.spec.ts`
- Audio recording of assistant replies: `tests/e2e/chat-avatar-audio-record.spec.ts`
- Text-to-audio sync metrics: `tests/e2e/chat-avatar-text-audio-sync.spec.ts`

## Output
- HTML report: `playwright-report/`
- Artifacts and attachments: `test-results/`
- Reply timing log: `test-results/chat-reply-times-<runId>.log` (UI load test)

## Notes
- Several UI/audio specs force `headless: false`, so a browser window will open i hope.
- WebRTC/audio specs use `--use-fake-ui-for-media-stream` to avoid permission prompts.
