# Open-Source Release Readiness Audit

**Project:** OpenSidebar — AI-powered browser agent (Chrome MV3 extension)
**Date:** 2026-02-26
**Version audited:** 0.5.0 (commit `729d108`, branch `main`)
**Auditor:** Kushagra Shukla

---

## Executive Summary

OpenSidebar is architecturally production-ready with strong engineering fundamentals — strict TypeScript, 1,081 passing tests across 74 files, three-workflow CI/CD, and 46+ pages of documentation. However, releasing the repository publicly requires addressing **4 critical**, **6 high-priority**, and **9 medium-priority** items spanning security, legal compliance, documentation hygiene, and Chrome Web Store readiness.

**Estimated effort to release-ready:** 2-3 focused days.

| Category | Grade | Blockers |
|----------|-------|----------|
| Security | **C** | API keys in build pipeline, trace PII, `execute_js` sandbox |
| Legal & Licensing | **A-** | Missing Inter font OFL attribution |
| Documentation & DX | **B+** | Stale Bun references, incomplete env docs, empty changelog |
| Code Quality & CI | **A** | 5 lint warnings, 4 npm audit vulnerabilities |
| Architecture & Features | **A** | Clean — no TODOs, no half-baked features |
| Chrome Web Store | **B-** | No privacy policy URL, no promotional assets |

---

## 1. Security

### 1.1 CRITICAL — Build-Time API Key Injection

**Files:** `vite.config.ts`, `src/env.d.ts`, 16+ consumer files

The build pipeline injects API keys as compile-time constants via Vite's `define`:

```typescript
// vite.config.ts
define: {
  __OPENROUTER_API_KEY__: JSON.stringify(env.OPENROUTER_API_KEY ?? ""),
  __GROQ_API_KEY__: JSON.stringify(env.GROQ_API_KEY ?? ""),
  __CEREBRAS_API_KEY__: JSON.stringify(env.CEREBRAS_API_KEY ?? ""),
}
```

These become literal strings in the compiled JavaScript — visible in `dist/`, in the CRX package, and to anyone who decompiles the extension. Sixteen files use them as fallbacks (`settings.openRouterApiKey || __OPENROUTER_API_KEY__`).

**Fix:** Remove all `__*_API_KEY__` globals from `vite.config.ts` and `src/env.d.ts`. Remove all `|| __*_API_KEY__` fallback chains across the codebase. Keys must load exclusively at runtime from `chrome.storage.sync` (the settings UI already supports this).

**Affected files:**
- `vite.config.ts` — remove `define` entries
- `src/env.d.ts` — remove declarations
- `src/sidepanel/store/settings-slice.ts` — remove from `DEFAULT_SETTINGS`
- `src/background/background.ts` — remove fallback chains
- `src/background/orchestrator/index.ts` — remove fallback chains (2 places)
- `src/background/orchestrator/router.ts` — remove fallback chains (3 places)
- `src/background/perception.ts` — remove fallback chain
- `src/background/tools/index.ts` — remove Groq fallback
- `src/trace-viewer/components/traces/StoryPanel.tsx` — remove fallback

### 1.2 CRITICAL — Committed `.env` with Live API Keys

The `.env` file contains production API keys for OpenRouter, Groq, and Cerebras. Although `.env` is in `.gitignore`, it was committed at some point and exists in git history.

**Fix:**
1. Rotate all three API keys immediately (OpenRouter, Groq, Cerebras).
2. Run `git rm --cached .env` if still tracked.
3. Use BFG Repo-Cleaner or `git filter-repo` to scrub `.env` from history before making the repo public.
4. Expand `.env.example` to document all keys with comments.

### 1.3 HIGH — LLM Conversations in Traces (PII Risk)

**File:** `src/background/agent/trace.ts`

`TraceRecorder.recordLLMRequest()` writes full conversation history — including user queries, page content, and LLM responses — to `traces/runs/*.jsonl`. Screenshots are stored as base64 data URLs. This data could contain passwords, personal information, or sensitive page content.

**Fix:** Either strip raw messages from traces before disk write, implement PII redaction, or clearly document that traces are developer-only artifacts and add a `.gitignore` rule for `traces/runs/*.jsonl` (partially done but some files are committed).

