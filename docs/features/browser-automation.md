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
- **Find elements by text** - "Find the login button"
- **Take screenshots** - "Take a screenshot of the current view"

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

- `click_element` - Click tagged elements
- `type_text` - Type into input fields
- `scroll_page` - Scroll up/down
- `read_page` - Get full page content
- `navigate` - Go to URLs
- `create_tab` - Open new tabs
- `switch_tab` - Switch between tabs
- `close_tab` - Close tabs
- `hover_element` - Hover over elements
- `find_element` - Find elements by text
- `take_screenshot` - Capture viewport

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
