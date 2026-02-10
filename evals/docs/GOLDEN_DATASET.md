# Golden Dataset Guide

The golden dataset defines expected behavior for specific scenarios, enabling automated testing and regression detection.

## What is a Golden Case?

A golden case is a YAML file that defines:

1. **Input**: DOM state and user query
2. **Expected**: Correct tool calls, text responses, and outcomes
3. **Metadata**: Tags, difficulty, categorization

Golden cases serve as the "ground truth" for evaluating your agent's performance.

## Creating a Golden Case

### Basic Structure

```yaml
id: unique-identifier
version: "1.0"
created_at: "2024-01-15"
description: Brief description of what this case tests

input:
  url: https://example.com/page
  dom_snapshot: |
    <html>
      <body>
        <!-- Your HTML here -->
      </body>
    </html>
  user_query: "What should the agent do?"
  viewport:
    width: 1280
    height: 720

expected:
  tool_calls:
    - tool: click_element
      params:
        tag: 1
      reasoning: Why this tool is used
  assistant_text_pattern: "Expected response text"
  outcome:
    success: true

metadata:
  tags:
    - navigation
    - forms
  difficulty: easy
  expected_steps: 3
  category: web-navigation
```

### Input Section

#### URL

The page URL provides context but doesn't need to be reachable (we use mock DOM).

```yaml
url: https://google.com
```

#### DOM Snapshot

Provide the HTML that represents the page state. Use the `|` YAML syntax for multi-line strings.

```yaml
dom_snapshot: |
  <html>
    <head><title>Page Title</title></head>
    <body>
      <input type="text" id="search" />
      <button id="submit">Search</button>
    </body>
  </html>
```

**Tips:**

- Keep snapshots minimal (only relevant elements)
- Include element IDs for easier reference
- Ensure interactive elements are visible (no `display: none`)

#### User Query

What the user asks the agent to do.

```yaml
user_query: "Search for flights to Paris"
```

#### Viewport (Optional)

Screen dimensions for responsive testing.

```yaml
viewport:
  width: 1280
  height: 720
```

### Expected Section

#### Tool Calls

The sequence of tools the agent should use.

```yaml
tool_calls:
  - tool: click_element
    params:
      tag: 1
    reasoning: Focus the input field first
    optional: false

  - tool: type_text
    params:
      tag: 1
      text: "search query"
    reasoning: Enter the search term
```

**Fields:**

- `tool`: ToolName enum value (e.g., `click_element`, `type_text`)
- `params`: Tool-specific parameters
- `reasoning`: Why this tool is used (for documentation)
- `optional`: If true, test won't fail if this step is skipped

**Available Tools:**

- `click_element` - Click a tagged element
- `type_text` - Type text into input
- `scroll_page` - Scroll the page
- `read_page` - Read DOM snapshot
- `navigate` - Navigate to URL
- `wait` - Wait for duration
- `done` - Mark task complete

#### Assistant Text

Expected text response from the agent.

```yaml
assistant_text: "I'll search for flights to Paris for you."
```

Or use a pattern for partial matching:

```yaml
assistant_text_pattern: "*search*flights*Paris*"
```

#### Outcome

Success criteria for the final state.

```yaml
outcome:
  success: true
  page_url_pattern: "example.com/search"
  page_contains: "search results"
```

**Fields:**

- `success`: Boolean indicating overall success
- `page_url_pattern`: URL should contain this string
- `page_contains`: Page content should contain this string
- `custom_validator`: Name of custom validation function (advanced)

### Metadata Section

#### Tags

Categorize the case for filtering.

```yaml
tags:
  - navigation
  - search
  - forms
  - multi-step
```

Common tags:

- `navigation` - Page navigation tests
- `search` - Search functionality
- `forms` - Form filling/submission
- `click` - Click interactions
- `text-input` - Typing text
- `multi-step` - Multi-step workflows

#### Difficulty

Estimate of case complexity.

```yaml
difficulty: easy # easy, medium, hard
```

- **easy**: Single action, clear UI
- **medium**: Multiple steps, some ambiguity
- **hard**: Complex workflows, edge cases

#### Expected Steps

Number of tool calls expected.

```yaml
expected_steps: 3
```

#### Category

High-level categorization.

```yaml
category: web-navigation # web-navigation, form-interaction, data-extraction
```

## Best Practices

### 1. Start Simple

Create easy cases first to establish baseline:

