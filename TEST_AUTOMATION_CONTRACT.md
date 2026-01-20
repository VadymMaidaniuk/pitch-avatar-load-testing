# Test Automation Contract (Playwright + TypeScript)

## 0) Metadata

- **Owners:** QA Automation team
- **Version:** 1.0
- **Last updated:** 2026-01-19
- **Scope:** UI tests, E2E tests, API-only tests, CI pipelines, test data strategy

---

## 1) Principles (non-negotiable)

We use RFC-style keywords:
- **MUST** / **MUST NOT** — required
- **SHOULD** / **SHOULD NOT** — recommended
- **MAY** — optional

Core principles:

1) **Deterministic**
- Tests MUST pass/fail for product reasons, not timing.
- No fixed sleeps (`waitForTimeout`) unless explicitly justified and approved in review.

2) **Independent**
- Tests MUST be order-independent and parallel-safe.
- A test MUST create its own data or use isolated, read-only fixtures.

3) **Fast feedback**
- `@smoke` suite MUST be small and fast enough to run on each MR.
- E2E is limited to critical "golden paths".

4) **Maintainable**
- Shared logic MUST live in fixtures / helpers / API clients, not copy-pasted between tests.
- Page Objects contain actions and selectors; assertions stay in tests.

5) **Observable**
- Failures MUST produce useful artifacts: trace (on retry), screenshot/video (on failure), logs.

6) **Secure**
- Secrets MUST NOT be committed.
- Test accounts MUST be non-production and have minimal privileges.

---
## 2) Test layers (what goes where)

We aim for a practical “testing pyramid”:

### 2.1 API-only
Use for:
- contract/validation of endpoints
- data seeding/cleanup
- fast regression of business rules

Rules:
- Prefer stable IDs and explicit assertions on status/body
- Centralize auth, headers, baseURL in API clients

### 2.2 UI (feature-level)
Use for:
- UI behavior, accessibility roles/flows inside a feature
- layout/UX assertions that matter

Rules:
- Do not chain long scenarios; keep scope tight
- Use stable locators (see section 6)

### 2.3 E2E (golden paths)
Use for:
- 3–10 critical end-to-end journeys that represent real production usage

Rules:
- E2E MUST be minimal and high-value
- Any flaky E2E is treated as high priority to fix

### 2.4 Non-goals (in this repo)
- Load/performance testing (separate tooling/suite)
- Security testing (separate processes)

---

## 3) Tagging and suites

We use tags as Playwright annotations in test titles, for example:
- `test('[@smoke][@ui] user can log in', ...)`

### 3.1 Required tags
Every test MUST include exactly one of:
- `@api` or `@ui` or `@e2e`

Every test SHOULD include exactly one of:
- `@smoke` (MR gating) or `@regression` (full suite)

### 3.2 Optional tags
- `@slow` — allowed, but must be justified in the PR description
- `@wip` — allowed locally only; MUST NOT be committed to main branch
- `@flaky` — quarantine tag (see section 11)

### 3.3 What runs where
- **Merge Request pipeline:** `@smoke` only
- **Nightly / scheduled pipeline:** `@regression` (all)
- **Manual jobs:** optional targeted runs by tag/file

---

## 4) Repository structure (convention)

Recommended layout:

```
.
├─ playwright.config.ts
├─ package.json
├─ tsconfig.json
├─ .gitlab-ci.yml
├─ tests/
│  ├─ api/
│  ├─ ui/
│  ├─ e2e/
│  ├─ pages/           # thin Page Objects (actions + selectors)
│  ├─ fixtures/        # test fixtures (Playwright test.extend)
│  ├─ services/        # API clients, auth helpers
│  ├─ helpers/         # utils, generators, custom expect helpers
│  └─ data/            # static test data templates
└─ docs/
   └─ TEST_AUTOMATION_CONTRACT.md
```

Rules:
- Tests MUST live under `tests/**`.
- Shared logic MUST NOT be duplicated across files; extract to `fixtures/services/helpers`.

---

## 5) Naming conventions

### 5.1 Files
- Test files: `*.spec.ts`
- Prefer feature grouping: `tests/ui/<feature>/<scenario>.spec.ts`

### 5.2 Test names
- Use human-readable business language.
- Include tags in the test title prefix: `[@smoke][@ui] ...`

### 5.3 Fixtures / helpers / clients
- Fixtures: `tests/fixtures/*.ts`
- API clients: `tests/services/api/<Entity>Client.ts`
- Pages: `tests/pages/<Feature>Page.ts`

---

## 6) UI locator contract

### 6.1 Preferred locator order
1) `getByRole(...)` with accessible names
2) `getByTestId(...)` with stable IDs
3) `getByLabel(...)`, `getByPlaceholder(...)`

### 6.2 `data-testid` rules
- If a UI element is essential for automation and does not have a stable role/name, we MUST request `data-testid` from devs.
- `data-testid` naming: `feature.element.action` (example: `auth.login.submit`).

### 6.3 Forbidden (unless exceptional)
- CSS selectors tied to styling/layout (classes likely to change)
- XPath
- Text selectors for dynamic/translated text (unless stable product requirement)

---

## 7) Waiting and stability rules

