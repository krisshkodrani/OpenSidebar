# Profile Notes And Digest

OpenSidebar supports one local personalization surface for form and application
tasks. The profile is no longer a field-heavy schema. Users maintain markdown
**Profile Notes**, then explicitly run **Analyze Notes** to generate a compact
**Profile Digest**.

The notes are the user's source material. The digest is a reviewable index the
runtime can use conservatively.

## V2 Decisions

1. Profile Notes are stored locally in the browser runtime storage adapter.
2. Digest analysis is explicit; it is not run on every edit.
3. Fireworks Kimi K2.6 is the initial analyzer when a Fireworks key is
   configured.
4. The digest is stale when the notes hash, digest schema version, or analyzer
   version changes.
5. V2 supports only one local notes profile. Multiple personas are out of scope.
6. Job-application-specific fields are not first-class profile schema.

## Runtime Behavior

- The sidepanel stores profile state under `opensidebar:personalProfile`.
- The overlay harness uses the same storage port shape with its local adapter.
- The planner receives only selected digest items relevant to the task.
- The full markdown notes are not injected into normal runtime prompts.
- The agent may use digest facts for exact matching fields.
- The agent may use preferences to choose among clear visible options.
- The agent treats constraints as hard boundaries.
- The agent may use themes for drafting, not exact form values.
- Sensitive items are excluded unless the user explicitly asks to use them.
- Open questions are never used for filling; they are unresolved context.
- If a field cannot be filled safely, the harness reports it at the end instead
  of guessing.
- Final submission of applications remains covered by the normal approval flow.

## Supported Shape

The v2 personalization state is intentionally small:

- `notesMarkdown`: user-owned markdown source notes.
- `notesHash`: content hash used for stale digest detection.
- `digest.items`: flat list of extracted digest items.
- `analyzer`: provider/model/version/timestamp metadata for the latest saved
  digest.

Digest item kinds:

- `fact`
- `preference`
- `constraint`
- `theme`
- `sensitive`
- `open_question`

## Profile Notes Template

The UI offers this starter structure as a placeholder, not as required fields:

```md
# About me

# Contact and links

# Work preferences

# Availability

# Authorization and relocation

# Writing style

# Things to avoid

# Sensitive / do not use
```

## Field Requests

The compatibility tool `get_profile_fields` now reads exact fact-like values
from a ready Profile Digest. It accepts labels or path-like names:

```json
{ "fields": ["full_name", "email", "location"] }
```

If profile use is off, notes are missing, the digest is stale, or no matching
fact exists, the tool reports missing fields. The agent must not infer missing
values from themes or preferences.

## Privacy Notes

Profile values are local to the runtime storage adapter by default. Running
analysis sends the markdown notes to the configured model provider only after
the user clicks **Analyze Notes**.

Trace recording should redact digest values after they are returned by
`get_profile_fields`, including later tool arguments and model messages that
contain those exact values. Screenshots can still show page content by design.
