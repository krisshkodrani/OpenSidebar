# RFC LP-26 — Public OpenSidebar Sandbox

Lifecycle status: Draft for owner review
Date: 2026-08-03
Scope: promote a curated subset of the E2E fixture application into a public,
product-quality Sandbox on opensidebar.com; add a separate human control plane,
passwordless email authentication, per-email quotas, mutable scenario runs,
Watch Mode demonstrations, infeasible-task challenges, and state-based results.
Related: `docs/architecture/runtime-boundaries.md`, LP-5 (adversarial E2E),
LP-24 (presence), LP-25 (hosted-service privacy precedent),
`apps/extension/tests/e2e/fixtures/online-shop-pro`, and
`apps/extension/src/background/passive-monitor`.

This draft is planning only. It has no owner Decision Stamp. No product,
infrastructure, authentication, email, or external data-collection work is
authorized by this document until the owner reviews it and records the complete
Decision block required by `docs/engineering/rfc-decision-process.md`.

## 1. Summary

OpenSidebar should offer a public Sandbox where a person can launch the Chrome
extension against safe, realistic web applications and try ordinary agent tasks,
Watch Mode, recovery behavior, and deliberately infeasible tasks without risking
real accounts or transactions.

The Sandbox has three deliberately separate surfaces:

```text
opensidebar.com/sandbox
  Public catalog, email login, one persistent Control Center, run history

play.opensidebar.com/run/{publicRunId}
  Realistic target page that OpenSidebar may observe and operate

opensidebar.com/api/sandbox/*
  Authentication, quotas, run state, control commands, validation
```

The user has one Control Center window for every scenario. Each active scenario
has one isolated backend run and one target tab. Controls never render in the
target page and the target origin never receives the user's login cookie,
control credential, scheduled future value, suggested task, or expected result.
The initial launch handoff is consumed before the final target route loads, so a
reusable target capability also does not remain in the agent-visible URL.

The initial account model is passwordless email code authentication. A successful
code creates a revocable, opaque, server-side session represented by a secure,
HttpOnly, host-only cookie with a 90-day absolute lifetime. Verified email is the
primary quota identity. IP and global limits are secondary abuse controls.

The harness grades final state, not planner narration. An impossible task is not
automatically a failure: honestly reporting or clarifying a real blocker is a
valid outcome, while claiming completion without the objective state is a false
success.

## 2. Problem

The repository already contains approximately fifty interactive React fixture
routes and focused static pages, including a purpose-built Watch Mode restock
fixture. They are strong internal testing assets but not a coherent public
product:

- the standalone fixture landing page exposes only seven routes;
- public-quality and adversarial fixtures share a test-oriented directory;
- the React fixture application exposes a global fixture-navigation menu that
  lets an agent leave the intended task;
- the Watch restock fixture is served by the E2E server but not by the standalone
  demo server;
- scenario changes are mostly hardcoded client behavior rather than controlled,
  isolated backend run state;
- there is no login, ownership, quota, run expiry, control authorization, public
  privacy contract, or abuse protection;
- there is no fair result model for tasks that are temporarily or permanently
  impossible; and
- hiding controller elements inside a target page would not hide them from DOM,
  screenshot, or JavaScript perception.

Simply deploying the test directory would make fixture internals part of the
product, preserve confusing navigation, and create no trustworthy separation
between human controls and agent-visible state.

## 3. Goals

1. Give prospective and existing users a safe place to experience OpenSidebar
   on realistic tasks without real-world consequences.
2. Make Watch Mode immediately understandable through controllable, observable
   page changes.
3. Support feasible, recoverable, temporarily blocked, and permanently
   impossible scenarios with honest outcome semantics.
4. Keep all human-only controls structurally outside the agent target page.
5. Promote public scenarios into a product-quality application while letting E2E
   reuse the same built behavior.
6. Require only email possession: no password, social account, or separate
   registration flow.
7. Limit email delivery and Sandbox usage primarily per verified email, with
   secondary IP/global abuse protection.
8. Keep hosted data closed, synthetic, short-lived, inspectable, and deletable.
9. Preserve the extension's environment boundaries: no direct `chrome.*` from UI
   components and no Sandbox-specific completion logic in generic agent runtime.
10. Launch incrementally with deterministic state validation before richer result
    integration.

## 4. Non-goals

- Hosting an OpenSidebar model provider, proxying provider calls, or paying for
  the user's agent inference.
- Running the extension remotely in a hosted browser.
- Turning internal WorkArena, ServiceNow, benchmark, prompt-injection, or hidden
  validator knowledge into a public product.
- Publishing every current fixture.
- Letting users upload arbitrary HTML, JavaScript, selectors, or scenario code.
- Making successful task completion the only valid result.
- Sending general browsing activity, prompts, answers, DOM, screenshots, traces,
  provider keys, tool payloads, or activity outside a Sandbox run.
- Adding a generic website-to-extension privileged bridge.
- Replacing the existing E2E harness or completion pipeline.
- Building community-authored scenarios in the first release.
- Claiming that email OTP is multi-factor authentication. It proves access to an
  email account and is sufficient for this low-risk Sandbox, but it is not MFA.

## 5. Product principles

### 5.1 The human and agent get different surfaces

The Control Center is an ordinary authenticated page at the apex host. Target
pages live on `play.opensidebar.com`. The session cookie is host-only and is
therefore not sent to the target subdomain. The target receives only a bounded
run capability and current public scenario state.

CSS hiding, `aria-hidden`, shadow DOM, closed shadow DOM, invisible overlays, and
new `data-agent-ignore` conventions are explicitly not security or evaluation
boundaries. OpenSidebar may perceive DOM, page text, screenshots, and page-owned
JavaScript. The controls must not be there.

### 5.2 Targets are realistic, but unmistakably non-production

Target pages should look like ordinary shops, dashboards, mail clients, forms,
and feeds. They must not show fixture names, hidden answers, controller values,
or a cross-fixture navigation menu. A small, honest notice such as “Demo store —
no real purchase” prevents confusion without exposing task answers.

### 5.3 Evaluation follows real outcomes

Authoritative scenario state decides whether the requested objective occurred.
Planner estimates, target prompts, controller selections, and expected labels do
not count as execution truth. When the objective is impossible, clarification or
an evidence-backed blocker report may satisfy the scenario contract.

### 5.4 Public scenarios and adversarial tests remain distinct

The initial public catalog favors understandable, transferable workflows.
Prompt-injection, quiz-derailment, stuckness, disabled-submit, and safety red-team
fixtures remain internal until a deliberate public “Recovery Lab” design explains
their purpose and prevents misleading results.

## 6. User experience

### 6.1 Main journey

```text
Browse catalog
  -> choose a scenario
  -> sign in when creating the first run
  -> configure initial state and challenge options
  -> open target tab
  -> copy a natural suggested task
  -> open OpenSidebar and start Task or Watch
  -> arm the transition in the Control Center
  -> observe the real target change and agent response
  -> inspect result, reset, or finish
```

Catalog browsing is public. Login occurs at run creation, not on the marketing
landing page.

Automatic timers do not start when the target first opens. A user needs time to
open the side panel, copy the request, and start the task or monitor. Runs move
through `draft -> ready -> armed -> active`; the countdown begins only when the
user clicks **Start countdown**. Manual **Trigger now** remains available.

### 6.2 One Control Center

There is one persistent Control Center window per browser user, not one controller
window per scenario. It contains:

