# Security & Privacy

OpenSidebar is designed with security and privacy as fundamental principles, keeping your data safe while providing powerful AI capabilities.

## Privacy First

### Local Data Storage

- **Everything stays local** - All data stored in your browser only
- **No cloud uploads** - Your information never leaves your device
- **Browser encryption** - Chrome encrypts stored data at rest
- **IndexedDB isolation** - Each extension has separate storage

### Memory Privacy

- **Personal data stays private** - Memories stored locally only
- **Search happens locally** - Semantic search runs in your browser
- **No tracking** - We don't track what you store or search for
- **User control** - Full control over saved memories

### Workspace Isolation

- **Tab group boundaries** - AI can't access tabs outside current workspace
- **Permission checks** - Every action validates workspace membership
- **Session isolation** - Different activities kept completely separate

## Risk Classification

All AI actions are classified by risk level:

### LOW RISK (Read-only)

- **Reading pages** - `read_page` tool
- **Scrolling** - `scroll_page` tool
- **Memory search** - `memory_search` tool
- **Taking screenshots** - `take_screenshot` tool
- **Hovering** - `hover_element` tool
- **Finding elements** - `find_element` tool
- **Waiting** - `wait` tool

### MEDIUM RISK (State Changes)

- **Clicking elements** - `click_element` tool
- **Typing text** - `type_text` tool
- **Memory additions** - `memory_add` tool
- **Selecting options** - `select_option` tool
- **Pressing keys** - `press_key` tool
- **Drag and drop** - `drag_and_drop` tool
- **Drawing on canvas** - `draw_stroke` tool
- **Hiding elements** - `hide_element` tool
- **Task completion** - `done` tool

### HIGH RISK (Navigation & System)

- **Navigation** - `navigate` tool
- **Tab management** - `create_tab`, `close_tab`, `switch_tab`

### Risk Source of Truth

Risk classifications are defined in `src/background/tools/metadata.ts` as the `TOOL_META` map. The `getToolMeta(name)` function is used by `security.ts`'s `classifyRisk()`. This centralizes all tool properties (risk, domModifying, sequential) in a single location.

### Risk Display

- **Visual indicators** - Tool badges show risk levels
- **Transparency** - You see exactly what actions were taken
- **No blocking** - Agent acts autonomously (confirmed by Stop button)

## Input Sanitization

### User Input Protection

```typescript
// Prevents null byte injection
function sanitizeUserInput(text: string): string {
  return text.replace(/\0/g, "").slice(0, 10_000);
}
```

### URL Validation

```typescript
// Only allows HTTP/HTTPS protocols
function sanitizeUrl(url: string): Result<string> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: `Blocked: ${parsed.protocol}` };
  }
  return { ok: true, value: parsed.href };
}
```

### Content Limits

- **Input truncation** - Maximum 10,000 characters per request
- **Tool output limits** - Prevents excessive response sizes
- **Context window** - Automatic truncation prevents model overflow

## API Key Security

### Secure Storage

- **Chrome storage.sync** - Encrypted by Google account
- **No local storage** - Keys never stored in plain text
- **Permission boundaries** - Keys only accessible to extension

### Key Usage

- **Direct to providers** - Keys sent directly to OpenRouter
- **No intermediaries** - No proxy servers or data collection
- **HTTPS only** - All API calls encrypted in transit

### Key Management

- **User control** - You control your own API keys
- **Revocation** - Keys can be revoked at provider level
- **Rotation** - Support for key changes and updates

## Agent Autonomy Model

### Autonomous Operation

OpenSidebar operates without confirmation gates:

1. **User intent established** - You typed a request and clicked Send
2. **Agent executes** - AI performs needed actions autonomously
3. **Stop button safety** - You can abort at any time
4. **Transparency** - All actions shown after execution

### Why No Confirmation Gates?

- **Multi-step tasks** - Would require dozens of confirmations
- **User experience** - Constant confirmations break workflow
- **Industry standard** - Modern AI assistants operate similarly
- **Efficiency** - Autonomous execution is more practical

### Safety Mechanisms

