# RFC LP-14 — In-Browser PDF Handling

Lifecycle status: Decision stamped
Date: 2026-07-04
Decision date: 2026-07-04 (owner accepted the recommended decisions for the LP-9…LP-14 series in session)
Scope: PDF detection in snapshot/loop, a `read_pdf` capability (fetch + extract in the service worker or offscreen document), prompt guidance, fixtures
Related: Perception SOTA audit (2026-07-04); browser-use PDF auto-download strategy; existing `pageContent` distillation (Readability→Turndown)

## Problem

Chrome's built-in PDF viewer is opaque to content scripts: the DOM snapshot
of a PDF tab yields no elements and no text, so perception degrades to a
screenshot of the first visible page and the agent can neither read nor
navigate the document. Tasks like "open the linked invoice and read the
total" fail by construction. The field's answer (browser-use): detect the
PDF, fetch the file, extract text directly, fall back to screenshot
scrolling; coordinate-native agents page through the viewer visually.

## Proposal

1. **Detection**: snapshot marks `isPdf` when the tab URL ends `.pdf` or the
   top frame document is Chrome's PDF viewer (content-type sniff via a HEAD
   fetch when ambiguous). The loop surfaces "This tab is a PDF document" in
   context instead of an empty element list.
2. **Extraction**: on the first turn on a PDF tab, the service worker
   fetches the URL (same session/cookies via host permissions) and extracts
   text with `pdfjs-dist` (text layer only, no rendering) in an offscreen
   document; result is distilled into `pageContent` (existing 50-char-min
   pipeline) with per-page markers `[page N]`. Cap extraction at 50 pages /
   200 KB text with overflow metadata, mirroring element-cap conventions.
3. **Tooling**: no new tool — `read_page` already returns `pageContent`;
   scrolling tools keep working for the visual path. If extraction fails
   (scanned/image PDF, auth-gated fetch), fall back to unified_vl screenshot
   + scroll, and say so in the interpretation.
4. **Dependency note**: `pdfjs-dist` is ~2 MB; ship it lazily as a separate
   chunk loaded only on first PDF encounter to keep the base bundle flat
   (dist-check gains a chunk-presence assertion, not a size regression).

## Risks

- Fetch duplication: the PDF downloads twice (viewer + our fetch) — bounded
  by a 10 MB cap consistent with `upload_file`'s limit; skip when
  content-length exceeds it and use the visual path.
- Auth-gated PDFs where the fetch lacks the viewer's exact context —
  detected by non-200/permission responses; visual fallback covers it.
- Scanned PDFs have no text layer — explicitly out of scope (visual path);
  no OCR dependency in this RFC.
- Bundle size scrutiny at CWS review — lazy chunk keeps the reviewed core
  unchanged; document in the listing notes.

## Verification

- Fixtures: text PDF (invoice with a known total), scanned PDF (fallback
  path), oversized PDF (cap path).
- E2E: "read the total from the linked invoice" passes with text
  extraction; trace shows `[page N]` provenance.
- dist-check: pdfjs chunk present, lazily referenced, no localhost/dev
  leakage; `pnpm run verify` green.

## Decision

Status: Parked

Chosen path:

- Design accepted as written (detect → fetch → pdfjs text-layer extraction
  into pageContent → visual fallback), but deliberately not scheduled.

Required edits before implementation:

- Re-stamp required before any implementation begins.

Non-blocking follow-ups:

- Reconsider when a real user scenario or bench task involves PDFs, after
  LP-9/LP-10/LP-11 land.

Do not do:

- No OCR dependency; no eager pdfjs in the base bundle when implemented.

Evidence required before merge:

- None (parked).

Next action:

- Archive
