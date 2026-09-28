# WebSocket text-response load tests

This is a separate performance suite. It creates independent sessions of **one avatar** per environment, sends questions over WebSocket, and measures text returned on that socket. It does not launch a browser, establish WebRTC/media streams, or measure lipsync, audio generation/playback, or UI rendering.

The ordinary Playwright config excludes `tests/performance` and `tests/local`, so these scenarios do not join existing smoke/regression runs. A single worker runs scenarios one after another. Concurrency comes from independent WS connections within a scenario, not from Playwright workers. Playwright tests and questions are not retried, including on CI; optional recovery during session preparation is documented below.

## Scenarios

| Name | Independent sessions | Sequential questions per session | Questions per environment |
| --- | ---: | ---: | ---: |
| `chain-1x25` | 1 | 25 | 25 |
| `parallel-10` | 10 | 3 (or 2) | 30 (or 20) |
| `parallel-20` | 20 | 3 (or 2) | 60 (or 40) |
| `parallel-50` | 50 | 3 (or 2) | 150 (or 100) |

Default total: **265 questions per environment**, 795 for dev, stage and prod. Each scenario creates fresh sessions. Every session logs in independently and receives a distinct `scrUserID`. All sessions finish preparation and drain startup text before the first questions are released together. Later questions follow the previous **complete** answer in that session, with no artificial think time. There is no barrier between later turns.

The Aurelian Harbor Trust workload requested on 2026-09-28 uses **two** questions per parallel session: 25 + 20 + 40 + 100 = **185 questions per environment**, 555 across three environments. Follow the source-specific question set and staged selection process in [Aurelian questions and answer key](ws-load-aurelian-questions.md).

Session preparation is not timed as response latency. A preparation failure or reused `scrUserID` prevents the entire cohort from starting; a requested 50-session run is never silently reduced to fewer sessions. The report records actual readiness, peak outstanding questions, and the spread between first-question send times. The latter exposes client scheduling skew instead of claiming an exact simultaneous network arrival.

Sessions are prepared one at a time by default, then all questions start at a common barrier. Live dev testing on 2026-09-25 exposed HTTP 500 errors in parameter initialization when preparing 10/20/50 sessions concurrently; those startup failures are retained separately from WS response measurements. `WS_LOAD_SETUP_CONCURRENCY` can change preparation concurrency explicitly without changing question concurrency.

## Run after receiving the fresh links

Dependencies already used by the repository (`@playwright/test` and `ws`) are sufficient. Browser installation and CMS credentials are not needed for a publicly accessible avatar link.

Before a load matrix, use `npm run test:ws-preflight:dev` (or `:stage` / `:prod`) with `WS_LOAD_CHAT_URL` and the intended `WS_LOAD_QUESTIONS_FILE`. It sends the first three questions from that source file, adding a fresh plain alphanumeric code to each. It writes `preflight.json` under `test-results/ws-preflight/<UTC-run-id>/`, including an allowlisted snapshot of avatar ID, role, language, and cache state. Inspect content and response language: assertions verify transport completion, not relevance. These probes are excluded from load measurements.

Set `$env:WS_LOAD_REQUIRE_CACHE_DISABLED = '1'` for a run intended to exclude the avatar's configured cache. Both preflight and load preparation then reject a cache flag of `true`, a missing flag, or an ambiguous avatar before WS questions. Only an explicit boolean `false` is accepted. Each session records the metadata returned by its own login; public API access does not permit editing the CMS setting. The flag does not independently establish the behavior of other backend or model-provider caches.

For diagnostic discovery with the existing cache setting, explicitly use `'0'` (the compatibility default). Do not label that run as uncached.

PowerShell:

```powershell
$env:WS_LOAD_QUESTIONS_FILE = 'test-data/ws-load-aurelian-questions.json'
$env:WS_LOAD_LANGUAGE = 'en'
$env:WS_LOAD_SCENARIOS = 'chain-1x25'

$env:WS_LOAD_CHAT_URL = 'https://slides-dev.pitchavatar.com/REPLACE_WITH_FRESH_DEV_LINK'
npm run test:ws-load:dev

$env:WS_LOAD_CHAT_URL = 'https://slides-staging.pitchavatar.com/REPLACE_WITH_FRESH_STAGE_LINK'
npm run test:ws-load:stage

$env:WS_LOAD_CHAT_URL = 'https://slides.pitchavatar.com/REPLACE_WITH_FRESH_PROD_LINK'
npm run test:ws-load:prod
```

