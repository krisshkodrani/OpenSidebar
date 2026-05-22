# Security & Privacy

OpenSidebar is designed around local-first BYOK operation, explicit browser permissions, configurable safety gates, and transparent agent actions.

## Privacy First

### Local-First Data Storage

- **No OpenSidebar-hosted relay** - Normal extension use sends model requests directly to your configured provider
- **Local settings and keys** - Extension settings, provider keys, workspace data, and diagnostics are stored in browser storage
- **Provider-bound task data** - Page context and screenshots may be sent to the selected model provider when needed for an active task
- **Browser encryption** - Chrome encrypts stored data at rest
- **IndexedDB isolation** - Each extension has separate storage

### Workspace Isolation

- **Tab group boundaries** - AI can't access tabs outside current workspace
- **Permission checks** - Every action validates workspace membership
- **Session isolation** - Different activities kept completely separate

## Risk Classification

All AI actions are classified by risk level:

### LOW RISK (Read-only)

- **Reading pages** - `read_page`, `read_element`, `read_pdf`
- **Scrolling** - `scroll_page`
- **Inspection** - `hover_element`, `find_element`, `inspect_hidden`, `list_tabs`, `get_cookies`, `search_history`, `get_bookmarks`
- **Utility** - `wait`, `escalate`, `transcribe_audio`, `copy_to_clipboard`

### MEDIUM RISK (State Changes)

- **Interaction** - `click_element`, `type_text`, `select_option`, `press_key`, `drag_and_drop`, `draw_stroke`, `right_click`, `set_checkbox`, `click_coordinates`
- **Modification** - `hide_element`
- **Files** - `upload_file`, `download_file`
- **Tabs** - `switch_tab`, `group_tabs`, `ungroup_tabs`, `create_bookmark`

### HIGH RISK (Navigation & System)

- **Navigation** - `navigate`, `go_back`, `go_forward`
- **Tab/Window Management** - `create_tab`, `close_tab`, `create_window`
- **System** - `execute_js` (Arbitrary Code Execution), `set_cookie`, `delete_cookie`

### Risk Source of Truth

Risk classifications are defined in `src/background/tools/metadata.ts` as the `TOOL_META` map. The `getToolMeta(name)` function is used by `security.ts`'s `classifyRisk()`. This centralizes all tool properties (risk, domModifying, sequential) in a single location.

### Risk Display

- **Visual indicators** - Tool badges show risk levels
- **Transparency** - You see exactly what actions were taken
- **Configurable gates** - Settings can require plan confirmation or approval for high-risk actions

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

- **Chrome extension storage** - API keys are stored in Chrome extension storage
- **No page storage** - Keys are not stored in website `localStorage`
- **Permission boundaries** - Keys only accessible to extension

### Key Usage

- **Direct to providers** - Keys are sent directly to the configured model providers
- **No intermediaries** - No proxy servers or data collection
- **HTTPS only** - All API calls encrypted in transit

### Key Management

- **User control** - You control your own API keys
- **Revocation** - Keys can be revoked at provider level
- **Rotation** - Support for key changes and updates

## Agent Interaction Model

### Configurable Operation

OpenSidebar supports configurable confirmation behavior:

1. **Ask before acting** - require confirmation before actions
2. **Ask for risky actions** - require approval for high-risk operations
3. **Confirm plans only** - review multi-step plans before execution
4. **Act without asking** - allow autonomous execution after the user starts a task

### Why Configurable Gates?

- **Different risk tolerance** - Users can choose conservative or fast modes
- **Multi-step tasks** - Plan confirmation can reduce repeated interruptions
- **Sensitive actions** - Risky operations can require explicit approval
- **Efficiency** - Advanced users can run trusted workflows with fewer prompts

### Safety Mechanisms

- **Stop button** - Immediate termination of any action
- **Risk awareness** - High-risk actions can be approved, logged, and displayed
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

### Reduced Threats

- **Unexpected data sharing** - No OpenSidebar-hosted telemetry or relay; provider traffic is tied to the user's configured key
- **Cross-site scripting** - Content script sandboxing prevents XSS
- **Man-in-the-middle** - HTTPS encryption prevents interception
- **Key theft** - Chrome's encrypted storage protects API keys
- **Malicious sites** - Risk classification, approvals, and workspace boundaries reduce dangerous actions

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
- **Data locality** - Local extension data stays in browser storage; provider traffic follows the selected provider's terms and policies
- **Right to deletion** - Users can delete local extension data through Chrome extension storage and profile controls

## Best Practices for Users

### Secure Usage

1. **Protect API keys** - Never share your provider API keys
2. **Review actions** - Watch what the AI does on your behalf
3. **Use HTTPS** - Prefer secure websites when possible
4. **Regular cleanup** - Clear conversation history periodically
5. **Update regularly** - Keep extension and Chrome updated

### Privacy Tips

1. **Workspace isolation** - Use separate workspaces for different activities
3. **Public computers** - Avoid using on shared devices
4. **Understand limits** - Know what the extension can and cannot do

## Security Updates

### Patch Process

- **GitHub releases** - Broad OSS launch uses GitHub release artifacts and manual unpacked install first
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
- [Workspace Management](./workspace-management.md) - Tab isolation
- [Architecture Overview](../architecture/overview.md) - Technical security implementation
