# Autotest Coverage Baseline: `pitch-avatar-load-testing`

Date: 2026-03-20  
Audience: Business, QA Lead, Engineering  
Purpose: Fix the current-state baseline for this repository so future roadmap planning can start from real existing automation, not assumptions.

## 1. Executive Summary

This repository is a single Playwright + TypeScript automation suite that combines API checks, browser E2E checks, WebSocket validation, WebRTC/audio validation, and CMS provisioning flows.

Current strength:
- the suite already protects the main happy-path for chat reply delivery;
- it validates transport-level behavior through REST, WebSocket, and browser-observed streaming events;
- it automates CMS creation of widget/data-driven avatars, including file upload, knowledge attachment, media generation, and short-link creation.

Current limitation:
- the suite does **not** close the business loop from "avatar created in CMS" to "returned short link was opened and the created avatar was proven usable in chat";
- the suite is heavy on technical/runtime checks, but still thin on feature-level UI coverage, negative cases, CRUD completeness, and business-rule assertions.

## 2. Project Card

| Area | Current state |
| --- | --- |
| Main framework | Playwright 1.56 + TypeScript |
| Execution model | Single Chromium project |
| Layers in repo | `tests/api` and `tests/e2e`; no active `tests/ui` layer |
| Environments | `dev`, `stage`, `prod` via `.env*` files |
| Reports | Console list + HTML report |
| CI maturity | No CI workflow found in this repo |
| Dynamic scaling | `CHAT_UI_USERS` multiplies runtime chat tests; `CMS_LOAD_USERS` multiplies CMS load creation |
| Default discovered inventory | `npx playwright test --list` returns 16 tests in 10 files |
| Default smoke inventory | 7 tests |
| Default regression inventory | 0 tests |
| Default pure UI inventory | 0 tests |

Important note: some CMS suites are guarded by env flags (`CHAT_RUN_CMS_*`), and the load suite materializes only when `CHAT_RUN_CMS_DATA_VIDEO_LOAD=1`.

## 3. What Is Already Covered

### 3.1 Chat Runtime and Reply Delivery

Covered by:
- `tests/api/chat-avatar-api-ws.spec.ts`
- `tests/e2e/chat-avatar-load.spec.ts`
- `tests/e2e/chat-avatar-chain.spec.ts`
- `tests/e2e/chat-avatar-ws-ui.spec.ts`

What is validated:
- screening login through SCR API;
- sending user chat messages through `report-actions`;
- assistant reply arrival through WebSocket;
- assistant reply visibility in UI;
- multi-turn question chain;
- reply timing capture and logging;
- UI/WS mismatch detection when WS receives a message but UI does not render it.

Business meaning:
- the suite protects the most critical chat happy-path: a user can send a message and receive an assistant reply.

### 3.2 Audio and Streaming Behavior

Covered by:
- `tests/e2e/chat-avatar-audio-webrtc.spec.ts`
- `tests/e2e/chat-avatar-audio-record.spec.ts`
- `tests/e2e/chat-avatar-text-audio-sync.spec.ts`
- `tests/e2e/chat-avatar-load.spec.ts` (stream event observation)

What is validated:
- browser-observed stream traffic for `/api/wrapper/v1/streams/connect|sdp|ice`;
- presence of inbound audio packets/bytes;
- media playback start detection;
- recording of assistant audio to artifact file;
- text-to-audio and text-to-playback delay measurement.

Business meaning:
- the suite protects the media-delivery side of the experience, not only text chat.

### 3.3 CMS Avatar Provisioning

Covered by:
- `tests/api/chat-avatar-cms-mvp.spec.ts`
- `tests/api/chat-avatar-cms-data.spec.ts`
- `tests/api/chat-avatar-cms-data-video.spec.ts`
- `tests/api/chat-avatar-cms-data-video-load.spec.ts`

Scenario matrix already present:
- 1 MVP widget avatar creation flow;
- 4 data-driven avatar scenarios:
  - PDF, 10 slides, no knowledge
  - PDF, 10 slides, mixed knowledge
  - PPTX, 10 slides, no knowledge
  - PPTX, 10 slides, mixed knowledge
- 4 equivalent video-avatar scenarios;
- 1 conditional load-oriented video creation scenario multiplied by `CMS_LOAD_USERS`.