### 1.4 HIGH — `execute_js` Tool Runs Untrusted Code

**File:** `src/background/tools/index.ts` (lines ~1759-1764)

The `execute_js` tool uses `new Function()` to evaluate LLM-generated JavaScript in the `MAIN` world of the target page. While gated behind tool-calling (the LLM must choose to invoke it), the code has access to `document.cookie`, `localStorage`, `fetch()`, and the full page DOM.

**Fix:** Document the risk in the security policy. Consider adding a domain-level allowlist, output sanitization, or a capability-restricted sandbox. At minimum, add `execute_js` to the "requires approval" tier so the user confirms before execution.

### 1.5 HIGH — Log Server CORS Policy

**File:** `scripts/log-server.ts`

The local log server binds correctly to `127.0.0.1:7589` but sets `Access-Control-Allow-Origin: *`. Any website a user visits could make requests to the log server endpoint.

**Fix:** Restrict CORS to the extension's origin (`chrome-extension://<id>`) or remove the wildcard header.

### 1.6 MEDIUM — Overly Broad Extension Permissions

**File:** `manifest.json`

The extension requests 15 permissions including `downloads`, `cookies`, `history`, `bookmarks`, and `<all_urls>` host permissions. While each is used by a corresponding tool, the surface area is significant.

**Fix:** Document the purpose of each permission in the README and SECURITY.md. Consider making some permissions optional (requested at runtime when the corresponding tool is first used) via `chrome.permissions.request()`.

### 1.7 MEDIUM — Log Redaction Gaps

**File:** `src/utils/storage-logger.ts`

`sanitizeData()` redacts keys named `apiKey`, `token`, `secret`, etc., and strips sensitive URL query parameters. However, it does not detect API key values appearing as plain strings in arbitrary fields (e.g., a key logged inside an error message string).

**Fix:** Add value-pattern matching (e.g., `sk-or-v1-*`, `gsk_*`, `csk-*`) to the redaction pipeline.

---

## 2. Legal & Licensing

### 2.1 License Compatibility — CLEAR

All 15 production dependencies and 23 dev dependencies use permissive licenses (MIT, Apache-2.0, ISC). **Zero GPL/AGPL/SSPL dependencies detected.** The project's MIT license is fully compatible.

| Dependency | License | Category |
|---|---|---|
| `@xenova/transformers` | Apache-2.0 | AI/ML |
| `@mozilla/readability` | Apache-2.0 | Content extraction |
| `pdfjs-dist` | Apache-2.0 | PDF parsing |
| `sql.js` | MIT | Database |
| `voy-search` | MIT OR Apache-2.0 | Vector search |
| `onnxruntime-web` | MIT | ML inference |
| `react`, `react-dom` | MIT | UI |
| `zustand`, `immer` | MIT | State management |
| `lucide-react` | ISC | Icons |
| All WASM binaries | MIT | Runtime |

### 2.2 MEDIUM — Missing Font Attribution

**File:** `src/sidepanel/fonts/Inter-Variable.woff2`

The Inter font (by Rasmus Andersson) is embedded in the build but no OFL license text or attribution is included in the repository.

**Fix:** Create `ATTRIBUTIONS.md` documenting:
- Inter Font: Copyright 2016-2024 Rasmus Andersson, Open Font License 1.1
- Lucide Icons: ISC license, portions copyright Cole Bemis (Feather, MIT)

### 2.3 LOW — No Copyright Headers in Source Files

Source files lack per-file copyright headers. This is optional under MIT license (the root LICENSE file covers the entire project), but some organizations prefer explicit headers.

**Recommendation:** Optional. If desired, add a one-liner: `// Copyright (c) 2026 OpenSidebar Contributors. MIT License.`

---

## 3. Documentation & Developer Experience

### 3.1 Current State — Strong Foundation

