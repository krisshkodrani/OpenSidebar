# Personal Profile

OpenSidebar supports one local saved profile for form and application tasks. The
profile is edited in the sidepanel through **Personalize** and is stored in the
browser runtime storage adapter.

## V1 Decisions

1. Screenshots stay enabled by default. Personalization does not turn off debug
   screenshots after profile values are filled.
2. The **Use saved profile** toggle is persistent for the local browser profile.
3. V1 supports only one local profile. Multiple personas are out of scope.

## Runtime Behavior

- The sidepanel stores profile data under `opensidebar:personalProfile`.
- The overlay harness uses the same storage port shape with its local adapter.
- The planner only receives a short note that a saved profile is available for
  application or form tasks.
- Exact profile values are not injected into the task prompt. The agent must call
  `get_profile_fields` for specific fields before typing saved profile data.
- If profile use is off or no saved profile exists, `get_profile_fields` returns
  a disabled message and the agent should ask the user to personalize the harness
  or turn on **Use saved profile**.
- Final submission of applications remains covered by the normal approval flow.

## Supported Shape

The v1 profile schema is intentionally small and form-oriented:

- `identity`: first name, last name, preferred name, pronouns
- `contact`: email, phone, location, address
- `links`: LinkedIn, portfolio, GitHub, website
- `preferences`: roles, locations, work modes, salary, available date
- `authorization`: work authorization, sponsorship, relocation
- `answers`: availability, why interested, cover note
- `sensitive.eeo`: optional EEO answers

## Field Requests

The agent should request only the exact fields it needs:

```json
{ "fields": ["identity.first_name", "contact.email"] }
```

Common aliases are supported:

- `full_name` and `identity.full_name`
- `email`
- `phone`
- `location`

## Privacy Notes

Profile values are local to the runtime storage adapter. Trace recording redacts
profile values after they are returned by `get_profile_fields`, including later
tool arguments and model messages that contain those exact values. Screenshots
can still show page content by design, because screenshots remain enabled by
default for v1.
