# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.5.x   | ✅ Yes    |
| 0.4.x   | ✅ Yes    |
| 0.3.x   | ✅ Yes    |
| 0.2.x   | ✅ Yes    |
| 0.1.x   | ❌ No     |

## Reporting Security Issues

If you discover a security vulnerability, please email security@qsidebar.dev with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

Do NOT open public issues for security vulnerabilities.

## Security Measures

### API Key Storage

- API keys are stored in `chrome.storage.sync`
- Chrome encrypts this data at rest
- Keys never leave your browser
- No telemetry or external logging

### Data Privacy

- All memory data stays in browser IndexedDB
- No external servers (except LLM APIs)
- No analytics or tracking
- No data collection

### URL Sanitization

- Only http/https protocols allowed
- URL validation before navigation
- Risk classification for tools

### Local-Only Operation

- SQLite database: Local only
- Vector embeddings: Local only
- Search index: Local only
- PDF processing: Local only