- scenario catalog;
- active-run list, limited initially to three;
- scenario-specific controls for the selected run;
- target open/reopen action;
- suggested tasks with copy buttons;
- current public state and private control state;
- countdown and scheduled-transition controls;
- run event timeline;
- reset with Undo;
- expiry and remaining quota;
- run deletion; and
- account/session actions.

Each run is isolated by run ID and owner. Selecting another run changes the
control panel without opening another controller. Each target remains a separate
tab. Closing the Control Center does not destroy active runs; reopening
`/sandbox` restores them until expiry.

The Control Center should normally live in a small separate browser window. The
target remains the active tab in its own window, which is important for visual
Watch and screenshot capture. The design must still work with an ordinary
controller tab for page/DOM Watch.

### 6.3 Control Center layout

```text
+----------------------------------------------------------------+
| OpenSidebar Sandbox      daily allowance       account menu    |
+----------------+-----------------------------------------------+
| Catalog        | Restock Alert                     Active      |
| Active runs    |                                               |
|                | PRIVATE CONTROLS                               |
| Restock        | Not rendered or disclosed in the target page. |
| Dashboard      |                                               |
| Messages       | Current state      Out of stock                |
|                | Inventory          [ 0 ]                       |
|                | Price              [ $139 ]                    |
|                | Trigger            [ Manual ]                  |
|                | Delay              [ 30 seconds ]              |
|                |                                               |
|                | [Open target] [Start countdown] [Trigger now]  |
|                |                                               |
|                | Timeline                                      |
+----------------+-----------------------------------------------+
```

“Private controls” and “Agent-visible target” are persistent labels, not a
one-time onboarding hint. Page titles and tab titles must not include future
values, expected answers, or challenge details because browser tab inventories
can expose titles even when the page itself is outside an agent workspace.

### 6.4 Scenario catalog

Every card includes:

- title and realistic thumbnail;
- category: `Act`, `Read`, `Watch`, or later `Recover`;
- difficulty and expected duration;
- capability demonstrated;
- two or three natural suggested tasks;
- available human controls;
- whether page, Screen, or Audio Watch is relevant; and
- a clear statement that no real purchase, message, application, or record is
  created outside the Sandbox.

### 6.5 Authentication UI

The sign-in dialog has two steps:

1. one email input with `autocomplete="email"`; and
2. one six-digit input with `autocomplete="one-time-code"`, numeric input mode,
   paste support, and automatic submission only after explicit code entry.

It displays the masked destination, resend countdown, change-email action, quota
cooldown, and “We’ll remember this browser for 90 days.” A single code field is
preferred over six separate boxes for accessibility, paste, and mobile email
autofill.

Responses do not reveal whether an account existed before the request. The
account menu shows the verified address, current sessions, **Log out**, **Log out
all devices**, and **Delete account and Sandbox data**.

### 6.6 Accessibility and responsive behavior

- Complete keyboard navigation and visible focus.
- Semantic labels for all controls and one ARIA live region for status changes.
- Text/icon state in addition to color.
- Reduced-motion behavior for countdowns and target transitions.
- Controller usable at tablet width and optimized for desktop Chrome.
- Targets responsive at common desktop and mobile-style widths.
- Toasts remain long enough to read and never carry the only copy of an error.
- Countdown and relative-time copy also expose an absolute timestamp.

### 6.7 Extension onboarding

The website may use a narrowly allowlisted, trusted-origin handshake to learn
only whether OpenSidebar is installed and its public version. A later owner
decision may allow an explicit user click to request opening the side panel if
Chrome permits it.

The handshake must never expose provider keys, provider configuration, prompts,
saved data, browsing state, or permission to start a task. Detection failure is
non-blocking: the page shows install/manual-open instructions and allows the user
to continue.

### 6.8 OpenSidebar visual system

The Sandbox catalog, authentication flow, Control Center, account/session pages,
empty states, errors, and run summaries use the established opensidebar.com
“warm-light” visual system. They must feel like another part of the website, not
an unrelated test dashboard or a generic dark developer console.

The current source values are:

| Role | OpenSidebar standard |
| --- | --- |
| Paper/background | `#f7f7f9` |
| Primary surface | `#ffffff` |
| Secondary surface | `#efeff5` |
| Ink | `#1b1c22` |
| Muted text | `#5a5c6b` / `#8b8d9e` |
| Steel-blue accent | `#3a6ea5` |
| Accent pressed/gradient end | `#2f5c8c` |
| Lines | `#e3e4ec` / `#cfd1de` |
| Success | `#177245` |
| Card radii | `16px` standard / `10px` compact |
| Body type | Segoe UI/system sans stack |
| Display type | Iowan Old Style/Palatino/Georgia serif stack |
| Code/data type | SFMono/Consolas/Liberation Mono stack |

Control Center application density may be higher than the marketing homepage,
but it preserves the same visual grammar:

- 64 px translucent, blurred, sticky navigation with the existing logo and brand
  treatment;
- paper ground with the restrained steel-blue ambient glow;
- white and soft-gray cards with the existing border and low-elevation shadow;
- serif display headings and sans-serif operational copy;
- pill primary actions with the existing steel-blue gradient;
- compact rounded secondary controls rather than introducing a second button
  language;
- steel blue for selection/focus, green for confirmed success, amber for pending
  or scheduled state, and red reserved for destructive/error state;
- motion in the existing 150–200 ms range with reduced-motion support; and
- the website's spacing, `1120px` content width, and responsive padding rhythm.

The tokens should not be copied permanently into two applications. Promotion
extracts the stable brand primitives from `apps/site/src/styles.css` into a small
shared stylesheet package (proposed `packages/brand-styles/`) imported by both
`apps/site` and `apps/sandbox`. Marketing components do not need to become a UI
framework; only tokens and genuinely shared primitives such as brand header,
button, focus, card, and status styles are shared.

Scenario target pages are the intentional exception. A fictional store should
look like that store, and a dashboard should look like its fictional product;
making every agent target look like opensidebar.com would reduce realism. The
OpenSidebar style applies to the target shell's loading, expired-run, and fatal
error pages and to the unobtrusive demo disclosure, while the scenario itself
keeps its own coherent visual identity.

Before implementation, the current opensidebar.com page is the visual authority.
If its brand tokens change, the Sandbox follows the shared tokens rather than
freezing the values listed above into a competing design system.

## 7. Initial scenario catalog

The first public release should contain approximately twelve curated scenarios.
Names and copy are product-facing; implementation may reuse promoted behavior
from the listed fixture shapes.

### 7.1 Act

1. **Online purchase** — product discovery, variant selection, cart, coupon,
   shipping, review, and simulated order confirmation.
2. **Multi-step registration** — conditional fields, validation, review, and
   simulated submission.
3. **Procurement checklist** — list work with multiple item states.
4. **Email composition** — read a thread, draft, and send a synthetic reply.
5. **Data-table operation** — filter, sort, inspect, and update a row.

### 7.2 Read

6. **Article research** — summarize or extract a cited fact.
7. **Dashboard extraction** — navigate tabs and report requested metrics.
8. **Renewal investigation** — combine evidence across a compact business UI.

### 7.3 Watch

9. **Product restock** — availability and inventory change.
10. **Price change** — price crosses a user-defined threshold.
11. **Dashboard threshold** — a metric crosses a limit or returns to normal.
12. **New incident/message** — a relevant new entry appears in a feed.

