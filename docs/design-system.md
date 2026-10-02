# Design system: Calm autonomy

OpenSidebar uses quiet surfaces, pine for action, and a small chartreuse signal
for current activity. The product shows observed work and its evidence without
pretending that a task has a predictable completion percentage.

## Shared palette

`packages/ui-tokens/tokens.json` is the source of truth. Run
`node scripts/build-ui-tokens.mjs` after changing it. `pnpm ui-tokens:check`
verifies the generated CSS; the repository verification command checks it too.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#F5F8F4` | `#101B18` | Page background |
| Surface | `#FFFFFF` | `#172621` | Cards and controls |
| Muted surface | `#E4F1EC` | `#21362E` | Quiet grouping |
| Ink | `#182925` | `#EAF4EC` | Primary text |
| Muted ink | `#586A62` | `#B5C9BD` | Secondary text |
| Line | `#D9E4DE` | `#344D40` | Separation |
| Pine | `#126B64` | `#72C6B6` | Primary action, active navigation, links |
| Pressed pine | `#0D554F` | `#A2E4D4` | Hover and focus emphasis |
| Chartreuse | `#A5C842` | `#C1DC70` | Small live marker and editorial highlight |

Success, warning, and danger retain distinct semantic colors. Chartreuse never
means success by itself. Do not use color alone to communicate a state.

## Task progression

- Show named states such as **Starting**, **Running**, **Waiting for approval**,
  **Completed**, and **Outcome uncertain**.
- Show a timestamp when a state or cost was actually observed. A plan's steps
  may be shown as step states, but they are not an overall completion forecast.
- Label active remote spend as observed and provisional. Reconcile the terminal
  value when the run finishes. Show **Unknown** when no trustworthy price exists;
  a measured zero is distinct.
- Keep stop and approval controls near the active task, with clear consequences.

## Surfaces

- The public site leads with a result receipt and the trust story. The receipt
  is explicitly illustrative; demos and Playground links remain accessible.
- The SaaS workspace groups current work, recent activity, analytics, and
  settings. It retains system, light, and dark appearance modes.
- The extension side panel and trace viewer share the same palette. The live
  marker is a short chartreuse line, not a moving progress estimate.
- Internal ModelBench and training-data review screens use the product palette.
  Fictional benchmark target websites keep their independent visual styles.

## Implementation

The site, SaaS, extension, and trace viewer consume the shared token values
through generated CSS, Chakra semantic tokens, or Tailwind. Prefer those tokens
over new hardcoded brand colors. Local product screenshots and traces belong in
`.artifacts/`, not the tracked docs tree.