- **Stop button** - Immediate termination of any action
- **Risk awareness** - High-risk actions logged and displayed
- **Workspace isolation** - Actions limited to current context
- **Recovery** - Graceful error handling and rollback

## Data Protection

### Browser Sandbox

- **Extension isolation** - Each extension runs in isolated environment
- **Content script sandbox** - Limited access to web page content
- **Service worker limits** - Restricted Chrome API access
- **Memory separation** - No shared memory between extensions

### Network Security

- **HTTPS enforcement** - All external connections use HTTPS
- **Certificate validation** - Proper SSL certificate verification
- **No mixed content** - No HTTP resources on HTTPS pages
- **CORS compliance** - Proper cross-origin request handling

### Storage Security

- **IndexedDB quotas** - Browser enforces storage limits
- **Data encryption** - Chrome encrypts at rest
- **No file system access** - Extension cannot read local files
- **Clean uninstall** - Data removed on uninstall (optional)

## Monitoring & Logging

### Local Logging

- **Structured logging** - Consistent log format for debugging
- **Local only** - Logs never sent to external servers
- **Error tracking** - Errors logged for user troubleshooting
- **Performance metrics** - Local performance monitoring

### User Visibility

- **Tool execution logs** - All actions shown in conversation
- **Error messages** - Clear error descriptions and suggested fixes
- **Status indicators** - Real-time AI state visibility
- **Permission requests** - Clear explanations for new permissions

## Threat Model

### Prevented Threats

- **Data exfiltration** - No data sent to external servers
- **Cross-site scripting** - Content script sandboxing prevents XSS
- **Man-in-the-middle** - HTTPS encryption prevents interception
- **Key theft** - Chrome's encrypted storage protects API keys
- **Malicious sites** - Risk classification prevents dangerous actions

### User Responsibilities

- **API key security** - Keep your API keys confidential
- **Review actions** - Monitor what the AI does on your behalf
- **Secure browsing** - Use HTTPS sites when possible
- **Regular updates** - Keep Chrome and extension updated

### Limitations

- **Same-origin policy** - Cannot access content from different domains
- **Browser permissions** - Limited to granted permissions
- **Local data only** - Cannot access system files or applications
- **Provider limitations** - Bound by AI provider terms and capabilities

## Compliance & Standards

### Browser Extension Standards

- **Manifest V3** - Follows latest Chrome extension standards
- **Permission minimization** - Only requests necessary permissions
- **Content Security Policy** - Strict CSP for resource loading
- **Web Vitals** - Optimized for performance and security

### Privacy Regulations

- **GDPR alignment** - Data minimization and user control principles
- **CCPA compliance** - California privacy law alignment
- **Data locality** - Data stays in user's jurisdiction
- **Right to deletion** - Users can delete all stored data

## Best Practices for Users

### Secure Usage

1. **Protect API keys** - Never share your OpenRouter API key
2. **Review actions** - Watch what the AI does on your behalf
3. **Use HTTPS** - Prefer secure websites when possible
4. **Regular cleanup** - Clear conversation history periodically
5. **Update regularly** - Keep extension and Chrome updated

### Privacy Tips

1. **Memory awareness** - Be careful what personal information you store
2. **Workspace isolation** - Use separate workspaces for different activities
3. **Public computers** - Avoid using on shared devices
4. **Backup data** - Export important memories if needed
5. **Understand limits** - Know what the extension can and cannot do

## Security Updates

### Patch Process

- **Automatic updates** - Chrome auto-updates extensions from store
- **Security patches** - Critical fixes prioritized and released quickly
- **Bug bounty** - Security researchers encouraged to report issues
- **Transparency** - Security issues disclosed responsibly

### Monitoring

- **Vulnerability scanning** - Regular security audits of code
- **Dependency updates** - Third-party libraries kept up to date
- **Security reviews** - Regular code reviews for security issues
- **Community reporting** - User reports addressed promptly

## See Also

- [Browser Automation](./browser-automation.md) - What AI can do
- [Memory System](./memory-system.md) - Local data storage
- [Workspace Management](./workspace-management.md) - Tab isolation
- [Architecture Overview](../architecture/overview.md) - Technical security implementation