- MUST NOT use `waitForTimeout` as a synchronization mechanism.
- Prefer Playwright auto-waiting + explicit `expect(...)`.
- Network waits MUST be explicit (`waitForResponse` / `waitForRequestFinished`) and scoped to a known call.

Timeouts:
- Keep reasonable global timeouts in config.
- Use per-step timeouts only when required and documented.

---

## 8) Page Objects and architecture rules

### 8.1 Page Objects (POM)
Page Objects SHOULD be “thin”:
- store locators
- provide actions (click/type/navigate)

Page Objects MUST NOT:
- contain assertions (assertions live in test)
- create random test data (use helpers/fixtures)
- hide important business intent (tests must remain readable)

### 8.2 Fixtures as the glue
- Create one entry-point fixture file: `tests/fixtures/test.ts` that exports `test` and `expect`.
- All tests MUST import from that single fixture entry:
  - `import { test, expect } from '../fixtures/test';`

---

## 9) API testing contract

### 9.1 API clients
- Wrap Playwright `request` into typed API clients.
- API clients MUST:
  - set `baseURL` and common headers in one place
  - provide methods per endpoint
  - include debug logging on failure (status + safe snippet of body)

### 9.2 Test data seeding
- Prefer seeding data via API (fast, stable) instead of UI.
- Each test SHOULD create unique entities and clean up after itself.

### 9.3 Schema/contract validation (optional, recommended)
- If we add Zod/JSON Schema validation, it MUST be centralized (do not validate ad-hoc differently per test).

---

## 10) Auth strategy

- UI tests SHOULD reuse auth state via `storageState`.
- Add an auth setup project that logs in once and writes `.auth/<role>.json`.
- API tests SHOULD use token-based auth (env vars) or API-login helper.

Security rules:
- Auth state files MUST NOT contain production secrets.
- Never commit `.auth/` content.

---

## 11) Parallelization and flakiness policy

### 11.1 Parallel
- Default: run tests in parallel.
- Tests MUST NOT share mutable external state.
- Use unique data per test (`testInfo.title` + random suffix) to avoid collisions.

### 11.2 Serial mode
- `test.describe.serial` is a LAST RESORT.
- Any serial block MUST include a comment explaining why it cannot be parallel.

### 11.3 Flaky handling
Definition of flaky: test fails intermittently without product change.

Rules:
- Flaky tests MUST be fixed, not “hidden”.
- Temporary quarantine is allowed only with:
  - `@flaky` tag
  - linked ticket
  - owner (assignee)
  - removal deadline noted in the ticket
- Retries are for CI noise reduction, NOT a substitute for fixing flakiness.

---

## 12) Reporting, logs, and artifacts

On failure in CI we SHOULD have:
- HTML report
- JUnit report (GitLab test report integration)
- Trace on first retry
- Screenshot/video on failure (config-dependent)

Artifact rules:
- Artifacts MUST be uploaded `when: always` in CI.
- Avoid huge artifacts by default; enable more only for debugging.

---

## 13) Git workflow and review rules

### 13.1 Branching
- Feature branches: `qa/<topic>` or `test/<topic>`

### 13.2 PR/MR requirements
Each MR that adds/changes tests MUST include:
- what was added/changed and why
- how to run locally
- tags used (`@smoke/@regression`, `@ui/@api/@e2e`)

Review checklist:
- stable locators
- no fixed sleeps
- deterministic data
- cleanup implemented
- readable assertions

### 13.3 Ownership (suggested)
- QA1: infra/CI/config/reports
- QA2: UI/POM/locators/fixtures
- QA3: API clients/data seeding/contract validation

Everyone reviews across areas, but each area has an “owner” for consistency.

---

## 14) Environment configuration

- Use `.env.example` for required variables.
- Use GitLab CI variables for secrets.

Recommended variables:
- `BASE_URL`
- `API_BASE_URL`
- `TEST_USER_EMAIL`
- `TEST_USER_PASSWORD`
- `API_TOKEN` (if applicable)

Rules:
- `.env` files MUST be gitignored.
- Never print secrets into logs.

---

## 15) Definition of Done (for any new test)

A new test is “done” when:
- it has required tags
- it is deterministic and parallel-safe
- it cleans up created data (or uses isolated disposable data)
- it follows locator contract
- it produces useful diagnostics on failure
- it runs locally AND in CI (at least in smoke/regression category)

---

## 16) Appendices

### A) Minimal test template

```ts
import { test, expect } from '../fixtures/test';

test('[@smoke][@ui] user can log in', async ({ page, authPage }) => {
  await authPage.open();
  await authPage.login(process.env.TEST_USER_EMAIL!, process.env.TEST_USER_PASSWORD!);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
});
```

### B) Minimal API client sketch

```ts
export class UsersClient {
  constructor(private readonly api: import('@playwright/test').APIRequestContext) {}

  async getMe() {
    const res = await this.api.get('/me');
    if (!res.ok()) {
      throw new Error(`GET /me failed: ${res.status()} ${await res.text()}`);
    }
    return res.json();
  }
}
```

### C) When you need a new convention
If you introduce a new pattern (new folder type, new helper approach, new reporter, new validation library):
- document it in this file (or in `docs/`)
- keep it consistent across the suite

