# Design System

OpenSidebar uses an Azure-inspired product palette: neutral work surfaces, clear blue trust/action colors, and teal only for live agent activity.

This page is the stable repo record for implemented design decisions. Long-form color research belongs in Notion.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| `brand.surface` | `#F8FAFC` | App canvas and quiet backgrounds |
| `brand.panel` | `#FFFFFF` | Cards, panels, input surfaces |
| `brand.text` | `#0F172A` | Primary text |
| `brand.muted` | `#475569` | Secondary text |
| `brand.subtle` | `#334155` | Strong secondary labels and dark UI accents |
| `brand.accent` | `#2563EB` | Primary actions, active navigation, key links |
| `brand.accent-strong` | `#1D4ED8` | Hovered or pressed primary actions |
| `brand.live` | `#14B8A6` | Agent running, streaming, live orchestration |
| `brand.live-soft` | `#99F6E4` | Soft live backgrounds and glows |
| `state.success` | `#15803D` | Completed states and positive confirmation |
| `state.warning` | `#D97706` | Attention, feedback mode, recoverable risk |
| `state.error` | `#DC2626` | Errors, blocked state, destructive risk |
| `state.info` | `#2563EB` | Informational state |

## Usage Rules

- Use blue for user action, selection, trust, and primary product identity.
- Use teal for live agent behavior only: running, streaming, processing, orchestration activity.
- Use amber for user attention or feedback mode, not as a general accent.
- Use red only for errors, blockers, destructive actions, or hard failure states.
- Keep surfaces neutral. The product should feel like a workbench, not a campaign page.
- Prefer semantic tokens over raw hex values in UI code.

## Focus Treatment

Interactive controls should use the wider two-layer focus treatment:

| Mode | Shadow |
| --- | --- |
| Light | `0 0 0 2px #ffffff, 0 0 0 5px rgba(37, 99, 235, 0.22)` |
| Dark | `0 0 0 2px #0f172a, 0 0 0 5px rgba(96, 165, 250, 0.28)` |

This makes keyboard and active-composer focus visible without turning the whole surface blue.

## Implementation

- Tailwind tokens live in `tailwind.config.cjs`.
- Side panel global styles live in `apps/extension/src/sidepanel/index.css`.
- Trace viewer global styles live in `apps/extension/src/trace-viewer/index.css`.
- The main composer focus glow is applied through `.input-glow`.