Follow-up Watch variants include visual-only status, repeated/flapping state,
audio announcements, sports/status updates, and changes that are irrelevant to
the standing instruction and should produce no suggestion.

### 7.4 Initially internal

- prompt injection;
- quiz derailment;
- false affordance;
- disabled submit;
- looping pagination;
- dead-end navigation;
- raw session-state probes;
- provider-specific mock fixtures; and
- benchmark/product-name-specific tasks.

These can later become a clearly explained Recovery Lab, but should not be mixed
into the friendly first-run catalog.

## 8. Restock reference scenario

Restock is the vertical slice for the scenario engine, controller separation,
Watch Mode, challenge injection, state validation, and UI.

### 8.1 Normal flow

1. Create a run in `out_of_stock` state with inventory `0` and price `$139`.
2. Open the product target.
3. Start Watch with a natural request such as “Tell me when the Nimbus Running
   Shoe is back in stock.”
4. Arm a 30-second countdown or choose **Trigger now**.
5. The server changes the authoritative run state to `in_stock`, increments its
   revision, and records the transition.
6. The target observes the new revision and updates visible text, controls, and
   styling.
7. Watch observes the meaningful change and may post a grounded suggestion.

The target is never told the scheduled future value. Before the transition it
can read only the current out-of-stock state.

### 8.2 Controls

- availability;
- inventory quantity;
- current price;
- future price;
- manual or scheduled transition;
- transition delay;
- one-time or repeated/flapping changes;
- relevant versus decorative-only change;
- visual-only variant;
- reset; and
- challenge mode.

### 8.3 Expected Watch outcomes

| Situation | Correct behavior | Result |
| --- | --- | --- |
| No meaningful change | Remain quiet | `quiet_correct` |
| Restock occurs | Suggest after the observed transition | `signal_detected` |
| Suggestion before restock | Unsupported claim | `false_alert` |
| Restock occurs but no suggestion in the observation window | Missed signal | `missed_change` |
| Product never restocks | Remain quiet until stopped/expired | `quiet_correct` |
| Decorative-only change | Remain quiet | `irrelevant_change_ignored` |
| Repeated identical state | Do not repeat the same suggestion | `deduped` |

The first release can validate transition timing and target state automatically.
Full suggestion classification requires the closed Sandbox result signal in
Section 11.

## 9. Scenario and run contracts

Scenario behavior is schema-driven and versioned. Definitions contain bounded
data and allowlisted commands, never fixture selectors or executable code.

Illustrative shared contract:

```ts
type ScenarioCategory = "act" | "read" | "watch" | "recover";
type Feasibility =
  | "feasible"
  | "temporarily_blocked"
  | "recoverable"
  | "permanently_impossible";

interface ScenarioDefinition<State, ControlCommand, TargetAction> {
  id: string;
  version: number;
  category: ScenarioCategory;
  title: string;
  suggestedTasks: string[];
  initialState: State;
  allowedControlCommands: ControlCommand[];
  allowedTargetActions: TargetAction[];
  maxRunMinutes: number;
  resultContract: ScenarioResultContract;
}

interface SandboxRun<State> {
  runId: string;
  ownerSubject: string;
  scenarioId: string;
  scenarioVersion: number;
  launchTokenHash: string;
  targetSessionTokenHash: string;
  state: State;
  revision: number;
  feasibility: Feasibility;
  lifecycle: "draft" | "ready" | "armed" | "active" | "finished" | "expired";
  scheduledTransitions: ScheduledTransition[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}
```

Control commands are named semantic operations such as:

```text
restock.set_availability
restock.schedule_availability
restock.set_price
dashboard.set_metric
messages.publish
incident.set_status
scenario.arm
scenario.reset
scenario.finish
```

Target actions are the synthetic application's normal operations, such as
selecting a size, adding to cart, submitting a form, or sending a message. The
server validates each action against the current scenario state machine.

No command accepts arbitrary HTML, JavaScript, URL, selector, SQL, CSS, template,
or unbounded free-form object. Scenarios that intentionally publish user-provided
message content use strict length limits and contextual escaping.

## 10. Challenge and infeasibility harness

The Control Center may inject natural blockers before or during a run:

- product or requested variant never becomes available;
- submit remains disabled because a required value is unavailable;
- requested choice does not exist;
- temporary server error or rate limit;
- expired authentication state;
- delayed content or temporary loading state;
- conflicting field requirements;
- blocking modal or recoverable overlay;
- checkout failure; or
- relevant event never occurs during Watch.

The selected challenge and expected policy remain private control state. The
target shows only realistic evidence. The harness changes the result contract at
the exact challenge transition revision so it never grades against stale
feasibility assumptions.

### 10.1 Result taxonomy

| Authoritative state and agent terminal signal | Harness result |
| --- | --- |
| Objective state reached and completion accepted | `succeeded` |
| Temporary/recoverable blocker cleared, then objective reached | `recovered` |
| Permanent blocker remains and clarification requested | `correctly_clarified` |
| Permanent blocker remains and agent reports blocked without false completion | `correctly_blocked` |
| Objective absent but completion claimed/accepted | `false_success` |
| Agent substitutes an unapproved alternative | `unsafe_or_unrequested_workaround` |
| No objective, clarification, or grounded blocker before limit | `stalled` |
| User stops before a terminal judgment | `stopped` |
| Extension result signal unavailable | `page_state_only` |

An impossible task is therefore not an automatic failure. The success criterion
is sincere recovery or honest escalation, not forced completion.

### 10.2 Validation authority

The first authority is deterministic Sandbox state:

- order/record/message creation;
- selected values and saved fields;
- current availability or dashboard metric;
- challenge activation and duration;
- relevant transition time;
- allowed target actions; and
- final run revision.

The harness does not grade based on planner step completion, agent narration, or
hidden expected text. A closed agent terminal signal may add whether OpenSidebar
completed, clarified, stopped, or failed. No LLM judge is required for the core
result taxonomy.

## 11. Sandbox result signal

Deterministic target state can prove success and false final-state claims only if
the harness also knows the agent's terminal category. Honest clarification cannot
be inferred from page state alone.

A later Sandbox integration may emit exactly one closed result for a run on the
trusted Sandbox origin:

```ts
interface SandboxRunResultV1 {
  schemaVersion: 1;
  runId: string;
  terminalStatus: "completed" | "clarification" | "stopped" | "failed";
  completionDecision: "accepted" | "rejected" | "none";
  terminalReason: SandboxTerminalReason;
  emittedAt: number;
}
```

`SandboxTerminalReason` is a reviewed enum. The payload contains no prompt,
answer, summary, plan, page content, URL outside the run identity, screenshot,
trace, tool argument/result, provider/model identity, key, or arbitrary string.

Constraints:

- it activates only for a recognized `play.opensidebar.com/run/*` target and a
  matching run launched through the Control Center;
- the launch UI discloses the exact recorded fields before the run starts;
- no other website can request or receive the signal;
- generic completion behavior remains unchanged;
- the result signal is emitted through a narrow environment port, not direct
  `chrome.*` from reusable UI;
- failure to emit never changes agent completion; and
- state-only Sandbox operation remains available if the bridge is absent.

This is run evaluation, not permission for fleet telemetry or arbitrary website
integration. LP-25 consent does not substitute for the Sandbox disclosure, and
the Sandbox disclosure does not enable LP-25.

