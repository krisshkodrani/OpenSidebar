# Privacy Policy

**OpenSidebar** - Chrome Browser Extension
Last updated: 2026-10-07

---

## Summary

OpenSidebar is an open-source browser extension that runs AI-powered tasks in your browser. It follows a **bring-your-own-key (BYOK)** model: you provide your own model-provider API key, and AI processing happens through the provider account you configure.

- Local mode remains available and sends model requests directly to the provider you configure.
- Account-linked Cloud mode is optional and requires explicit sign-in and activation. It stores your provider credential as KMS-backed encrypted ciphertext and relays model requests without retaining their content.
- The separate public **OpenSidebar Playground** service is optional. When you choose
  to sign in there, it processes your email address, a secure session record,
  minimal quota counters, and Playground run state; it does not receive extension
  prompts, answers, traces, screenshots, or page content unless you explicitly use Cloud mode for an extension task.
- We do **not** run advertising analytics, behavioral tracking, or crash reporting. The optional Cloud relay processes task content only while forwarding a request to your selected provider.
- This release includes an optional local-only reliability-summary preview. It is off by default, and uploading is not enabled in the published build.
- Task context is sent directly to the configured provider in Local mode, or through the OpenSidebar relay to that provider in explicitly activated Cloud mode.
- Safety settings and authentication tokens remain device-local. Account-linked safe preferences can synchronize separately. Optional encrypted personal-data synchronization covers saved prompts, website skills, and profile notes only when you enable the relevant category. Remote missions send bounded instructions and evidence to the service and authorized supervising client.

---

## What Data the Extension Accesses

### Page Content

When you give the extension a task, it reads the content of the active browser tab, including DOM structure, visible text, page title, URL, and screenshots when visual grounding is enabled. This is necessary for the AI agent to understand the page and perform the actions you request.

Page content is accessed for tasks and for **Watch mode when you explicitly start
it**. Watch reads the selected tab after page changes and on periodic checks,
and sends the observation to the configured inference path to evaluate your
condition. Optional screenshot input is used when the watched tab is active.
Stop Watch to end monitoring; it is not an always-on service and does not resume
after a browser restart. The extension does not automatically monitor every tab
or build a browsing-history index.

### Cookies, History, Downloads, And Tabs

The extension has permissions for `cookies`, `history`, `downloads`, `tabs`, and related browser APIs. These are used through agent tools that you can trigger through tasks such as "download this file", "clear cookies for this site", or "search my history for...".

These APIs are used to fulfill active tasks, and high-risk operations can require approval depending on your configured interaction mode.

---

## What Data Is Stored Locally

Extension data is stored in your browser using Chrome's built-in storage APIs (`chrome.storage.local`, `chrome.storage.sync`, `chrome.storage.session`). This includes:

| Data | Storage | Purpose |
| --- | --- | --- |
| Provider API keys | `chrome.storage.local` in Local mode | Authenticating directly with configured model-provider APIs. Explicit Cloud migration removes a local key only after the encrypted cloud copy is verified and you activate it |
| User settings | `chrome.storage.sync` | Local settings. A closed subset of non-safety preferences may also sync to your OpenSidebar account after sign-in |
| OpenSidebar device session | `chrome.storage.local` | Revocable opaque access/refresh material for optional Cloud sign-in; never a provider credential |
| Agent session state | `chrome.storage.session` | Temporary state during active tasks |
| Workspace data | `chrome.storage.local` | Tab group organization |
| Saved prompts | `chrome.storage.local` | Quick-access prompt templates you create |
| Personal profile | `chrome.storage.local` | Optional profile notes and the digested facts/preferences you write, used to personalize tasks. Local by default; optional profile synchronization uploads an end-to-end encrypted copy when enabled. Items marked **sensitive** and raw notes are also encrypted at rest locally |
| Diagnostic logs | `chrome.storage.local` | Local ring buffer of structured log entries for debugging |
| Optional reliability summaries | `chrome.storage.local` | Coarse, sampled outcome data you can inspect and clear. Off by default; the published build cannot upload it |

Chrome extension storage is not a dedicated secrets vault. Protect your browser profile and operating-system account. Synced settings (`chrome.storage.sync`) follow your Chrome profile sync preferences; disable Chrome Sync to keep them local to one profile.

Stored extension data is removed by Chrome when you uninstall the extension, subject to Chrome's normal sync behavior for synced settings.

---

## What Data Is Sent Externally

### Model Provider APIs

When performing a task, the extension sends requests to the configured model provider API. The supported gateway is OpenRouter, which routes to the selected upstream model provider. Direct vendor adapters and mixed-provider modes are retired.

Requests may contain:

- a system prompt describing the agent's capabilities;
- the current page context, such as URL, page title, element list, and visible text;
- a screenshot of the visible browser area when visual grounding is enabled;
- your conversation messages and the agent's prior responses;
- relevant items from your **personal profile**, if you have enabled it, to personalize the task;
- your configured provider API key as an authentication header.

**Personal profile and sensitive data.** When the personal-profile feature is enabled, the digested facts and preferences relevant to a task are included in the request to your configured model provider as task context. Items you mark **sensitive** are **excluded by default** and are sent only when you give explicit, per-task consent for the specific field that needs them. Sensitive items and your raw profile notes are stored encrypted at rest on your device (see the storage table above).

In Local mode, requests are sent over HTTPS directly to the selected provider. In Cloud mode, they are sent over HTTPS to `opensidebar.com`, decrypted only as needed to authenticate the provider call, and streamed to the same selected provider. The relay does not persist prompts, messages, screenshots, tool schemas/results, responses, or reasoning. It retains only coarse operational metadata such as provider/model identifier, status class, token counts, latency bucket, and monthly quota totals. The selected provider's privacy policy governs how that provider handles API traffic in both modes.

