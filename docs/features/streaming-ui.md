# Streaming UI

OpenSidebar provides real-time streaming responses from AI models, showing text and actions as they happen.

## How It Works

The streaming system delivers AI responses character-by-character, providing immediate feedback and reducing perceived wait times.

### Real-Time Display

- **Character-by-character** - Text appears as it's generated
- **Action indicators** - Shows what the AI is doing in real-time
- **Status updates** - Current state (Thinking, Acting, etc.)
- **Tool execution** - Live updates when AI interacts with pages

### Technical Flow

```
AI Model (OpenRouter)
    ↓
Server-Sent Events (SSE) Stream
    ↓
Background Service Worker
    ↓
Side Panel UI (React)
    ↓
Real-time text display
```

## User Interface

### Message Display

- **User messages** - Your questions and commands
- **AI responses** - Streamed character-by-character
- **Tool calls** - Visual indicators for actions taken
- **Error messages** - Clear error display when issues occur

### Status Indicators

The side panel shows current AI state:

- **IDLE** - Ready for your input
- **THINKING** - AI is generating a response
- **ACTING** - AI is executing tools (clicking, typing, etc.)
- **WAITING_FOR_PAGE_LOAD** - Waiting for page navigation
- **PAUSED** - Agent paused by user (awaiting resume)
- **ERROR** - Something went wrong

### Tool Execution Display

When the AI performs actions, you see:

```
[🔍] Reading page content...
[🖱️] Clicking element [12] "Search Button"
[⌨️] Typing "search query" in element [15]
[📄] Navigating to https://example.com
[📚] Adding to memory: "User prefers window seats"
```

## Performance Features

### OpenRouter Models

- **Gemini 2.0 Flash** - Fast model for initial responses (~3000 tok/s)
- **Claude Sonnet 4.5** - Smart model, activated via automatic escalation when stuck
- **Automatic switching** - Agent starts fast, escalates to smart model if needed

## Streaming Architecture

### Server-Sent Events (SSE)

The system uses Chrome's native SSE support:

```typescript
const response = await fetch(apiUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request),
});

const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
```

### Delta Accumulation

Text and tool calls are accumulated in real-time:

- **Text chunks** - Appended to current message
- **Tool calls** - Built up across multiple chunks
- **Complete response** - Finalized when stream ends

### Error Recovery

- **Connection drops** - Automatic retry with exponential backoff
- **Partial responses** - Graceful handling of incomplete streams
- **Rate limiting** - Built-in handling for API limits

## User Controls

### Stop Button

Click Stop at any time to:

- **Abort current request** - Immediately stop AI processing
- **Preserve conversation** - Keep what was already generated
- **Maintain context** - Resume with new command if needed

### Input Controls

- **Send button** - Submit your message
- **Clear history** - Start fresh conversation
- **Settings** - Configure API keys and preferences

## Visual Design

### Message Bubbles

- **User messages** - Right-aligned, blue background
- **AI responses** - Left-aligned, white background
- **Streaming indicator** - Pulsing cursor while generating
- **Tool badges** - Small icons showing executed tools

### Typography

- **Monospace** - For technical information and IDs
- **Sans-serif** - For natural language text
- **Clear hierarchy** - Different sizes for headers vs content

### Dark Mode

- **Automatic detection** - Respects system dark mode preference
- **High contrast** - Good readability in both modes
- **Consistent design** - All components styled consistently

## Responsive Behavior

### Side Panel Sizing

- **Default width** - 400px optimal for most content
- **Resizable** - Drag edge to make wider or narrower
- **Minimum width** - 300px for usability
- **Maximum width** - 800px for very wide screens

### Scroll Handling

- **Auto-scroll** - Follows streaming content automatically
- **Manual scroll** - User can scroll to read previous content
- **Smooth scrolling** - Animated transitions when jumping to content

### Content Adaptation

- **Code blocks** - Syntax highlighted and scrollable
- **Links** - Clickable with proper styling
- **Tool results** - Formatted for readability

## Accessibility

### Keyboard Navigation

- **Tab navigation** - All interactive elements accessible
- **Keyboard shortcuts** - Enter to send, Escape to stop
- **Focus indicators** - Clear visual focus state

### Screen Reader Support

- **Semantic HTML** - Proper heading hierarchy
- **ARIA labels** - Descriptive labels for all controls
- **Live regions** - Streaming content announced properly

### Color Contrast

- **WCAG AA compliance** - Sufficient contrast ratios
- **Color-independent** - Information not conveyed by color alone
- **High contrast option** - Enhanced visibility for low vision

## Performance Optimization

### Efficient Rendering

- **Virtual scrolling** - Only renders visible messages
- **Debounced updates** - Batches UI updates efficiently
- **Memory management** - Cleans up old message data

### Network Optimization

- **Compression** - Gzip compression for all API calls
- **Caching** - Repeated content cached locally
- **Connection pooling** - Reuses network connections

## Troubleshooting

### Streaming Issues

If text doesn't appear or is choppy:

- **Check network** - Stable internet connection required
- **API key** - Valid OpenRouter API key needed
- **Browser extensions** - Try disabling other extensions temporarily

### UI Problems

If the interface looks wrong:

- **Chrome update** - Ensure you're using latest Chrome
- **Extension reload** - Try reloading OpenSidebar
- **Clear cache** - Clear browser cache and restart Chrome

### Performance Issues

If the UI is slow:

- **Too many messages** - Clear conversation history
- **Large pages** - AI processing complex pages takes time
- **Memory usage** - Close unused tabs to free resources

## See Also

- [Browser Automation](./browser-automation.md) - What AI can do
- [Memory System](./memory-system.md) - Persistent information
- [Architecture Overview](../architecture/streaming.md) - Technical details