What is validated:
- CMS login;
- speech voice lookup;
- avatar image lookup;
- assistant role lookup;
- source presentation creation/import;
- presentation file upload;
- presentation parsing wait;
- copy source presentation to target avatar presentation;
- title update;
- knowledge source creation for file, link, and text;
- assistant creation;
- media generation;
- assistant readiness polling;
- screening link creation;
- screening settings update.

Business meaning:
- the suite already covers the operational happy-path for provisioning avatars in CMS and receiving usable artifacts such as IDs and short links.

## 4. Endpoint / Contract Coverage Already Touched

### 4.1 Covered Directly by Test Code

SCR / chat runtime:
- `POST /api/scr/{shortLink}/login`
- `POST /api/scr/{shortLink}/report-actions`
- WebSocket v2 frames for `report_action`, `assistant_chat_message`, `chat_stream_chunk`

CMS provisioning:
- `POST /auth/login`
- `GET /speech-voices`
- `GET /avatar-images`
- `GET /avatar-images/{id}`
- `GET /assistant-roles`
- `POST /presentations`
- `GET /presentations/{id}`
- `PATCH /presentations/{id}`
- `POST /presentations/{selected}/copy-to-assistant/{target}`
- `POST /files`
- `POST /d-id/upload-tmp-file`
- `POST /pst-content`
- `POST /assistants`
- `GET /assistants/{id}`
- `POST /screenings?include=setting`
- `PATCH /screening-settings/{id}`
- `POST /presentations/{id}/generate-assistant-media`

### 4.2 Covered Indirectly Through Browser Observation

Observed in browser/network instrumentation:
- `POST /api/wrapper/v1/streams/connect`
- `POST /api/wrapper/v1/streams/sdp`
- `POST /api/wrapper/v1/streams/ice`

This is useful, but it is still observability-based validation, not full contract validation.

## 5. Coverage Gaps

### 5.1 Business-Critical Gap: No Closed Loop From CMS Creation to Real Chat Usability

Current CMS tests stop after asserting IDs, link presence, and generation success.  
They do **not**:
- open the created `result.url`;
- log in to the created screening;
- send a real message to the newly created avatar;
- assert that the created avatar answers correctly.

Impact:
- the suite proves provisioning artifacts were produced;
- it does not yet prove that the produced avatar is actually usable by an end user.

### 5.2 No Pure UI Layer

The repository contract talks about API, UI, and E2E layers, but there are:
- 10 `@api` tests,
- 6 `@e2e` tests,
- 0 `@ui` tests.

Impact:
- feature-level UI behavior is not isolated from end-to-end runtime noise;
- business-facing UI regressions may be detected late or not at all.

### 5.3 No Regression Suite Segmentation

Current discovered tagging:
- 7 `@smoke` tests;
- 0 `@regression` tests.

Impact:
- there is no clean nightly/full-regression lane;
- smoke currently contains heavyweight audio/WebRTC scenarios and is not a lean MR gate by design.

### 5.4 CRUD Coverage Is Partial

Covered well:
- create flows for assistant provisioning and knowledge attachment.

Not covered:
- assistant update flow;
- assistant delete flow;
- presentation delete / cancel flow;
- presentation table/list flow;
- knowledge update flow;
- knowledge delete flow;
- role CRUD;
- custom avatar image upload/delete;
- image-group and weblink-group flows;
- AI image description flow.

Impact:
- current automation protects mainly "create new avatar" happy paths;
- edit, cleanup, and admin maintenance operations remain unprotected.

### 5.5 Chat Runtime Coverage Is Partial

Covered:
- login;
- send message action;
- assistant reply over WS;
- UI rendering of reply.

Not covered or not explicitly asserted:
- chat history refresh endpoint;
- screening parameters setup;
- voice-recognition token flow;
- load-time config endpoints (`emotions`, `languages`, `triggers`, `time-no-action-rules`, `setting`);
- negative WS / retry / reconnect behavior;
- validation of message ordering beyond simple happy path.

Impact:
- runtime coverage is good for "reply exists", but incomplete for full chat-session behavior.

### 5.6 Data Matrix Is Narrow

Current automated matrix is limited to:
- English language;
- 10-slide PDF and PPTX;
- two knowledge states: none / mixed;
- default voice resolution;
- default avatar image resolution.

Not covered:
- large files;
- edge file types;
- multilingual flows;
- special characters / localization;
- complex knowledge-only cases;
- different role / goal combinations;
- multiple browsers / mobile viewports.

### 5.7 Negative and Error Handling Coverage Is Minimal

