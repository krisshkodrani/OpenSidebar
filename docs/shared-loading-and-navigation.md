# Loading and session navigation

Contract version 1, 2026-10-07. The user confirmed shared behavior, individual
branding and logout to the public landing on 2026-10-07. Applies to AIFindMe.Work, PlayScenario.AI and
the OpenSidebar web workspace. Each product keeps its approved colors,
typography, illustrations and layout. Shared behavior follows AIFindMe.Work's
approved loading discipline. Browser extension authentication remains a separate
device session; signing out of the website does not silently unlink a device.

## Loading

Use a 16px decorative ring, a one-second rotation, and a short operation label.
Respect reduced motion by stopping rotation. A polite atomic status announces
meaningful changes. Never use spinner-only buttons, skeletons, shimmer, fake
percentages or indefinite loading for a known error.

Initial session checks use a branded public frame without private navigation or
cached account content. Initial page reads reserve a compact region. Refreshes
retain existing content and layout, with a local status; only actions depending
on stale results are unavailable. Background checks do not replace existing
content with a full-page loader.

Pending actions prevent duplicate submission and report the action: Checking
your session, Sending code, Signing in, Signing out, or Loading results.
Only supported cancellation remains available. Failed operations show an
explanation and an explicit retry; outages are neither empty results nor logout.
Long-running jobs display observed phases/counts, never invented progress.

## Navigation

| Situation | Required outcome |
| --- | --- |
| Visit a landing page | Show the public page even when signed in. |
| Choose Open app | Enter the app if authenticated; otherwise enter its login gate. |
| Open a protected deep link | Check the session before mounting private UI; retain a validated internal destination. |
| Complete login | Replace login history with the saved destination, or the app home. |
| Visit login while authenticated | Continue to the validated destination without another login form. |
| Explicit logout succeeds | End the server session, clear private browser state, and replace navigation with the public landing. |
| Logout fails | Keep the current session and drafts; show a retryable error. Never claim success. |
| Session expires | Remove private UI and caches; offer/enter sign-in with the safe destination retained. |
| Network or server failure | Show recovery without treating it as an expired session. |
| Browser Back or restored tab | Revalidate protected state; do not restore private cached UI after logout. |

Unsaved-work protection remains in place. A save failure must never silently
discard changes or complete logout. Preserve harmless theme/language preferences
where existing security policy allows. Do not persist private API payloads,
credentials or draft content in navigation state.

## Routes and identity boundaries

| Product | Public landing | App home | Login |
| --- | --- | --- | --- |
| AIFindMe.Work | https://aifindme.work/ | https://app.aifindme.work/ | /auth/login on the app origin |
| PlayScenario.AI | https://playscenario.ai/ | /workspaces | /login |
| OpenSidebar | https://opensidebar.com/ | /app | /app/sign-in |

Keep these existing routes; consistent behavior does not require breaking links.
Return targets must be validated against each app's internal routes, reject
external/protocol-relative URLs and auth loops, and retain supported query/hash
state. OAuth authorization continuations retain their existing protocol rules.
Required hosted-provider logout is completed before reaching the landing page.

## Acceptance

Use fictional accounts and deterministic delayed/failed responses, with no
paid model calls. Verify initial checks, retained refresh content, duplicate
action prevention, logout success/failure, expiry, outage recovery, deep links,
unsafe redirects, Back/restore, and unsaved work. Check mobile/desktop,
light/dark, reduced motion and accessible status/error labels. Preserve
AIFindMe.Work DE/EN and real-component demo parity.

Visible changes require representative screenshots and the repositories'
applicable review process. Implementation and test status belong to release
evidence; this contract is not a declaration of deployment or human approval.


## Release prerequisites

AIFindMe.Work must register
`https://app.aifindme.work/auth/signed-out` as an allowed Cognito logout URL
before deploying the backend change. Keep existing logout URLs for rollback.
The new public callback completes provider logout before redirecting to the
owned landing. Explicit reauthentication remains available through
`/auth/login?reauthenticate=true`; ordinary visits with a valid session resume
the app. Session invalidation, CSRF and provider token checks remain required.

This change is prepared in shared dirty checkouts. Freeze a numbered release
with source and artifact identity before deployment; do not silently deploy
unrelated work. Visual decisions apply only to their recorded screenshot hashes.
