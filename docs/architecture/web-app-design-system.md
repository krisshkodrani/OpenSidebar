# Web application design system

The human workspace at `/app` uses Chakra UI v3 with the system in
`apps/sandbox/src/app/theme.ts`. The marketing site and simulated target
applications retain their own presentation. Never import this provider or
these components into agent-visible target bundles.

- Use `PageLayout` and `PageHeader` for page width, spacing, titles and actions.
  `AppShell` owns the main landmark, skip link, responsive navigation and
  active destinations, including the account/settings alias.
- Use the shared `card` surface and Chakra form controls. Primary actions use
  blue; destructive actions explicitly use red. Use `muted`, `line`, `surface`,
  `success` and `danger` tokens instead of hardcoded light-only colors.
- Website appearance supports System, Light and Dark. It is a local presentation
  preference, independent of the extension theme saved under synced preferences.
  System mode responds to operating-system changes; explicit choices persist.
- Legacy CSS loads only for legacy entry routes. Do not reintroduce its global
  element selectors into `/app`.
- Loading, errors and confirmed account states must remain distinct. Provide
  meaningful pending feedback and accessible status/error announcements.
- Keep private account data, credentials, task state and query responses out of
  appearance storage. Preserve the control/target authentication boundary.

Build the sandbox, then run `node --import tsx scripts/verify-app-ui.ts` for the
browser regression checks. This uses a fresh browser profile and local mocked
account responses; it does not mutate a real account. Screenshots and reports
are written to `.artifacts/app-design-system/`. Run the target bundle boundary
check and live release smoke separately before deployment is considered complete.
