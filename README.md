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

Env files are intentionally kept small. Store only:
- `CHAT_ENV`: `dev` | `stage` | `prod`
- `CHAT_URL`, `SCR_SHORT_LINK`, `API_BASE_URL`, `WS_BASE_URL`
- `CMS_EMAIL`, `CMS_PASSWORD`
- `CHAT_UI_USERS`

Non-secret defaults such as timeouts, polling, audio tuning, and CMS runtime defaults are centralized in `tests/helpers/chatRuntimeConfig.ts`.

## WebSocket Protocol
- Current protocol contract is documented in `websocket-protocol-v2.md`.
- WS tests in this repository are compatible with v2 envelope messages (`version`, `type`, `payload`)
  and keep backward parsing for legacy frames where needed.

Examples:
- `npm run test:stage`
- `npm run test:api-ws:stage`
- `npm run test:cms-data:stage`
- `$env:CHAT_ENV="dev"; npm test`

## Running Tests
- All tests: `npm test`
- Smoke suite: `npm run test:smoke`
- Regression suite: `npm run test:regression`
- API-only tests: `npm run test:api`
- API + WS flow on stage: `npm run test:api-ws:stage`
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

## WebSocket text-response load testing

A separate browser-free suite measures question-to-first-text and question-to-complete-text
latency for one 25-question dialogue and 10/20/50 independent parallel sessions of one avatar.
It requires a fresh `WS_LOAD_CHAT_URL` and has explicit dev/stage/prod commands, with no test retries.

- Local verification only: `npm run test:ws-load:local`
- Role/cache/topic preflight: `npm run test:ws-preflight:dev` (also `:stage` / `:prod`)
- Require the avatar cache flag to be disabled: `$env:WS_LOAD_REQUIRE_CACHE_DISABLED = '1'`
- Dev: `npm run test:ws-load:dev`
- Stage: `npm run test:ws-load:stage`
- Prod: `npm run test:ws-load:prod`
- Setup, metrics, reports and protocol assumptions: [WebSocket load testing](docs/websocket-load-testing.md)
- Current English PDF workload, 25 questions and answer key: [Aurelian Harbor Trust](docs/ws-load-aurelian-questions.md)
- Two verified questions for parallel sessions: set `WS_LOAD_PARALLEL_QUESTIONS=2` and `WS_LOAD_PARALLEL_QUESTION_IDS` after reviewing the single-session answers. The session language defaults to `en`.

## Notes
- Several UI/audio specs force `headless: false`, so a browser window will open i hope.
- WebRTC/audio specs use `--use-fake-ui-for-media-stream` to avoid permission prompts.