| Document | Present | Quality | Issues |
|---|---|---|---|
| `README.md` | Yes | Comprehensive | Outdated `bun` references |
| `CONTRIBUTING.md` | Yes | Detailed | Outdated `bun` commands |
| `LICENSE` | Yes | Valid MIT | None |
| `CODE_OF_CONDUCT.md` | Yes | Standard | None |
| `CHANGELOG.md` | Yes | Minimal | Only v0.1.0; missing v0.2-0.5 |
| `SECURITY.md` | Yes | Good | No public privacy policy URL |
| `.github/workflows/` | Yes | 3 workflows | Excellent (build, lint, test) |
| `.github/` templates | Yes | Bug + feature + PR | Excellent |
| `docs/` | Yes | 46 files, ~776 KB | Excellent |
| `.env.example` | Yes | 1 key only | Missing Groq/Cerebras keys |
| `.gitignore` | Yes | Thorough | Minor: committed trace files |

### 3.2 HIGH — Stale Package Manager References

The project migrated from Bun to npm on 2026-02-25, but user-facing documentation still references `bun`:
- `README.md` Quick Start section
- `CONTRIBUTING.md` Development Setup
- Potentially `Makefile` targets

**Fix:** Global find-replace `bun run` → `npm run`, `bun install` → `npm install`, `bun test` → `npm test` across all markdown files.

### 3.3 HIGH — Incomplete `.env.example`

Current `.env.example` documents only `OPENROUTER_API_KEY`. The extension supports three providers.

**Fix:** Expand to:
```bash
# Required — get a key at https://openrouter.ai/keys
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional — enables fastest LLM tier (Cerebras inference)
# Get a key at https://cloud.cerebras.ai/
CEREBRAS_API_KEY=your_cerebras_api_key_here

# Optional — enables Groq failover + Whisper voice input
# Get a key at https://console.groq.com/keys
GROQ_API_KEY=your_groq_api_key_here
```

### 3.4 MEDIUM — Empty Changelog

`CHANGELOG.md` only documents v0.1.0. The current version is 0.5.0.

**Fix:** Backfill entries for v0.2.0 through v0.5.0 from git history. Follow Keep a Changelog format.

### 3.5 MEDIUM — Missing `package.json` Metadata

Missing fields: `homepage`, `bugs`, `keywords`, `engines`.

**Fix:**
```json
{
  "homepage": "https://github.com/OpenSidebar/OpenSidebar",
  "bugs": "https://github.com/OpenSidebar/OpenSidebar/issues",
  "keywords": ["chrome-extension", "browser-agent", "ai", "automation", "llm"],
  "engines": { "node": ">=18" }
}
```

### 3.6 LOW — No Pre-Commit Hooks

No Husky/lint-staged setup. Contributors can push code with lint or formatting issues (caught in CI, but wastes CI cycles).

**Recommendation:** Add `husky` + `lint-staged` to enforce `eslint --fix` and `prettier --write` on staged files before commit.

---

## 4. Code Quality & CI/CD

### 4.1 TypeScript — Strict Mode Enabled