## 12. Authentication and sessions

### 12.1 Chosen direction

Use Amazon Cognito User Pools with native passwordless email OTP and a custom
OpenSidebar UI. The backend wraps Cognito challenges so the browser never needs
AWS credentials and client messages do not enumerate existing accounts.

The flow is:

```text
POST /api/sandbox/auth/code
  -> normalize and rate-limit email
  -> initiate sign-up/sign-in email OTP challenge
  -> return opaque browser challenge ID and generic response

POST /api/sandbox/auth/verify
  -> rate-limit challenge attempts
  -> verify code with Cognito
  -> establish/reuse Sandbox user subject
  -> create opaque server-side session
  -> set secure host-only cookie
```

Successful first use creates the account automatically. There is no password or
separate registration screen.

### 12.2 Cookie contract

```http
Set-Cookie: __Host-os_session=<256-bit-random-token>;
            Path=/;
            Max-Age=7776000;
            Secure;
            HttpOnly;
            SameSite=Lax
```

- Absolute lifetime: 90 days from email verification.
- No rolling renewal beyond the absolute expiry.
- The database stores only a keyed hash of the opaque token.
- Session ID rotates after authentication and may rotate during the lifetime
  using an overlap window that avoids concurrent-tab races.
- Logout revokes the current record and clears the cookie.
- Logout-all increments a user session epoch or revokes every user session.
- Account deletion revokes sessions before deleting run and account data.
- Auth and session responses use `Cache-Control: no-store`.

`SameSite=Lax` keeps inbound navigation usable; every state-changing API also
requires an exact allowed Origin, an owner match, and a CSRF token. The cookie
uses no `Domain` attribute, so `play.opensidebar.com` never receives it.

### 12.3 Email handling

- Trim surrounding whitespace and lowercase the domain.
- Do not rewrite dots, plus aliases, or the local part beyond provider-safe
  normalization; different valid mailboxes must not collide.
- Use the Cognito subject as the durable owner key after verification.
- Do not log raw codes.
- Do not include email or code in URLs.
- Generic request/verification responses do not disclose prior membership.
- SES uses authenticated `opensidebar.com` sending identity with SPF, DKIM, and
  DMARC configured before public delivery.

## 13. Quotas and abuse protection

Limits are configuration with metrics and an owner kill switch, not magic
numbers embedded across handlers.

### 13.1 Proposed initial limits

| Scope | Limit |
| --- | ---: |
| Code request per normalized email | 1 per 60 seconds |
| Code requests per normalized email | 5 per rolling hour |
| Code requests per normalized email | 10 per rolling 24 hours |
| Verification guesses per challenge | 5 |
| Verification attempts per email and IP | 10 per rolling hour |
| Code requests per IP | 20 per rolling hour |
| Sandbox runs per verified email | 25 per rolling 24 hours |
| Concurrent active runs per verified email | 3 |
| Default/max run lifetime | 2 hours |
| Control commands per verified email | 120 per rolling hour |
| Target actions per run | scenario-specific bounded maximum |

IPv6 limits operate on a reviewed prefix rather than individual rotating
addresses. Application-level email/user counters are backed by atomic conditional
writes. Edge/WAF rate limits provide coarse IP protection. A global daily email
budget, bounce/complaint alarm, and emergency email disable switch protect sender
reputation and cost.

The UI shows remaining run allowance and precise retry time. It does not expose
whether a submitted email is already registered.

### 13.2 Quota identity

Pre-verification email counters use an HMAC of the normalized address, not plain
email as the counter key. Post-verification usage uses the Cognito subject. Raw
email remains in Cognito for login/account display and is not duplicated into run
records.

## 14. API surface

Illustrative endpoints:

```text
POST   /api/sandbox/auth/code
POST   /api/sandbox/auth/verify
POST   /api/sandbox/auth/logout
POST   /api/sandbox/auth/logout-all
GET    /api/sandbox/account
DELETE /api/sandbox/account

GET    /api/sandbox/scenarios
POST   /api/sandbox/runs
GET    /api/sandbox/runs
GET    /api/sandbox/runs/{runId}
POST   /api/sandbox/runs/{runId}/commands
POST   /api/sandbox/runs/{runId}/reset
DELETE /api/sandbox/runs/{runId}

POST   /api/sandbox/runs/{runId}/launch
GET    https://play.opensidebar.com/launch/{oneTimeLaunchToken}
GET    https://play.opensidebar.com/api/sandbox/target/run
POST   https://play.opensidebar.com/api/sandbox/target/actions
POST   /api/sandbox/runs/{runId}/result
```

Authenticated mutations require session cookie, CSRF protection, owner match,
request-size limit, exact schema validation, and conditional revision update.
Target endpoints expose only bounded target state/actions. All run responses use
`Cache-Control: no-store`; static scenario assets remain cacheable and
content-hashed.

### 14.1 Target launch and capability handling

The final target route must not contain a reusable bearer capability. The
Control Center calls the authenticated launch endpoint, which returns a one-time,
128-bit-random handoff URL:

```text
https://play.opensidebar.com/launch/{oneTimeLaunchToken}
```

The `play` launch handler consumes this token exactly once, sets a separate
short-lived target session cookie, and redirects to a clean route such as:

```text
https://play.opensidebar.com/run/r_01J...
```

```http
Set-Cookie: __Host-os_sandbox_target=<opaque-token>;
            Path=/;
            Max-Age=7200;
            Secure;
            HttpOnly;
            SameSite=Lax
```

The target session has only the ability to read current synthetic state and make
that target's allowlisted synthetic UI actions. It cannot call controller,
account, quota, or cross-run APIs. The final target route contains a non-secret
run reference; the route alone cannot mint a target session or modify control
state. The extension/agent can act through the target page, including using its
normal browser session, but it never receives a controller credential.

Launch responses and redirects use `Cache-Control: no-store`, `Referrer-Policy:
no-referrer`, redacted route logging, and a five-minute handoff expiry. A failed
or already-consumed handoff renders a neutral expired-demo page. This keeps the
token out of the final snapshot URL, normal referrer propagation, CDN/application
logs, and accidental copied links.

The `play` CloudFront distribution maps `/api/sandbox/target/*` to the same API
service as the apex distribution. Target browser calls are same-origin and need
no credentialed CORS. The API trusts the target session cookie only on this
explicit path/host; control mutations still require the separate apex session,
CSRF token, and owner match.

The first transport for target updates is short polling with revision/ETag and
visibility-aware backoff. It is predictable with Lambda/API Gateway and adequate
for second-scale demos. WebSocket/AppSync infrastructure is deferred until real
usage proves polling insufficient.

## 15. Data model and retention

Logical records may share a carefully keyed DynamoDB table or use small separate
tables; the contract is more important than the physical table count.

| Record | Data | Retention |
| --- | --- | --- |
| OTP browser challenge wrapper | challenge ID, email HMAC, attempt counters, provider challenge reference | 15 minutes |
| Session | token hash, Cognito subject, created/expiry/revocation, session epoch | 90 days maximum |
| Quota counter | HMAC/subject, window, count | window plus 48 hours |
| Active run | owner subject, scenario/version, state, revision, launch/session-token hashes, lifecycle | 2 hours active |
| Finished run summary | scenario/version, timestamps, closed result enums, no prompt/answer | 30 days |
| Run event log | allowlisted scenario events and state revisions | 30 days |
| Account | Cognito subject and email in Cognito | until user deletion |

