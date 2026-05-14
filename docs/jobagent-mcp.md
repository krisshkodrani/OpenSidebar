# JobAgent MCP

OpenSidebar connects to JobAgent as a separate local MCP HTTP service. The Chrome extension does not launch stdio commands and does not import files from the JobAgent repository.

Start JobAgent separately:

```powershell
cd C:\Users\k_shk\Projects\JobAgent
$env:JOBAGENT_MCP_TOKEN="local-dev-token"
$env:JOBAGENT_MCP_ALLOWED_ORIGINS="http://localhost,http://127.0.0.1"
corepack pnpm run mcp:http
```

Then enable JobAgent MCP in OpenSidebar Settings and configure:

```text
URL: http://127.0.0.1:3727/mcp
Bearer token: local-dev-token
```

If JobAgent returns HTTP 403, include the Chrome extension origin in `JOBAGENT_MCP_ALLOWED_ORIGINS`, for example `chrome-extension://<extension-id>`.

OpenSidebar exposes these JobAgent-backed tools:

- `list_application_packages`
- `get_application_package`
- `suggest_form_answers`
- `get_candidate_profile`
- `answer_candidate_question`
- `record_application_status`

There is intentionally no `submit_application` tool. OpenSidebar may fill or suggest application answers, but final submission remains approval-gated and manual in the browser workflow.