Cloud mode supports OpenRouter. It does not silently fall back to a local key when the Cloud service is unavailable.

### Remote browser work and MCP

Remote work requires an account-linked browser and explicit device enablement.
An authorized MCP client can submit task instructions and read bounded progress,
answers, approval questions, and target-selection evidence. That evidence can
contain page-derived text, titles, and URLs. Do not authorize tasks over sensitive
pages unless you intend the resulting evidence to be shared with that client.
Interactive remote work has additional build and server gates.

The service stores mission metadata and encrypted mission payloads/results for
delivery and retrieval; unlike the streaming model relay, these are persisted
records. This encryption is server-managed and is not end-to-end encryption
against the service. The application supports expiry and cleanup of mission
records, but delivery expiry is not a promise of immediate storage deletion.
Local deny, cancel, site restrictions, and approval checks still apply.

### Optional personal-data synchronization

Saved prompts, website skills, and profile notes are separate opt-in sync
categories, disabled by default. Enabled categories are encrypted on the device
before upload; the service stores ciphertext and synchronization metadata.
Another device needs the account's device-key approval flow to decrypt them.
Turning synchronization off is separate from deleting its cloud copy; the
settings provide deletion/reset controls. Safe account preferences use a closed
schema and do not include local safety rules or provider secrets.

### Optional Local Log Server

If you run the development stack (`pnpm run dev`) or local log server (`pnpm run logs`), the extension drains diagnostic logs and trace data to `127.0.0.1:7589` on your local machine. This is local, opt-in development infrastructure and does not transmit data over the internet.

If you also expose traces to a local coding agent through the optional observability MCP server (`pnpm run mcp`, stdio/loopback only), common PII shapes (email, phone, SSN, card numbers) are scrubbed from the trace content returned to that agent.

---

## What Data We Collect

When using direct inference without optional account services, we do not receive extension API keys, task content, traces, or local reliability summaries. Signing in, personal-data synchronization, and remote work have the separate data flows described above; choosing direct inference alone does not disable them. The optional reliability-summary preview stores data only in your browser and provides controls to inspect and clear it.

When you opt into Cloud mode, the account service stores your Cognito subject, email address, registered-device metadata, revocable session hashes, safe preferences, encrypted provider credentials, and coarse relay usage metadata. Relay content is processed transiently and is not stored. Credential records remain until you delete them; device sessions can be individually revoked or revoked together. Use the account controls to revoke devices and remove provider connections; contact the maintainer through a private channel for account-wide deletion requests that are not exposed in the current UI.

### Optional OpenSidebar Playground

The public Playground at `opensidebar.com/playground` is a distinct, opt-in web
service. It uses passwordless email sign-in and maintains a secure, host-only
session cookie for up to 90 days. It stores the Cognito account subject, session
revocation and expiry metadata, bounded per-account quota counters, and
the minimal state needed to run a selected simulated scenario. A target page at
`play.opensidebar.com` receives a separate short-lived target-session cookie;
it never receives the apex sign-in cookie.

Playground state is retained only for its short run lifetime, except for limited
session and quota records needed for security and abuse prevention. We do not
use Playground data for advertising, do not sell it, and do not collect agent task
text, agent answers, browser DOM, screenshots, traces, browsing history,
provider credentials, or unrelated page content through this service.

---

## Permissions Explained

| Permission | Why It Is Needed |
| --- | --- |
| `sidePanel` | The extension UI lives in Chrome's side panel |
| `storage` | Storing settings, API keys, session state, workspace data, and local diagnostics |
| `activeTab` | Reading the current tab's content when you send a task |
| `tabs`, `tabGroups` | Managing workspaces and switching between tabs during multi-tab tasks |
| `scripting` | Injecting the content script that reads page structure and executes actions |
| `webNavigation` | Persisting agent state across page navigations so tasks survive page loads |
| `alarms` | Keeping long-running tasks active across service-worker lifecycle limits |
| `search` | Agent tool: performing web searches on your behalf when requested |
| `downloads` | Agent tool: downloading files when requested |
| `cookies` | Agent tool: reading or setting cookies when requested |
| `history` | Agent tool: searching browser history when requested |
| `notifications` (optional) | User-authorized browser notifications when this permission is granted |
| `<all_urls>` | The agent can interact with websites you choose to automate |

---

## Third-Party Services

The extension communicates with the model provider endpoints you configure, either directly in Local mode or through the optional OpenSidebar Cloud relay, using your own API keys. Account authentication uses Amazon Cognito and credential envelope encryption uses AWS KMS. We have no affiliation with model providers beyond using their public APIs. Your relationship with each provider is governed by that provider's terms and privacy policy.

---

## Children's Privacy

OpenSidebar is not directed at children under 13. We do not knowingly collect information from children.

---

## Changes to This Policy

If this policy changes, the updated version will be published in the [GitHub repository](https://github.com/krisshkodrani/OpenSidebar) and the "Last updated" date above will be revised.

---

## Contact

For privacy questions, use the private-reporting route in [SECURITY.md](SECURITY.md). If you need a contact address, request one without including personal information, credentials, or private task content in a public issue.

---

## Open Source

OpenSidebar is open source under the [MIT License](LICENSE). You can audit the complete source code to verify every claim in this policy at [github.com/krisshkodrani/OpenSidebar](https://github.com/krisshkodrani/OpenSidebar).
