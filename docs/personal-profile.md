# Personal Profile

OpenSidebar can read exact fields from a local YAML profile when it needs to fill forms.

## Default Path

On Windows, the default path is:

```text
%USERPROFILE%\.opensidebar\profiles\default.yaml
```

You can override it with:

```text
OPENSIDEBAR_PROFILE_PATH=C:\path\to\your\profile.yaml
```

## Format

The file must contain a top-level `profile` object. Field requests are relative to that root.

Example:

```yaml
profile:
  identity:
    first_name: Kai
    last_name: Schmidt
    full_name: Kai Schmidt
    email: kai@example.com
    phone: "+49 170 1234567"

  address:
    line1: Musterstrasse 12
    line2: ""
    city: Berlin
    state: Berlin
    postal_code: "10115"
    country: Germany

  work:
    company: Example GmbH
    title: Product Engineer

  files:
    cv:
      path: cv.pdf
      mime_type: application/pdf

  context:
    safe:
      professional_summary: Senior frontend engineer focused on React, TypeScript, and browser automation.
      job_preferences:
        roles:
          - Frontend Engineer
          - Product Engineer
        remote: true
        locations:
          - Berlin
          - Remote
        salary_range: 120K-160K
      work_authorization: Authorized to work in Germany.

  preferences:
    default_country: Germany
    preferred_language: en

  sensitive:
    date_of_birth: "1990-01-01"
```

## Runtime Behavior

- The agent should request only the exact fields it needs.
- Non-secret values under `context.safe` may be injected as compact task-relevant personal context.
- Exact form values such as name, email, phone, and address are still retrieved through `get_profile_fields`.
- `files.cv.path` is resolved relative to the profile file directory and can be uploaded with `upload_file` using `profileFile: "cv"`.
- Normal fields like `identity.first_name` are treated as low-risk reads.
- Fields under `sensitive.*` are treated as high-risk and go through the existing approval flow.
- The full profile is not injected into prompts by default.

## Local CV Setup

Keep profile files and CVs out of git. A recommended local layout for development is:

```text
.artifacts/personal-info/default.yaml
.artifacts/personal-info/cv.pdf
```

Point the backend at that profile:

```text
OPENSIDEBAR_PROFILE_PATH=C:\Users\k_shk\Projects\OpenSidebar\.artifacts\personal-info\default.yaml
```

The default `cv` alias is the only profile file alias currently supported. Files must stay under the profile directory and must be 10MB or smaller.

## Example Field Paths

- `identity.first_name`
- `identity.last_name`
- `identity.email`
- `address.line1`
- `address.city`
- `address.postal_code`
- `preferences.default_country`
- `sensitive.date_of_birth`