`WS_LOAD_CHAT_URL` is required. The suite deliberately does not load `.env` files or reuse old `CHAT_URL` / `SCR_SHORT_LINK` values. Each command sets the environment explicitly, validates the link host, and selects the corresponding existing API/WS hosts from the repository configuration. A URL alone does not start any test. Use `-- --list` with any environment command to list the selected scenarios without requests.

To select a scenario or use two questions per parallel session:

```powershell
$env:WS_LOAD_SCENARIOS = 'parallel-10'
$env:WS_LOAD_PARALLEL_QUESTIONS = '2'
$env:WS_LOAD_PARALLEL_QUESTION_IDS = 'REPLACE_WITH_TWO_CONFIRMED_IDS'
npm run test:ws-load:stage

Remove-Item Env:WS_LOAD_SCENARIOS
Remove-Item Env:WS_LOAD_PARALLEL_QUESTIONS
Remove-Item Env:WS_LOAD_PARALLEL_QUESTION_IDS
```

Do not override Playwright workers, retries, `repeat-each`, or full parallelism for these measurements. Configuration and sample counts describe one execution of each selected scenario.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WS_LOAD_CHAT_URL` | required | Fresh public avatar link matching dev/stage/prod |
| `WS_LOAD_SCENARIOS` | `all` | One or a comma-separated subset of names above |
| `WS_LOAD_PARALLEL_QUESTIONS` | `3` | `2` or `3`; the long chain always has 25 |
| `WS_LOAD_QUESTIONS_FILE` | existing question pool | UTF-8 JSON array of at least 25 nonempty strings |
| `WS_LOAD_PARALLEL_QUESTION_IDS` | unset | Comma-separated 1-based IDs from the same pool, one per parallel turn; the same selected questions repeat across sessions with fresh codes |
| `WS_LOAD_LANGUAGE` | `en` | Explicit language for both Presentation Language and Listener Language over HTTP and WS; never silently inherits the screening language |
| `WS_LOAD_RESPONSE_TIMEOUT_MS` | `60000` | Deadline for a complete text response to one question |
| `WS_LOAD_CONNECT_TIMEOUT_MS` | `15000` | HTTP request / WS handshake timeout |
| `WS_LOAD_SETUP_TIMEOUT_MS` | `60000` | Total preparation deadline per session |
| `WS_LOAD_SETUP_CONCURRENCY` | `1` | Concurrent session preparations; all prepared WS sessions still send the first question together |
| `WS_LOAD_SETUP_ATTEMPTS` | `1` | Optional bounded recovery of transient HTTP/network failures during setup only; every attempt is recorded |
| `WS_LOAD_SETTLE_MS` | `1000` | Startup text quiet window; reset by text events and blocked by an unfinished startup stream |
| `WS_LOAD_REQUIRE_CACHE_DISABLED` | `0` | `1` requires public avatar metadata to explicitly report `is_cache_enabled: false` before sending any WS question |

Questions are sent unchanged from the source pool, followed by a newline and `Reference code ` plus letters and digits only. There are no bracketed tags, punctuation in the code, or added business scenarios. The single session uses questions 1 through 25. With `WS_LOAD_PARALLEL_QUESTION_IDS`, every parallel session uses exactly the selected questions in that order. Without it, the legacy pool index is `((session - 1) * questionsPerSession + turn - 1) % poolSize`. Reports retain the source question ID, base question, full sent text, code, and hashes with and without codes. Different codes prevent exact whole-request repeats; the base questions intentionally repeat in the parallel workload. Answer relevance is reviewed against the source answer key, separately from transport completion.

`sessions[].languageID` records the requested session language; `sourceScreeningLanguageID` retains the language returned by login, and `avatar.languageId` retains the avatar language. For example, a source screening reporting `ru` with `WS_LOAD_LANGUAGE=en` causes both HTTP and WS language parameters to use `en`, while the discrepancy remains visible in the report. Actual answer language must still be checked before load.

For a dev/stage/prod comparison, match the avatar's model, instructions, language and knowledge base as well as selected questions and counts. Answer text/length is retained so differences can be investigated. Exact repeated full request strings are prevented. This does **not** prove that backend semantic-response caching or model prompt-prefix caching is disabled: no server-side cache bypass or cache-hit telemetry is available in the documented protocol. Keep the older sales/business-context runs separate from the new PDF workload. A plain code is not evidence of a cache miss or a guaranteed way to avoid a content filter.

The live links checked on 2026-09-25 exposed `screening-assistants.attributes.is_cache_enabled: true` in all three environments. Their role names differed: `Kate_Sales manager` on dev versus `Test_avatar_creation_role` on stage/prod. Stage/prod returned scope refusals to the sales prompts, often with identical text. Those timings measure completed WS text, including refusals; they cannot establish comparable uncached generation performance. Before another matrix, check the public login metadata, confirm equivalent avatar configuration and cache settings, and inspect several trial answers for relevant content. A complete text response alone is not evidence of a useful answer or a cache miss.

## Metrics and completion rules

- `firstTextMs`: monotonic client time from immediately before WS send to the first non-whitespace text. Empty stream-start events and non-text chunks do not count.
- `fullTextMs`: time from that same send to `chat_stream_end`, or to a complete non-streaming `assistant_chat_message`. This is the primary question-to-answer metric.
- `elapsedMs`: actual time until success/failure, including timeouts. A failed or incomplete reply has **null** full-text latency, not an artificially fast result.
- Per scenario: sample count, min, mean, p50, p95, max; failures/skips, completion rate, actual concurrency, first-wave send spread, setup time, successful replies/sec during the response window, and timings grouped by turn.
- Percentiles use nearest rank and **successful complete replies only**. Partial replies and failures remain in raw records, with their observed first-text latency. Error rate uses attempted questions as denominator; completion rate uses all planned questions. If no question was attempted, error rate is null.

Each socket has at most one outstanding question. Stream fragments are assembled by assistant message ID, preserving spaces. IDs observed during startup or completed earlier are ignored for future questions. Missing IDs, overlapping new message IDs, empty completed answers, server errors, timeouts and socket closures are recorded as failures. After a failed reply, that session skips remaining turns: a late reply must not become the next question's answer. Other sessions continue.

Questions and Playwright tests are never retried. If `WS_LOAD_SETUP_ATTEMPTS` is explicitly increased, a transient setup timeout, HTTP 5xx or selected network error can create a replacement session before the common start. A bounded 500 ms × attempt backoff is outside response timing. `sessions[].preparationAttempts` and `summary.failedSetupAttempts` retain failures even when preparation recovers; authentication errors and invalid protocol/session data are not retried.

The suite sends each measured question **only through WS**, using the `report_action` envelope. REST is used for login, parameter setup and the existing startup report. No media endpoints are called. Live dev validation on 2026-09-25 showed that `set_parameter` requires `name`, `type` and a typed `value`; the `parameter_name` form in the local protocol document is rejected with `set_parameter: empty name`. The load client follows the validated runtime format, matching the older API/WS client. Session reports also record the configured avatar language.

### Verify on the first live link

Local checks validate the runner against the repository's documented protocol; they do not establish that dev/stage/prod currently behave identically. Before the full live matrix, verify the text-only flow on the new avatar:

- A WS question must trigger text without the additional REST chat report used by the historical UI flow.
- The backend must emit a terminal `chat_stream_end` for streamed responses (or a complete non-streaming message).
- The backend must allow subsequent turns without browser media playback or `action_finish` acknowledgments. The runner does not fake successful speech playback or alter the avatar's media configuration. Backend media work, if configured independently of a browser connection, is not proven to be disabled by this client.
- Use an avatar without delayed unsolicited messages during measurement. The protocol does not guarantee an echoed question/request ID in assistant replies. The runner correlates by session, sequential turn and assistant message ID; an unrelated new message arriving after a question cannot always be distinguished from its answer. The startup quiet window drains observed greetings, but cannot prove the absence of future ones.

Small runs of 25–150 replies per scenario describe latency under this finite workload. They are not a soak test, a capacity estimate, or an SLA verdict. No pass/fail latency threshold is invented: a test passes when every planned question gets complete text.

## Reports

Each invocation uses a unique directory under `test-results/ws-load/<UTC-run-id>/`:

- `run-summary.md` / `run-summary.json`: scenario comparison and missing-metrics indicators, including failed runs.
- `html/index.html`: Playwright report with per-scenario attachments.
- `artifacts/**/metrics/results.json`: settings, setup diagnostics, per-turn metrics, full and partial answer text.
- `artifacts/**/metrics/questions.csv`: one row per planned question, including errors and skipped turns.
- `artifacts/**/metrics/summary.md`: human-readable scenario summary.

CSV text is quoted and formula-like cells are neutralized for spreadsheet viewing. Login tokens, authorization headers and raw protocol frames are not written into these metrics. Backend error bodies are not copied into setup errors. Reports include questions and avatar answers and stay in the existing ignored `test-results` directory.

## Local verification (no dev/stage/prod traffic)

```powershell
npm run test:ws-load:local
```

The local suite binds mock HTTP/WS servers to `127.0.0.1`. It verifies the full 1×25 / 10×3 / 20×3 / 50×3 matrix, independent sessions and concurrency, startup greetings, stale duplicates, streamed/non-streamed and legacy replies, incomplete answers, errors, setup failures, percentiles and report output. It requires neither links nor credentials.