Examples not covered:
- invalid CMS credentials;
- invalid short link;
- unsupported presentation format;
- presentation parsing failure;
- media generation failure;
- missing avatar image / missing compatible voice;
- network interruption during message send;
- empty message / message limit validation;
- permission problems / auth expiration.

### 5.8 Cleanup and Environment Hygiene Are Missing

Current provisioning tests create real CMS entities and do not delete them afterwards.

Impact:
- environment pollution;
- hard-to-track leftover test data;
- rising maintenance cost and investigation noise.

### 5.9 Browser / Platform Coverage Is Minimal

Current execution:
- Chromium only;
- desktop only;
- several tests require `headless: false`.

Impact:
- there is no confidence for Firefox/WebKit/mobile;
- headless CI-friendliness is limited.

## 6. Automation Maturity Risks

### 6.1 Technical Debt Inside the Suite

Observed risks:
- repeated use of `waitForTimeout(...)` polling in E2E specs;
- heavy reliance on runtime instrumentation and permissive selectors;
- no dedicated `storageState` / auth optimization layer;
- no `tests/ui` folder despite declared contract;
- HTML report exists, but no JUnit integration was found;
- no CI workflow was found in this repository.

Impact:
- slower execution;
- higher flakiness risk;
- harder adoption as a business KPI gate.

### 6.2 Scope Ambiguity

The repo name suggests load testing, but the suite is mostly:
- functional happy-path coverage,
- latency/observability probes,
- provisioning automation.

It is **not** a dedicated performance-testing framework in the classical sense.

Impact:
- business stakeholders may overestimate current load/performance protection.

## 7. Coverage Assessment by Business Area

| Business area | Current assessment | Comment |
| --- | --- | --- |
| Chat reply happy-path | Medium | Covered through API, UI, and WS, but mostly existence-based assertions |
| Audio/WebRTC delivery | Medium | Good technical instrumentation, limited browser matrix |
| CMS avatar creation | Medium | Strong happy-path provisioning coverage |
| CMS edit/admin flows | Low | Create flow only; CRUD incomplete |
| Knowledge management | Low | Only create path for file/link/text |
| Screening/link usability | Low | Link is created, but not consumed end-to-end |
| UI feature behavior | Low | No separate UI layer |
| Negative/error handling | Low | Very limited |
| Regression governance | Low | No active regression lane |
| Performance/load confidence | Low | Probe-style only, not full load framework |

## 8. Recommended Roadmap For This Repository

### Phase 1: Baseline Stabilization

Priority:
- introduce real `@regression` tagging;
- keep smoke small and business-critical only;
- add a minimal `@ui` layer for lightweight chat UI checks;
- add CI workflow + machine-readable reporting;
- add cleanup strategy for CMS-created entities;
- normalize selectors and reduce arbitrary time-based polling.

Expected outcome:
- a controllable, cheaper, and more trustworthy automation baseline.

### Phase 2: Close the Business Loop

Priority:
- after CMS creation, open returned short link and validate real chat usability;
- connect provisioning tests with runtime chat tests;
- add edit-existing-avatar flow;
- cover screening settings variants that matter to business;
- add negative cases for provisioning and chat transport.

Expected outcome:
- automation starts validating real customer value, not only backend artifact creation.

### Phase 3: Expand Functional Matrix

Priority:
- add multilingual coverage;
- add file-size/content-type matrix;
- add knowledge CRUD coverage;
- add role/goals scenarios;
- add mobile viewport and second-browser coverage.

Expected outcome:
- broader release confidence and clearer release-scope traceability.

### Phase 4: Separate True Performance Coverage

Priority:
- move true load/performance objectives into a dedicated load framework/tooling track;
- keep Playwright focused on functional, journey, and observability checks.

Expected outcome:
- no confusion between functional coverage and performance certification.

## 9. Bottom Line

This repository already gives useful protection for:
- chat reply availability;
- WebSocket/media transport visibility;
- CMS avatar creation happy paths.

It does **not yet** provide strong protection for:
- created-avatar usability after provisioning;
- full CRUD lifecycle;
- negative and resilience cases;
- lean UI regression gating;
- true performance certification.

For cross-project planning across three frameworks, this repo should be treated as:
- a technically capable Playwright baseline;
- strong in happy-path journey coverage;
- medium in provisioning coverage;
- weak in governance, negative-path depth, and business-loop completeness.
