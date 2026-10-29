# Design system: Clean neutral

OpenSidebar uses white or near-black surfaces, neutral grays, and one blue
accent. Contrast is high and the panel is calm: color marks action and state,
not decoration. The product shows observed work and its evidence without
pretending that a task has a predictable completion percentage.

## Tokens

`packages/ui-tokens/tokens.json` is the source of truth. Run
`node scripts/build-ui-tokens.mjs` after you change it; `verify` checks that
`theme.css` is current. Each role is a CSS variable with an RGB triplet, and
`.dark` on `<html>` switches every role. Components use the Tailwind names in
the first column and need no `dark:` color variants.

| Tailwind color | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#FFFFFF` | `#0F1113` | Page and panel background |
| `surface` | `#FFFFFF` | `#16191D` | Cards, menus, dialogs, inputs |
| `surface-subtle` | `#F6F7F9` | `#1D2025` | Code blocks, chips, collapsed details |
| `surface-hover` | `#EDEFF2` | `#262A30` | Hover rows and buttons |
| `line` / `line-strong` | `#E2E5EA` / `#C9CED6` | `#2B3037` / `#3D434C` | Dividers / input borders |
| `fg` | `#111317` | `#F1F3F5` | Primary text, headings, answers |
| `fg-secondary` | `#454C57` | `#BAC0C8` | Step labels, metadata people read |
| `fg-tertiary` | `#5F6772` | `#949BA5` | Hints, timestamps, placeholders |
| `accent` / `accent-hover` | `#2563EB` / `#1D4ED8` | same | Primary button, user message, selection |
| `accent-fg` | `#FFFFFF` | `#FFFFFF` | Text on `accent` |
| `accent-subtle` / `accent-text` | `#EEF3FE` / `#1D4ED8` | `#17233B` / `#8DB4FB` | Selected rows / links, active tab |
| `success`, `warning`, `danger` | `#15803D`, `#B45309`, `#C42121` | `#4ADE80`, `#F5B14C`, `#F87171` | State text and icons |
| `*-subtle` | light tints | dark tints | State banners and badges |

Do not use color alone to communicate a state; pair it with a label or icon.

## Rules

| Element | Classes |
| --- | --- |
| Header, message area, composer | `bg-canvas` or `bg-surface`, separated by `border-line` |
| Primary button | `bg-accent text-accent-fg hover:bg-accent-hover` |
| Secondary button | `bg-surface border border-line text-fg hover:bg-surface-hover` |
| Ghost or icon button | `text-fg-secondary hover:bg-surface-hover hover:text-fg` |
| Input | `bg-surface border border-line-strong text-fg placeholder:text-fg-tertiary` with an `accent` focus ring |
| State banner or badge | `bg-{state}-subtle text-{state} border border-{state}/30` |
| Disabled control | `disabled:opacity-50` on the control, never as a text color |

Type: body and answers 14px (`text-ui-body`), labels and controls 13px
(`text-ui-control`), captions 12px (`text-ui-caption`). Nothing is smaller
than 12px.

## Checks

- `apps/extension/tests/sidepanel/token-contrast.test.ts` checks every text
  pair in `tokens.json` (`contrast.text`) at WCAG AA 4.5:1 and UI pairs
  (`contrast.ui`) at 3:1, in light and dark. Add a pair there when you add a
  new combination.
- `scripts/check-ui-palette.mjs` runs in `lint` and `verify`. It fails on raw
  or legacy palette colors, `dark:` color variants, hex colors, text below
  12px, and faded text in `src/sidepanel` and `src/ui`.

## Task progression

- Show named states such as **Starting**, **Running**, **Waiting for approval**,
  **Completed**, and **Outcome uncertain**.
- Show a timestamp when a state or cost was actually observed. A plan's steps
  may be shown as step states, but they are not an overall completion forecast.
- Label active remote spend as observed and provisional. Reconcile the terminal
  value when the run finishes. Show **Unknown** when no trustworthy price exists;
  a measured zero is distinct.
- Keep stop and approval controls near the active task, with clear consequences.

## Trace viewer

The trace viewer keeps its own `trace-*`, `state-*` and `brand-live` colors for
now. Local product screenshots and traces belong in `.artifacts/`, not the
tracked docs tree.
