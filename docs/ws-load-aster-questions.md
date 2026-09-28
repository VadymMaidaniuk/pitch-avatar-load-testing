# Aster Harbor Services — prompt-based WS dataset

Prepared and tested on 2026-09-28. This prompt-contained dataset was used for the dev, stage, and prod load matrix. It replaces the PDF-based questions for these runs; historical reports retain their original sources.

The company and its facts are fictional. All answers are explicitly contained in the prompt text. No presentation, PDF, document retrieval, or external knowledge is required for the content questions.

- [Text to paste into the avatar role or user prompt](../test-data/ws-load-aster-role-prompt.txt)
- [25 questions for the test runner](../test-data/ws-load-aster-questions.json)
- [Expected answers and fact IDs](../test-data/ws-load-aster-answer-key.json)

Use the same text, prompt field, and language on dev, stage, and prod. The complete block can be placed in the role prompt. A role must permit questions about these supplied facts if they are instead placed in a user prompt.

## Validation and execution

1. Obtain new links after the prompt is saved.
2. Check the first three questions on each environment. Verify the answer content and English language; transport success alone is insufficient.
3. Run the 25-question chain, then 10, 20, and 50 independent sessions with two questions each, in environment order dev, stage, prod.
4. Choose two questions that received correct, substantive answers in the chain. Questions 8 and 14 were validated in all three environments and used in the 2026-09-28 parallel runs.
5. Use the same validated pair in every parallel session and environment. Send the second question only after the first complete answer in that session.

The matrix contains 185 measured questions per environment and 555 across all three. Preflight requests are separate.

## Configuration for the next run

Set these variables together with the new environment-matched link before running preflight or load tests:

```powershell
$env:WS_LOAD_QUESTIONS_FILE = 'test-data/ws-load-aster-questions.json'
$env:WS_LOAD_LANGUAGE = 'en'
$env:WS_LOAD_PARALLEL_QUESTIONS = '2'
$env:WS_LOAD_REQUIRE_CACHE_DISABLED = '0'
$env:WS_LOAD_CONNECT_TIMEOUT_MS = '30000'
$env:WS_LOAD_SETUP_TIMEOUT_MS = '90000'
$env:WS_LOAD_SETUP_CONCURRENCY = '1'
$env:WS_LOAD_SETUP_ATTEMPTS = '3'
Remove-Item Env:WS_LOAD_PARALLEL_QUESTION_IDS -ErrorAction SilentlyContinue
```

Run the chain with `WS_LOAD_SCENARIOS=chain-1x25`. Only after content validation, set `WS_LOAD_PARALLEL_QUESTION_IDS` to the two accepted IDs and `WS_LOAD_SCENARIOS=parallel-10,parallel-20,parallel-50`.

The harness appends a different plain alphanumeric Reference code to every request. This prevents exact duplicates of complete request text; semantic, response, and model prefix caching are not proven disabled. The prompt explicitly identifies the code as a tracking label.

## Status

Completed all 12 scenarios in environment order dev, stage, prod. All 555 measured replies were complete, in English, and correct against the supplied facts. There were no failed or skipped questions and no failed setup attempts. Nine separate preflight replies were also correct and excluded from load metrics.

Every measured full question text was unique. All 243 measured sessions exposed `cacheEnabled=true`; the unique codes do not establish that server or model caching was bypassed. This was one finite run per scenario, not a sustained-capacity or SLA test.

- [Combined metrics and method](../test-results/ws-load-aster-2026-09-28/summary.md)
- [All 555 measured questions, answers, and timings](../test-results/ws-load-aster-2026-09-28/questions.csv)
- [Nine preflight replies](../test-results/ws-load-aster-2026-09-28/preflight.json)