`tsconfig.json` has `strict: true`, enabling all sub-flags: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`. Path aliases (`@/*` → `./src/*`) are configured in both `tsconfig.json` and `vite.config.ts`.

### 4.2 Test Suite — 1,081 Tests, 74 Files, All Passing

| Category | Files | Coverage |
|---|---|---|
| Agent loop, orchestrator, context | 15+ | Comprehensive |
| LLM client, provider pool, streaming | 5+ | Comprehensive |
| Content script (tagging, snapshot, actions) | 9 | Comprehensive |
| Modal dismiss, overlay detection | 2 | Comprehensive |
| Memory (RRF, vector store) | 2 | Comprehensive |
| Side panel (store, bridge) | 4 | Good |
| Utils (logger, storage-logger) | 3 | Good |
| Evals pipeline | 2 | Good |

Missing: No end-to-end browser tests (expected for extension architecture), no visual regression tests.

### 4.3 CI/CD — Three Separate Workflows

- **`build.yml`**: Node 22, `npm ci`, `npm run build`, verify `dist/` exists
- **`lint.yml`**: `npm run lint` (ESLint on `src/`)
- **`test.yml`**: `npm test`, `evals:validate --offline`, optional `evals:regression` (gated behind API key)

### 4.4 LOW — 5 Lint Warnings (Unused Variables)

| File | Variable |
|---|---|
| `src/background/agent/loop.ts:24` | `waitForContentScriptReady` |
| `src/background/agent/trace.ts:227` | `turnNumber` |
| `src/background/perception.ts:453` | `lastError` |
| `src/sidepanel/App.tsx:22` | `isSlashCommand` |
| `src/sidepanel/store/chat-slice.ts:11` | `screenshotUrl` |

**Fix:** Prefix with `_` or remove. These are refactoring artifacts.

### 4.5 LOW — 4 npm Audit Vulnerabilities (Dev-Only)

| Package | Severity | Impact |
|---|---|---|
| `ajv` | Moderate | ReDoS with `$data` |
| `esbuild` | Moderate | Dev server request abuse |
| `minimatch` | High | ReDoS via wildcards |
| `rollup` | High | Path traversal file write |

All are transitive dev dependencies (build toolchain only). Zero runtime vulnerabilities.

**Fix:** `npm audit fix` resolves most; `esbuild` may require a Vite version bump.

### 4.6 LOW — ESLint Could Be Stricter

`@typescript-eslint/no-explicit-any` is disabled. While pragmatic for rapid development, enabling it as a warning would improve type safety for contributors.

---

## 5. Architecture & Feature Completeness

### 5.1 Codebase Health — Excellent

- **Zero TODO/FIXME/HACK/WIP comments** in `src/`
- **No half-implemented features** — all feature flags gate complete subsystems (teach mode, workspaces, memory, demos)
- **Error handling is thorough** — tri-provider failover, graceful degradation, structured logging
- **Performance is well-managed** — time-budgeted DOM scans, capped element counts, streaming LLM responses, dynamic context compression

### 5.2 MEDIUM — No First-Run Onboarding

New users see an empty chat with no guidance. There is no welcome screen, API key validation prompt, or feature tour. The settings drawer is discoverable but not surfaced proactively.

**Recommendation:** Add a conditional welcome banner when `openRouterApiKey` is empty, linking to setup instructions.

### 5.3 LOW — Chrome-Only, Not Documented

The extension uses Chrome-specific APIs (`chrome.sidePanel`, `chrome.tabGroups`, `chrome.offscreen`) with no cross-browser abstraction. This is fine architecturally but should be explicitly stated in the README.

---

## 6. Chrome Web Store Readiness

### 6.1 HIGH — No Public Privacy Policy

CWS requires a privacy policy URL for extensions requesting `<all_urls>`. `SECURITY.md` outlines data practices but is not published at a public URL.

**Fix:** Publish privacy policy to a public URL (GitHub Pages, project website, or a `/docs/privacy-policy.md` linked from the README) and reference it in the CWS submission.

### 6.2 MEDIUM — No Promotional Assets

The CWS listing requires:
- Detailed description (440 chars min)
- At least 1 screenshot (1280x800 or 640x400)
- Optional: promotional tile images (440x280 small, 920x680 large)

`docs/screenshots/` directory exists but is empty.

**Fix:** Capture screenshots of: side panel UI, agent running, settings drawer, trace viewer.

---

## 7. Pre-Release Cleanup Checklist

### Data Files to Remove or Gitignore

| Path | Size | Action |
|---|---|---|
| `traces/runs/*.jsonl` | ~29 MB | Remove committed files, keep `.gitignore` rule |
| `.env` | <1 KB | Remove from history (BFG/filter-repo) |
| `books/` | ~5 MB | Remove or document purpose |
| `logs/*.jsonl` | Variable | Already gitignored |

---

## 8. Prioritized Action Plan

### Phase 1 — Security (blocks release)

| # | Item | Effort | Risk if Skipped |
|---|---|---|---|
| 1 | Remove `__*_API_KEY__` build injection from `vite.config.ts` + all fallback chains | 2h | Keys leak in every distributed build |
| 2 | Rotate all three API keys | 15m | Account compromise |
| 3 | Scrub `.env` from git history | 30m | Keys visible in public repo history |
| 4 | Restrict log server CORS | 15m | Any website can read extension logs |

### Phase 2 — Legal & Documentation (blocks release)

| # | Item | Effort | Risk if Skipped |
|---|---|---|---|
| 5 | Create `ATTRIBUTIONS.md` (Inter font OFL, Lucide ISC) | 30m | License violation |
| 6 | Publish privacy policy at public URL | 1h | CWS rejection |
| 7 | Replace all `bun` references with `npm` in docs | 30m | Contributors can't set up project |
| 8 | Expand `.env.example` with all keys + signup URLs | 15m | Contributors blocked on setup |

### Phase 3 — Polish (recommended before release)

| # | Item | Effort | Risk if Skipped |
|---|---|---|---|
| 9 | Backfill `CHANGELOG.md` (v0.2-0.5) | 1h | Looks unmaintained |
| 10 | Fix 5 lint warnings | 15m | Noisy CI output |
| 11 | Run `npm audit fix` | 15m | Security badge fails |
| 12 | Add `homepage`, `bugs`, `keywords`, `engines` to `package.json` | 10m | Poor npm/GitHub discoverability |
| 13 | Capture CWS screenshots | 30m | Can't submit to store |
| 14 | Add first-run welcome banner | 1h | Poor first impression |
| 15 | Document permission justifications in README | 30m | Users distrust broad permissions |
| 16 | Clean committed trace files from `traces/runs/` | 15m | 29 MB of unnecessary data |
| 17 | Add Husky + lint-staged pre-commit hooks | 30m | Contributors push broken code |
| 18 | Add CodeQL security scanning to CI | 15m | No automated vulnerability detection |
| 19 | Document Chrome-only requirement in README | 5m | Confusion from Firefox/Edge users |

---

## Appendix A: Dependency License Summary

```
MIT           : 28 packages (react, zustand, immer, sql.js, vite, vitest, ...)
Apache-2.0    : 5 packages (transformers, readability, pdfjs, typescript, ...)
ISC           : 3 packages (lucide-react, idb, yaml)
MIT OR Apache : 1 package (voy-search)
OFL 1.1       : 1 embedded font (Inter — needs attribution)
GPL/AGPL/SSPL : 0 packages
```

## Appendix B: Permission Justification Matrix

| Permission | Used By | Justification |
|---|---|---|
| `sidePanel` | Core UI | Extension UI lives in Chrome side panel |
| `storage` | Settings, state | Persist user settings and agent state |
| `activeTab` | All tools | Execute actions on the current tab |
| `scripting` | Tool execution | Inject content scripts and execute tools |
| `tabs` | Navigation, workspaces | Read tab URLs, manage workspace tab groups |
| `tabGroups` | Workspaces | Map workspaces to Chrome tab groups |
| `webNavigation` | Navigation bridge | Resume agent after page navigation |
| `offscreen` | Memory system | Run ML embeddings + SQLite outside service worker |
| `alarms` | Keepalive | Prevent service worker termination during agent runs |
| `search` | `web_search` tool | Perform web searches via Chrome search API |
| `downloads` | `download_file` tool | Download files to user's machine |
| `cookies` | `read_cookies` tool | Read cookies for context |
| `history` | `search_history` tool | Search browser history |
| `bookmarks` | `search_bookmarks` tool | Search and create bookmarks |
| `notifications` | `send_notification` tool | Send desktop notifications |
| `<all_urls>` | Content script | Must run on any site the user visits |

## Appendix C: Test Coverage Map

```
src/background/agent/       → tests/background/agent.test.ts, loop-api.test.ts,
                               loop-overlay.test.ts, step-labels.test.ts,
                               navigate-guard.test.ts, stagnation.test.ts
src/background/llm/         → tests/background/provider-pool.test.ts,
                               streaming.test.ts
src/background/orchestrator/ → tests/background/orchestrator-*.test.ts
src/background/perception   → tests/background/perception.test.ts
src/background/tools/       → tests/background/batch-execute.test.ts
src/background/security     → tests/background/security.test.ts
src/content/                → tests/content/tagging.test.ts, snapshot.test.ts,
                               actions.test.ts, modal-dismiss.test.ts,
                               overlay-detection.test.ts, shadow-dom-*.test.ts,
                               framework-detect.test.ts, recorder.test.ts
src/offscreen/memory/       → tests/memory/rrf.test.ts, storage.test.ts
src/sidepanel/              → tests/sidepanel/store.test.ts, bridge.test.ts
src/utils/                  → tests/utils/logger.test.ts, storage-logger.test.ts
evals/                      → tests/evals/contract.test.ts, extractor.test.ts
```