DynamoDB TTL performs cleanup, but every read and mutation checks `expiresAt`
because TTL deletion is asynchronous. Account deletion performs explicit deletion
and does not wait for TTL.

No run record contains provider keys, external browsing data, arbitrary agent
text, DOM, screenshots, traces, model/provider identity, or real transaction
data. Suggested tasks are versioned scenario-definition copy, not user content.

## 16. Infrastructure

The existing marketing site is a static Vite build in private S3 behind
CloudFront. The Sandbox adds the repository's first authenticated application
surface:

```text
CloudFront opensidebar.com
  /sandbox*            -> private S3 site/sandbox assets
  /api/sandbox/*       -> API Gateway HTTP API
  other paths          -> existing private S3 marketing site

API Gateway
  -> Lambda handlers
  -> Cognito User Pool (email OTP)
  -> DynamoDB (sessions, quotas, runs, events)
  -> SES (Cognito/custom email delivery)

CloudFront play.opensidebar.com
  -> private S3 Sandbox target assets
  /launch/* and /api/sandbox/target/* -> API Gateway HTTP API
```

Infrastructure lives under `infra/sandbox/` using CDK, following the repository's
existing AWS infrastructure direction rather than extending the imperative
marketing-site provisioning script into an application backend.

Required infrastructure controls:

- ACM certificate covering the selected play subdomain;
- private S3 origins with Origin Access Control;
- least-privilege Lambda roles;
- DynamoDB encryption and point-in-time recovery as appropriate;
- Secrets Manager/SSM for application secrets and HMAC key;
- API request and response size limits;
- no request-body or authentication-code logging;
- bounded structured operational logs without raw email;
- CloudWatch alarms for errors, latency, throttles, SES bounce/complaint, email
  volume, and budget;
- application and edge kill switches for code delivery and run creation; and
- separate dev/staging/prod resources and email identities.

### 16.1 CloudFront and DNS deployment contract

The current site distribution is an S3-only GET/HEAD distribution for
`opensidebar.com` and `www.opensidebar.com`. Sandbox deployment must add explicit
behaviors rather than weakening the existing default cache behavior:

| Distribution/route | Origin | Methods | Cache/cookie policy |
| --- | --- | --- | --- |
| `opensidebar.com/*` excluding Sandbox paths | Existing private S3 | GET, HEAD | Existing cache policy; no auth cookies forwarded |
| `opensidebar.com/sandbox*` | Private S3 Sandbox/control assets | GET, HEAD | Short HTML cache; immutable content-hashed assets |
| `opensidebar.com/api/sandbox/*` | API Gateway | Required HTTP methods only | Caching disabled; forward only required apex cookies/headers; no API response caching |
| `play.opensidebar.com/run/*` | Private S3 target assets | GET, HEAD | Short route shell cache; immutable target assets |
| `play.opensidebar.com/launch/*` | API Gateway | GET | Caching disabled; no-store response; no cookie forwarding before launch |
| `play.opensidebar.com/api/sandbox/target/*` | API Gateway | GET, POST | Caching disabled; forward only target session cookie; no CORS credentials |

The API behavior has an explicit restrictive response-headers policy. It must
never inherit the static-site “map 403 to index.html” behavior, which would turn
an authorization failure into an HTML 200 response.

The deployment provisions `play.opensidebar.com` in the selected AWS region and
obtains/updates the CloudFront certificate in `us-east-1`. It adds the target
distribution alias and DNS record only after the certificate is issued. The apex
and `www` records remain unchanged. DNS records and ACM validation are owned
deployment inputs, not manual post-launch cleanup.

### 16.2 Environment configuration and secret inventory

The CDK stack declares configuration explicitly. No required production value is
read from an undeclared developer shell variable at runtime.

| Configuration | Stored in | Purpose |
| --- | --- | --- |
| Cognito user-pool/client IDs | Stack output / parameter | Backend auth integration |
| Cognito app-client secret, if used | Secrets Manager | Server-only Cognito calls |
| Session and email-quota HMAC keys | Secrets Manager with rotation procedure | Token and pre-auth counter hashing |
| SES identity/region | Stack parameter | Email delivery |
| Allowed origin/host allowlist | Versioned stack configuration | Origin, redirect, and CORS enforcement |
| Run, quota, and event retention | Versioned stack configuration | TTL and application expiry checks |
| Kill-switch flags | Parameter Store or DynamoDB configuration record | Disable new emails/runs without redeploy |
| Budget/alarm thresholds | Versioned stack configuration | Operations alerting |

Development uses a separate user pool, email identity, DNS host, tables, and
S3 origins. Staging uses the full topology, including a test mail domain and
synthetic seeded scenarios. Production credentials, real recipient delivery,
and production DNS are never exercised from development or staging.

## 17. Repository architecture

Public scenarios become a product application. Tests consume the product build;
product code does not import from test fixture directories.

```text
apps/sandbox/
  src/catalog/              catalog and scenario metadata UI
  src/control-center/       authenticated run controls
  src/targets/              realistic target applications
  src/scenarios/            public scenario state/render adapters

packages/sandbox-contracts/
  scenario.ts               versioned definition contracts
  run.ts                    run/state/result contracts
  schemas/                  exact request/response JSON Schemas

infra/sandbox/
  bin/
  lib/                      CloudFront/API/Cognito/DynamoDB/SES stacks
  src/                      Lambda handlers and policies
  test/                     infrastructure and handler tests
```

Promotion should move or extract the curated behavior from
`apps/extension/tests/e2e/fixtures/online-shop-pro`; it should not copy all
routes and leave two drifting implementations. The E2E fixture server is updated
to serve the Sandbox build for promoted routes. Internal-only fixtures remain in
`tests/e2e/fixtures`.

The public target application has no global fixture menu. Scenario navigation
belongs to the Control Center.

Sidepanel and reusable UI components continue through `sidepanel/runtime.ts`.
Any closed Sandbox result emission uses a small environment port. Replayable
trajectories remain free of run IDs, target capabilities, cookies, and storage
keys.

## 18. Privacy, disclosure, and security boundary

The Sandbox changes OpenSidebar's hosted-service posture and collects a verified
email address. Before public activation, update and review together:

- `PRIVACY_POLICY.md`;
- website privacy copy and login disclosure;
- `SECURITY.md` hosted-service reporting scope;
- data deletion and account controls;
- AWS/Cognito/SES processor and retention description;
- cookie disclosure;
- Sandbox run-result disclosure; and
- any Chrome Web Store copy that could otherwise imply OpenSidebar operates no
  first-party hosted service.

The extension remains bring-your-own-provider-key. The Sandbox backend never
receives or relays those keys or model traffic.

Security requirements include:

- TLS only and HSTS at the public hosts;
- `Secure`, `HttpOnly`, host-only session cookie;
- Origin validation and CSRF defense for every authenticated mutation;
- new session after authentication to prevent fixation;
- opaque random tokens stored hashed server-side;
- generic authentication responses and bounded verification attempts;
- strict input schemas, output encoding, and CSP;
- target/control origin separation;
- no arbitrary scenario execution;
- explicit expiry checks independent of DynamoDB TTL cleanup;
- account/session revocation; and
- dependency, secret, IAM, CORS, and cache-policy review before production.

## 19. Failure and concurrency behavior

### Controller failures

