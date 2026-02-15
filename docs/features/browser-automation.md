# Browser Automation

OpenSidebar can navigate, read, click, type, and scroll across web pages — all from natural language commands.

## How It Works

OpenSidebar sees web pages through distilled DOM snapshots where interactive elements are tagged with numeric IDs like `[1]`, `[2]`, `[3]`. When you ask it to interact with a page, it references these exact IDs to perform actions.

## Capabilities

### Basic Interactions

- **Click buttons and links** - "Click the Submit button"
- **Fill forms** - "Type 'john@example.com' in the email field"
- **Scroll pages** - "Scroll down to see more content"
- **Read content** - "Read the entire article for me"

### Navigation

- **Go to websites** - "Navigate to google.com"
- **Open new tabs** - "Open Amazon in a new tab"
- **Switch between tabs** - "Switch to the GitHub tab"
- **Close tabs** - "Close the current tab"

### Advanced Interactions

- **Hover over elements** - "Hover over the menu to see options"
- **Find elements by text** - "Find the login button" (returns a tag ID for interaction)
- **Take screenshots** - "Take a screenshot of the current view" (analyzed by vision LLM)
- **Select dropdown options** - "Select 'United States' from the country dropdown"
- **Press keyboard keys** - "Press Enter" or "Press Ctrl+A to select all"
- **Drag and drop** - "Drag the item to the shopping cart"
- **Draw on canvas** - "Draw a line across the canvas element"
- **Hide overlays** - "Hide the cookie banner that's blocking the page"

### Modal Auto-Dismiss

On page load, OpenSidebar automatically detects and dismisses common cookie consent banners, overlay modals, and notification popups to keep the page interactive for the agent.

## Element Tagging System

Interactive elements on each page are automatically tagged with visible numbers:

```
[1] <button> "Search"
[2] <input type="email" placeholder="Enter email">
[3] <a href="/about"> "About Us"
```

The AI sees these tags and uses them to interact with the page. For example, to click the Search button, it calls `click_element(id=1)`.

## Safety & Control

### Risk Levels

Each action is classified by risk level:

- **LOW** - Read-only actions (reading, scrolling)
- **MEDIUM** - Mutates page state (clicking, typing)
- **HIGH** - Navigation and tab management

### Stop Button

You can stop the agent at any time by clicking the Stop button in the side panel. This is the primary safety mechanism.

### Per-Tab Isolation

The agent can only interact with tabs in the current workspace. Each workspace is isolated from others.

## Example Commands

### Form Filling

```
"Fill out the login form with username 'user123' and password 'pass456'"
"Enter my email 'john@example.com' in the newsletter signup"
```

### Navigation & Research

```
"Go to amazon.com and search for 'wireless headphones'"
"Open GitHub in a new tab and search for 'react hooks'"
```

### Content Interaction

```
"Click the 'Accept Cookies' button"
"Scroll down to the bottom of the article"
"Read all the product reviews on this page"
```

### Multi-step Tasks

```
"Go to Google Flights, search for flights from NYC to Paris, and find the cheapest option"
```

## Best Practices

1. **Be specific** - Use button text and element descriptions you can see
2. **Break down complex tasks** - Multi-step tasks work better than single complex requests
3. **Use memory for repeated information** - "Remember that I live in New York" saves preferences for future sessions

## Technical Details

### Tools Used

### Tools Used

**DOM Interaction:**
- `click_element` - Click tagged elements
- `type_text` - Type into input fields
- `scroll_page` - Scroll up/down (supports scrolling within container elements)
- `read_page` - Get full page content
- `hover_element` - Hover over elements
- `find_element` - Find elements by text, scroll to match, and return tag ID for interaction
- `select_option` - Select dropdown `<select>` options by text or value
- `press_key` - Dispatch keyboard events (with optional modifiers)
- `drag_and_drop` - Full drag sequence between two tagged elements
- `draw_stroke` - Mouse stroke on canvas elements (interpolated points)
- `hide_element` - Hide an element via `display: none` (useful for dismissing overlays)
- `read_element` - Read text content of a specific element
- `right_click` - Right-click context menu
- `set_checkbox` - Set checkbox state (true/false)
- `click_coordinates` - Click at specific X,Y coordinates
- `inspect_hidden` - Inspect hidden elements

**Navigation & Tabs:**
- `navigate` - Go to URLs
- `create_tab` - Open new tabs
- `switch_tab` - Switch between tabs
- `close_tab` - Close tabs
- `group_tabs` - Create a tab group
- `ungroup_tabs` - Remove tabs from a group
- `list_tabs` - List all open tabs
- `go_back` - Navigate back in history
- `go_forward` - Navigate forward in history
- `create_window` - Open a new browser window

**System & Utility:**
- `take_screenshot` - Capture viewport (analyzed by vision LLM for text description)
- `wait` - Pause execution for a specified duration
- `escalate` - Switch to a smarter model for complex reasoning
- `done` - Mark task as complete
- `update_plan` - Update the current plan
- `execute_js` - Execute custom JavaScript (High Risk)
- `upload_file` - Upload a file to a form
- `download_file` - Download a file from a URL
- `transcribe_audio` - Transcribe audio from the current tab
- `get_cookies` - Get cookies for the current domain
- `set_cookie` - Set a cookie
- `delete_cookie` - Delete a cookie
- `copy_to_clipboard` - Copy text to clipboard
- `read_pdf` - Read text content from a PDF
- `search_history` - Search browser history
- `create_bookmark` - Create a new bookmark
- `get_bookmarks` - List bookmarks
- `send_notification` - Send a browser notification
- `memory_add` - Save information to long-term memory
- `memory_search` - Search long-term memory

### DOM Snapshot Format

The AI receives a distilled representation of each page:

- Tagged interactive elements with attributes
- Visible text content (truncated for readability)
- Page metadata (title, URL, scroll position)

This allows the agent to understand page structure without seeing the raw HTML.

## See Also

- [Memory System](./memory-system.md) - Store and recall information
- [Workspace Management](./workspace-management.md) - Organize related tabs
- [Architecture Overview](../architecture/overview.md) - Technical details