```yaml
id: simple-click-001
difficulty: easy
input:
  dom_snapshot: |
    <button id="btn">Click Me</button>
  user_query: "Click the button"
expected:
  tool_calls:
    - tool: click_element
      params:
        tag: 1
```

### 2. Be Specific

Don't create overly broad test cases:

❌ Bad: "Do everything on this page"
✅ Good: "Fill out the login form with provided credentials"

### 3. Document Reasoning

Include reasoning for each tool call:

```yaml
tool_calls:
  - tool: click_element
    params:
      tag: 1
    reasoning: "Focus the search input before typing"
```

### 4. Use Tags Effectively

Tag cases for targeted testing:

```yaml
# Run only form tests
bun evals --tag forms

# Run everything except slow tests
bun evals --tag "!slow"
```

### 5. Version Your Cases

Update the version when modifying cases:

```yaml
version: "1.1"
```

This helps track changes and understand regressions.

### 6. Include Edge Cases

Test error conditions and edge cases:

```yaml
id: hidden-element-001
description: Test that agent handles hidden elements
difficulty: hard
input:
  dom_snapshot: |
    <button style="display:none">Hidden</button>
    <button>Visible</button>
  user_query: "Click the button"
expected:
  # Should fail because hidden element is not interactive
  outcome:
    success: false
```

## Organizing Your Golden Dataset

### Directory Structure

```
golden/
├── cases/
│   ├── navigation/           # Navigation tests
│   │   ├── google-search.yaml
│   │   └── page-links.yaml
│   ├── forms/                # Form tests
│   │   ├── login.yaml
│   │   ├── signup.yaml
│   │   └── checkout.yaml
│   ├── search/               # Search tests
│   │   ├── basic-search.yaml
│   │   └── advanced-search.yaml
│   └── edge-cases/           # Edge cases
│       ├── hidden-elements.yaml
│       └── error-states.yaml
```

### Naming Conventions

Use descriptive IDs:

```
{category}-{action}-{variant}

Examples:
- search-google-001
- form-login-002
- nav-menu-dropdown-001
```

### Grouping by Category

Organize cases by functionality:

```bash
# Run all navigation tests
bun evals --category navigation

# Run all form tests
bun evals --category forms
```

## Managing Large Datasets

### Statistics

Check dataset health:

```bash
bun evals --stats
```

Output:

```
Total Cases: 50

By Difficulty:
  easy: 30
  medium: 15
  hard: 5

By Tag:
  navigation: 20
  forms: 15
  search: 10
  edge-cases: 5
```

### Prioritizing Tests

Run critical tests first:

```yaml
# In metadata
tags:
  - critical
  - smoke-test
```

```bash
# Run smoke tests
bun evals --tag smoke-test

# If smoke tests pass, run full suite
bun evals
```

### Maintenance

Regularly review and update cases:

1. **Quarterly Review**: Check if cases still reflect current behavior
2. **Remove Obsolete**: Delete cases for removed features
3. **Add Coverage**: Create cases for new features
4. **Update Difficulty**: Adjust difficulty ratings as agent improves

## Advanced: Dynamic Cases

For cases with dynamic content, use placeholders:

```yaml
id: dynamic-content-001
input:
  dom_snapshot: |
    <div class="timestamp">{{current_time}}</div>
    <button id="refresh">Refresh</button>
  user_query: "Click the refresh button"
expected:
  # Only validate button click, ignore dynamic content
  tool_calls:
    - tool: click_element
      params:
        tag: 2 # Tag for refresh button only
```

## Testing Your Cases

Before adding to the dataset, test manually:

```bash
# Run single case
bun evals --id search-google-001

# Run with verbose output
bun evals --id search-google-001 --format json
```

## Example Cases

See `golden/cases/` for examples:

- `search-google-001.yaml` - Basic search
- `login-form-001.yaml` - Multi-step form
- `navigate-and-extract.yaml` - Page navigation and data extraction

## Troubleshooting

### Case Not Found

```
Error: Case 'xyz' not found
```

- Check file is in `golden/cases/` directory
- Verify YAML syntax with online validator
- Ensure `id` field matches filename

### Validation Errors

```
Invalid golden case: Missing required field: input.url
```

Check all required fields are present:

- `id`
- `input.url`
- `input.dom_snapshot`
- `input.user_query`
- `expected`
- `metadata.tags`
- `metadata.difficulty`

### DOM Not Loading

If snapshot doesn't appear in evaluation:

- Ensure proper YAML indentation
- Check for unclosed HTML tags
- Verify no special characters need escaping