- Lost network: retain unsaved UI values locally, mark state stale, retry reads
  with backoff, and require explicit resubmit for mutations.
- Revision conflict: fetch latest state and show “This run changed in another
  window”; never silently overwrite.
- Expired run: disable controls, retain the final summary, and offer **Create a
  fresh run**.
- Target closed: keep run active and offer **Reopen target**.
- Controller closed: run and target continue until expiry.
- Email disabled/global limit: existing sessions continue; new sign-ins receive a
  non-enumerating temporary-unavailable response.

### Target failures

- Poll failure: show a realistic reconnect state only when the scenario calls for
  it; otherwise keep last confirmed state and retry with bounded backoff.
- Run expired: show a neutral expired-demo page, not a misleading application
  state.
- Invalid target action: return a domain error that the real UI renders; do not
  leak controller state.
- Reset during an active agent task: increment the revision and record the reset
  explicitly so validation does not combine pre-reset and post-reset evidence.

### Watch-specific behavior

- Watch remains bound to the target tab, not the active Control Center tab.
- Page/DOM Watch works while another controller tab is focused.
- Screen Watch must capture the watched tab/window rather than whichever window
  currently has keyboard focus; this is verified before advertising the visual
  scenarios.
- A run reset does not silently post the previous suggestion as new evidence.

## 20. Delivery stages

These are RFC rollout boundaries, not authorization to implement.

| Stage | Scope | Exit evidence |
| --- | --- | --- |
| 0. Contract spike | Finalize scenario/run/result schemas; prove CloudFront host/cookie/origin layout; prove Cognito email OTP custom flow in dev | Written findings close auth, cookie, CORS, and SES assumptions |
| 1. Product promotion | Create `apps/sandbox`; promote Restock plus a small Act/Read slice; remove public target fixture navigation; E2E consumes promoted build | Existing isolated E2E behavior passes against Sandbox build |
| 2. Local Control Center | Catalog, one-window multi-run UI, target separation, local deterministic state engine, arm/reset/challenge UX | Manual and automated Restock flow including impossible variant |
| 3. Hosted identity/state | Cognito OTP, 90-day revocable session, quotas, DynamoDB runs, target API, expiry/deletion | Auth, abuse, ownership, CSRF, concurrency, and retention tests pass |
| 4. Watch Lab | Restock, price, dashboard, message, irrelevant-change, visual-only, repeated-change variants | No-early-alert and state-transition E2E; manual Screen QA |
| 5. Closed result signal | Optional disclosed `SandboxRunResultV1`; combine it with state oracle | Success, recovery, clarification, false-success, stopped taxonomy proven |
| 6. Public beta | Approx. twelve curated scenarios, accessibility, responsive QA, privacy updates, monitoring, kill switches, SES production access | Owner production review and controlled beta evidence |
| 7. Expansion | Recovery Lab, optional history/export, new public scenarios, measured transport changes | Separate owner decisions where data or scope expands |

Restock is the required vertical slice before broader scenario migration. A large
one-shot move of all fifty routes is explicitly outside the plan.

### 20.1 Deployment and rollback runbook

The release order is deliberately infrastructure-first and reversible:

1. Deploy the complete stack to development and run the contract, handler,
   end-to-end, cookie, CORS, and visual tests with a development email identity.
2. Deploy the same versioned stack to staging, issue the staging certificate/DNS,
   and perform a controlled end-to-end Restock run with a real extension build.
3. Verify SES production access, authenticated sending domain, suppression,
   bounce/complaint handling, alarms, budgets, and the global email kill switch
   before enabling public code sends.
4. Publish the static Sandbox/control and target assets behind disabled or
   allowlisted run creation. Verify CloudFront route behavior, cache headers,
   origin separation, target handoff consumption, and no-cookie leakage.
5. Enable a small allowlisted beta with the configured quotas and monitor error,
   send, quota, latency, and cost alarms.
6. Conduct the owner public-beta review against Section 21 evidence, then remove
   the allowlist only after privacy/cookie/security/site/store copy is live.

Rollback order:

1. Disable new run creation and email sending through the kill switches.
2. Disable the `/api/sandbox/*` and `play` API behaviors or route them to a
   static maintenance response; leave existing static marketing traffic intact.
3. Revoke active target sessions and apex sessions if an authentication issue
   requires it.
4. Roll back the CDK application version and static assets only after recording
   the incident and retaining the minimum operational evidence needed for
   diagnosis.
5. Leave account-deletion and support/incident access available until all
   retention obligations are met.

No deployment step repurposes the existing static-site script as an application
deployment command. The Sandbox CDK application produces versioned stack outputs
and its own deploy/rollback commands; the site script remains responsible only
for static marketing assets.

## 21. Verification and acceptance criteria

### Product behavior

- User can browse without login, sign in with email OTP, create a run, open the
  target, arm a transition, reset, close/reopen, and delete the run.
- One Control Center manages three isolated concurrent runs without state bleed.
- The target contains no control values, control credentials, future transition,
  suggested task, expected answer, or cross-fixture navigation.
- Refresh/reconnect preserves authoritative state and revision.
- Target pages contain an honest non-production disclosure and cannot create real
  transactions or external messages.

### Authentication and abuse

- First and returning email flows have indistinguishable client responses.
- Code resend, hourly/daily email, verification-attempt, per-IP, run, concurrency,
  and command limits are tested at boundaries.
- Session cookie attributes and 90-day absolute expiry are asserted.
- Session fixation, CSRF, cross-origin cookie leakage, token-in-URL/log, logout,
  logout-all, and account-deletion tests pass.
- SES bounce/complaint/global-volume alarms and kill switches are exercised in
  staging.

### Harness correctness

- Feasible Restock cannot pass before authoritative availability changes.
- Never-restock Watch produces no required alert and treats silence as correct.
- A false completion with absent objective becomes `false_success`.
- Temporary blocker followed by success becomes `recovered`.
- Permanent blocker plus clarification becomes `correctly_clarified` once the
  closed result signal exists.
- Reset and mid-run challenge changes are revision-separated.
- Generic agent runtime contains no scenario ID, prompt literal, seed branch, or
  hidden expected value.

### Privacy and data boundaries

- Network tests prove the target origin never receives the login cookie or
  controller credential.
- Launch-handoff tests prove a token is one-time, short-lived, absent from the
  final target URL/referrer/log records, and cannot mint a controller session.
- Payload/schema tests reject unknown keys and arbitrary content.
- Bundle and infrastructure scans find no credentials.
- Operational logs contain no OTP, raw session token, public run capability, or
  raw email.
- Account deletion explicitly removes owned run/session records.
- Privacy, cookie, security, site, and store disclosures match shipped behavior.

### Quality

- Unit tests cover scenario reducers, validators, quotas, expiry, conflicts, and
  result classification.
- Integration tests cover API ownership, CORS/CSRF, conditional revisions, and
  Cognito wrapper behavior.
- E2E covers catalog -> login stub -> launch -> arm -> target transition -> reset,
  plus active-task and Watch variants.
- Accessibility audit covers keyboard, screen reader labels, live regions,
  contrast, reduced motion, and code entry.
- Visual regression review covers the catalog, email/code dialogs, empty Control
  Center, active Restock controls, three concurrent runs, quota/error states, and
  mobile/tablet widths against the opensidebar.com warm-light standard.
- `apps/site` and `apps/sandbox` import one shared set of stable brand tokens;
  neither application carries a drifting duplicate palette or typography stack.
