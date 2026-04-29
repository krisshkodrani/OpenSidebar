# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.5.x   | ✅ Yes    |
| 0.4.x   | ✅ Yes    |
| 0.3.x   | ✅ Yes    |
| 0.2.x   | ✅ Yes    |
| 0.1.x   | ❌ No     |

## Security Measures

### API Key Storage

- API keys are stored in `chrome.storage.local`
- Chrome encrypts this data at rest
- Keys are only sent to configured model providers over HTTPS for authentication
- No telemetry or external logging

### Data Privacy

- All data stays in local browser storage
- No external servers (except LLM APIs)
- No analytics or tracking
- No data collection

### URL Sanitization

- Only http/https protocols allowed
- URL validation before navigation
- Risk classification for tools
