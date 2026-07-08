# Chrome Web Store Privacy Tab - OpenSidebar

Copy-ready answers for the CWS "Privacy" tab. Every claim here must stay
consistent with [PRIVACY_POLICY.md](../PRIVACY_POLICY.md) — update both together.
Listing copy lives in [store-listing.md](./store-listing.md).

## Single Purpose Description

```text
OpenSidebar is an AI browser agent: the user describes a task in the side panel, and the extension navigates, clicks, types, and reads pages to complete that task, using an AI model API key the user supplies.
```

## Permission Justifications

One entry per manifest permission. Each is written to be pasted into the
dashboard's justification field as-is.

| Permission | Justification |
| --- | --- |
| `sidePanel` | The entire user interface lives in Chrome's side panel: the task composer, the agent's step-by-step progress, and the approval prompts. |
| `storage` | Stores the user's provider API key, settings, saved prompts, optional personal-profile notes, workspace data, session state, and a local diagnostic log ring buffer. Nothing is stored on external servers. |
| `activeTab` | Reads the current tab's content when the user sends a task so the agent can understand the page it was asked to act on. |
| `scripting` | Injects the content script that reads page structure and executes the user's requested actions (click, type, scroll, select) on the page. |
| `tabs` | Multi-step tasks span tabs: the agent opens, switches, lists, and closes tabs (e.g. reading data on one page to fill a form on another) and reports which tab it is working in. |
| `tabGroups` | Organizes the tabs a task creates into a workspace tab group so users can see and clean up everything a task touched. |
| `tabCapture` | Captures a screenshot of the visible page as visual grounding for the AI model, so it can see the page the way the user does. Screenshots are captured during active tasks only. |
| `offscreen` | Hosts an offscreen document for capabilities the MV3 service worker cannot run directly (e.g. audio transcription of voice input). |
| `webNavigation` | Detects page loads and navigations during a task so the agent can wait for pages to finish loading and keep a task alive across navigations. |
| `alarms` | Keeps long-running tasks alive across Chrome's MV3 service-worker suspension by scheduling wake-ups. |
| `search` | Agent tool: performs a web search when the user's task asks for one (e.g. "search for X and open the first result"). |
| `downloads` | Agent tool: downloads a file when the user's task asks for one (e.g. "download this report"). |
| `cookies` | Agent tool: reads or clears cookies for a site when the user explicitly asks (e.g. "clear cookies for this site"). Gated as a high-risk tool behind the approval settings. |
| `history` | Agent tool: searches the user's browser history when the user explicitly asks (e.g. "find the article I read yesterday"). Gated as a high-risk tool behind the approval settings. |
| `notifications` (optional) | Shows a desktop notification when a long-running task finishes or needs approval while the side panel is closed. Requested only if the user enables it. |

### Host Permission Justification (`<all_urls>`)

```text
OpenSidebar is a general-purpose browser agent: the user chooses which website to automate by giving it a task on that site, so the content script must be able to run on whatever site the user directs it to. The extension only acts on a page during an active user-initiated task; it does not passively monitor, index, or record browsing. High-risk actions are gated behind configurable approval settings.
```

## Data Usage Disclosures

The extension has no servers: it collects nothing for the developer. Data leaves
the browser only as requests to the AI provider the user configures (BYOK).
Declare the following categories, because page data is transmitted off-device to
that user-chosen provider during tasks:

| Dashboard category | Declare? | Why |
| --- | --- | --- |
| Website content | **Yes** | During an active task, page text, structure, URL, title, and (when enabled) a screenshot of the visible tab are sent to the user's configured model provider so the AI can act on the page. |
| Web history | **Yes** | Only when the user explicitly asks a history task ("find the page I read yesterday"); matching history entries become task context sent to the user's configured provider. There is no passive history collection. |
| Authentication information | **Yes** | The user's own provider API key is stored locally in Chrome storage and transmitted only to that provider as the authentication header. We never see it. |
| Personal communications | **Yes** | The user's task messages (their conversation with the agent) are sent to the user's configured provider to perform the task. |
| Personally identifiable information | **Yes** | Only if the user opts into the personal-profile feature: profile facts relevant to a task are included as context for the user's configured provider. Sensitive items are excluded unless the user gives explicit per-task consent, and are encrypted at rest. |
| Health information | No | Not collected or requested. |
| Financial and payment information | No | The extension does not collect payment data itself. (If a user directs the agent to fill a payment form, that data goes only page ↔ provider under the user's instruction, like any typed content.) |
| Location | No | Not collected. |
| User activity (clicks, mouse position, scroll, keystroke logging) | No | The extension does not monitor the user's own activity; it executes its own actions during tasks. |

### Required certifications (all truthfully "yes")

- I do not sell or transfer user data to third parties, outside of the approved use cases. ✔ (Data goes only to the model provider the user configured — that is the product's core, user-directed function.)
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose. ✔
- I do not use or transfer user data to determine creditworthiness or for lending purposes. ✔

## Remote Code Declaration

```text
No, I am not using remote code.
```

All JavaScript ships inside the extension package (MV3, bundled by Vite). The CSP
allows only 'self' plus 'wasm-unsafe-eval'; no scripts are loaded from the network
and no eval of remote strings occurs. The agent's `execute_js` tool runs only in
the context of the page being automated at the user's direction, not in the
extension.

## Verification

Run this to confirm every manifest permission has a justification row here:

```bash
node -e "
const m = require('./apps/extension/manifest.json');
const doc = require('fs').readFileSync('docs/store-privacy-answers.md','utf8');
const all = [...m.permissions, ...(m.optional_permissions||[])];
const missing = all.filter(p => !doc.includes('\`' + p + '\`'));
console.log(missing.length ? 'MISSING: ' + missing.join(', ') : 'all ' + all.length + ' permissions justified');
"
```