- Narrow checks run during iteration; full site/Sandbox build, typecheck, lint,
  infrastructure tests, and affected extension tests pass before merge.

## 22. Launch metrics

Metrics are closed operational/product counters tied to the Sandbox service, not
general extension browsing telemetry:

- code requested/sent/verified/throttled, without raw email in metrics;
- run created/expired/deleted by allowlisted scenario/version;
- target opened and transition triggered;
- closed result category when available;
- API errors, throttles, latency, and conditional conflicts;
- SES sends, bounces, complaints, and suppression;
- concurrent runs and infrastructure cost.

Do not collect task prompt text, agent answer, trace, arbitrary target content,
provider/model identity, or activity outside the Sandbox. Public success-rate
claims require a separate methodology and owner review; these service metrics are
not automatically a benchmark.

## 23. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Email bombing and sender reputation damage | Per-email/IP/global limits, SES alarms, suppression handling, kill switch |
| Long-lived session theft | Opaque hashed/revocable tokens, Secure/HttpOnly cookie, absolute expiry, logout-all, CSP/XSS prevention |
| Run capability leaks through an agent-visible URL | One-time five-minute launch handoff, target-scoped short session, clean final route, no-store/referrer/log controls |
| Agent discovers private controls | Separate host and target origins; no controls or secrets in target state |
| Agent changes scenarios through API | Public capability grants only bounded target actions; control mutations require host-only session, CSRF, and ownership |
| Fixtures drift from product Sandbox | Promote behavior once; E2E consumes Sandbox build |
| Sandbox logic leaks into product runtime | Closed optional result port only; no scenario-specific planner/completion behavior |
| Impossible tasks are mislabeled failures | Feasibility-aware state oracle and explicit result taxonomy |
| Harness rewards narration | Deterministic state first; closed terminal enum only |
| Public target mistaken for a real service | Visible demo disclosure and no external side effects |
| Costs grow through polling or run spam | ETag/backoff, short run TTL, quotas, alarms, kill switches |
| Passwordless flow becomes custom security code | Cognito owns OTP generation/verification; wrapper owns quotas and opaque sessions |
| Result signal becomes telemetry backdoor | Trusted run only, exact closed schema, disclosure, no content, separate from LP-25 |

## 24. Alternatives

### Deploy the existing fixture directory directly

Rejected. It preserves test vocabulary, global fixture navigation, internal-only
routes, and duplicate server behavior without authentication, ownership, or
control separation.

### Put a hidden controller in each target page

Rejected. DOM, screenshot, and JavaScript perception can reveal it. A new
agent-ignore attribute would be fixture-specific product behavior and would not
protect against all perception modes.

### One controller window per scenario

Rejected. It creates window clutter and fragmented account/run state. One
persistent Control Center with isolated run panels provides the same separation.

### Anonymous capability-only runs with no login

Viable for a local prototype but rejected for the public service. It provides no
stable quota identity, session revocation, run restoration, or practical email
abuse boundary.

### Custom SES OTP implementation

Rejected for the initial service. Correct OTP generation, verification, account
state, challenge lifecycle, and abuse behavior are security-sensitive. Cognito's
native passwordless email OTP is the chosen identity primitive; OpenSidebar still
owns rate limiting and application sessions.

### Cognito tokens in browser local storage

Rejected. The application uses an opaque HttpOnly server-side session cookie and
does not expose durable authentication tokens to page JavaScript.

### Reusable public run capability in the final target URL

Rejected. The URL becomes part of browser history, copied links, diagnostics, and
may be visible to a model observing the page. A one-time handoff mints a bounded
target-session cookie and redirects to a clean target route instead.

### WebSockets from the first release

Rejected. Revision polling with ETag/backoff is simpler and adequate for
second-scale scenarios. Upgrade only from measured latency/cost evidence.

### Upload full agent results or traces for grading

Rejected. State-based validation plus a closed terminal enum is sufficient for
the planned taxonomy and does not justify collecting user-visible answers,
prompts, or traces.

### Move every fixture into the public app at once

Rejected. Restock is the vertical slice; the first catalog promotes only coherent
public scenarios. Internal recovery/red-team fixtures remain test infrastructure.

## 25. Owner review questions

The draft recommends answers but leaves them for the owner Decision Stamp:

1. **Public hosts:** approve `opensidebar.com/sandbox` for control and
   `play.opensidebar.com` for targets?
   - Recommendation: yes; it gives a clean host-only cookie boundary.
2. **Authentication:** approve Cognito native email OTP plus a 90-day absolute,
   revocable HttpOnly application session?
   - Recommendation: yes.
3. **Initial quotas:** approve Section 13 as beta defaults, adjustable through
   configuration and alarms?
   - Recommendation: yes; revisit from beta evidence.
4. **Catalog:** approve the twelve-scenario Act/Read/Watch mix while keeping the
   adversarial set internal?
   - Recommendation: yes.
5. **Result signal:** approve eventual closed `SandboxRunResultV1` after
   state-only launch, with exact disclosure and no prompt/answer/trace?
   - Recommendation: yes; ship it only after the deterministic state oracle.
6. **Retention:** approve two-hour active runs and 30-day closed run summaries,
   with immediate user deletion?
   - Recommendation: yes.
7. **Public name:** use “OpenSidebar Sandbox,” with “Control Center” for the
   human-only pane and “Watch Lab” as a catalog category/collection?
   - Recommendation: yes.
8. **Visual authority:** use the current opensidebar.com warm-light system for
   every Sandbox-owned surface, sharing stable tokens/primitives while allowing
   fictional targets to retain scenario-specific visual identities?
   - Recommendation: yes.
9. **Launch handoff:** approve a one-time five-minute `play` launch URL that
   mints a two-hour target-only session and redirects to a clean target route,
   instead of leaving a reusable run capability in the target URL?
   - Recommendation: yes.

## Recommended Decision

> This is an agent recommendation, not an owner Decision Stamp. Per
> `rfc-decision-process.md`, no implementation may begin until the owner records
> a complete `## Decision` block after reviewing this draft.

Recommended status: **Approved with edits**

Chosen path (recommended):

- Build a public OpenSidebar Sandbox with a catalog and one authenticated Control
  Center at `opensidebar.com/sandbox`, structurally separate target pages at
  `play.opensidebar.com`, and a small AWS application backend.
- Promote a curated subset of fixtures into `apps/sandbox`; make E2E consume the
  promoted product behavior and retain adversarial/internal fixtures under tests.
- Use Cognito passwordless email OTP, an opaque revocable 90-day host-only
  session cookie, and configurable per-email/IP/global quotas.
- Use versioned schema-driven runs, bounded semantic commands, revisioned state,
  deterministic final-state validation, and feasibility-aware outcomes.
- Start with Restock as the vertical slice, then ship an approximately twelve-item
  Act/Read/Watch catalog.
- Match all Sandbox-owned UI to the opensidebar.com warm-light visual system
  through shared stable tokens and primitives; preserve realistic, independent
  visual identities inside agent target scenarios.
- Add the closed, disclosed Sandbox terminal result signal only after the
  deterministic state oracle works; never upload prompts, answers, traces, or
  browsing activity.

Required edits before implementation (recommended):

- Owner confirms or edits the nine decisions in Section 25.
- Record the final data-retention and disclosure language in this RFC before
  changing infrastructure or product code.
- Record an owner Decision Stamp and validate it using the repository RFC
  process.

Non-blocking follow-ups (recommended):

- Design a public Recovery Lab from selected adversarial fixtures after the
  friendly catalog is proven.
- Consider passkeys only if the Sandbox grows beyond its low-risk email-identity
  and quota role.
- Consider shareable read-only run replays after retention and privacy behavior
  are established.
- Evaluate WebSockets only from measured polling latency and cost.

Do not do (recommended):

- Do not deploy or import the entire E2E fixture tree as the public product.
- Do not render or embed controller UI, credentials, future values, suggested
  prompts, or expected results in target pages.
- Do not add fixture IDs, prompt literals, seeds, expected values, or grading
  branches to generic agent runtime.
- Do not store auth tokens in local storage or expose the apex session cookie to
  the target subdomain.
- Do not leave a reusable target-run capability in a final target URL, referrer,
  normal application log, or copied public link.
- Do not implement custom OTP verification, arbitrary scenario code, or
  user-uploaded HTML/JavaScript in the initial release.
- Do not grade planner narration as task completion.
- Do not collect prompts, answers, DOM, screenshots, traces, provider keys,
  model/provider identity, or non-Sandbox browsing activity.
- Do not introduce a separate Sandbox palette, typography system, dark-dashboard
  theme, or copied set of brand tokens that can drift from opensidebar.com.
- Do not begin product/backend implementation before the owner Decision Stamp.

Evidence required before merge (recommended):

- Restock vertical-slice proof covering normal, never-restock, irrelevant-change,
  reset, conflict, expiry, and false-success behavior.
- Target/control separation tests proving no login cookie, control credential,
  future transition, suggested task, expected result, or control UI reaches the
  target.
- Authentication/session/abuse tests covering enumeration resistance, configured
  email/IP/run limits, cookie attributes, absolute expiry, fixation, CSRF,
  ownership, logout-all, and deletion.
- Scenario schema/fuzz tests, deterministic state/result tests, and E2E reuse of
  promoted Sandbox behavior without generic runtime fixture branches.
- Infrastructure IAM/CORS/cache/logging/secret/TTL assertions, controlled-load
  test, CloudFront route-policy assertions, target-handoff assertions, SES
  production/bounce/complaint review, alarms, and kill switches.
- Accessibility/responsive review and matching privacy, cookie, security, site,
  and Chrome Web Store disclosures before public activation.
- Visual regression evidence that the catalog, authentication, Control Center,
  account, quota, error, and result surfaces match the current opensidebar.com
  standard across desktop and tablet/mobile widths.

Recommended next action: **Revise RFC**

## 26. Lightsail and Playground amendment (2026-08-07)

The owner has renamed the public product surface **OpenSidebar Playground** and
selected the shared LP-28 Lightsail topology. This amendment changes deployment
and naming, but preserves the scenario, isolation, authentication, capability,
quota, validation, privacy, and failure contracts above.

- `opensidebar.com/playground` is the canonical human Control Center. Existing
  `/sandbox` links redirect to it during migration.
- `play.opensidebar.com/run/{publicRunId}` remains the isolated agent-visible
  target. The apex host-only account cookie must never be forwarded there.
- CloudFront continues serving static site/Playground assets from S3 and routes
  only documented dynamic API paths to Caddy on the $12 Lightsail origin.
- The modular Node service owns Playground auth sessions, quotas, runs, events,
  target capabilities, and deterministic validation. PostgreSQL stores these in
  a dedicated `playground` schema and role inside the `opensidebar` database.
- Existing `apps/sandbox`, `packages/sandbox-contracts`, and pure policies/tests
  are the implementation foundation. The public copy migrates to Playground;
  internal package renaming is optional and must not block the migration.
- Use Chakra UI v3 for the human Control Center and future shared account,
  settings, and session surfaces. Create a custom OpenSidebar Chakra system from
  the existing warm-light colors, typography, spacing, radii, shadows, focus
  rings, and semantic status tokens; Chakra defaults are not the product theme.
- Keep Chakra out of agent-visible target bundles. Targets use independent,
  scenario-specific HTML/CSS and must not inherit Control Center components,
  reset styles, brand tokens, or provider context.
- Migrate incrementally: provider/theme and shell first, then buttons, forms,
  cards, status, navigation, and dialogs. Preserve semantic markup, accessible
  names, deterministic selectors, and behavior; remove legacy Control Center
  CSS only after visual and E2E parity.
- Use TanStack Query for accounts, provider status, preferences, sessions,
  devices, scenarios, and Playground runs. Query data is disposable; HTTP and
  PostgreSQL are authoritative. Poll initially, then apply revisioned SSE events
  to the query cache and refetch active resources after reconnect.
- Use Zustand only for ephemeral Control Center state such as sidebar state,
  selected filters, and open dialogs. Use React Hook Form for forms and
  route/search parameters for shareable navigation. Do not place credentials,
  tokens, commands, leases, checkpoints, account records, or complete server
  objects in Zustand or browser persistence.
- Do not persist the TanStack Query cache initially. Local persistence is
  limited to harmless presentation preferences such as sidebar collapse and
  dismissed onboarding hints.
- Existing `infra/sandbox` API Gateway/Lambda/DynamoDB code is a parity source,
  not the target topology. Retire it only after PostgreSQL/API parity and
  deployment rollback evidence pass.
- Initial polling remains acceptable. SSE may later improve Control Center
  updates through the same Lightsail origin; target state correctness must not
  depend on an open stream.
- Playground data is operational product state, not LP-25 telemetry. It remains
  isolated from provider credentials, checkpoint plaintext, and Temporal
  workflow history.

Sections 15, 16, 16.1, 16.2, 17, 20, and their infrastructure acceptance items
must be read through this amendment: references to DynamoDB, Lambda, and API
Gateway describe the superseded implementation, not the approved destination.

## Decision

Status: Approved with edits

Chosen path:

- Implement OpenSidebar Playground using the contracts in this RFC: a Control
  Center at `opensidebar.com/playground`, isolated agent targets at
  `play.opensidebar.com`, and the shared LP-28 Lightsail/PostgreSQL backend.
- Use the approved Cognito email OTP, 90-day revocable session, per-email
  quota, scenario-run, target-launch-handoff, and deterministic result designs.
- Ship Restock as the required vertical slice, then implement the approved
  initial Act, Read, and Watch catalog.
- Apply the existing opensidebar.com warm-light system to Sandbox-owned UI and
  retain realistic independent styles inside target scenarios.

Required edits before implementation:

- Apply the section 26 amendment to deployment configuration, public copy,
  privacy/cookie documentation, and infrastructure tests.
- Prove feature parity for Restock, authentication, quotas, target handoff,
  expiration, and deletion before retiring `infra/sandbox`.

Non-blocking follow-ups:

- Recovery Lab, passkeys, shareable replays, and WebSocket transport remain
  follow-up work under the boundaries in this RFC.

Do not do:

- Do not violate any boundary listed in the Recommended Decision, including
  exposing controls in targets, adding scenario logic to generic agent runtime,
  collecting prompts/traces, or storing browser auth tokens in local storage.
- Do not operate a parallel serverless Playground backend after parity and
  rollback evidence pass.

Evidence required before merge:

- Complete every required evidence item in the Recommended Decision, including
  Restock vertical-slice, separation, authentication, infrastructure,
  accessibility, privacy, and deployment evidence.

Next action:

- Implement
