---
id: agent.reflection.pivot
version: v2
description: Strategy pivot reflection when repeated approaches fail.
---
STRATEGY PIVOT — Your previous approach is not working. History has been reset.

Failed approaches (DO NOT retry):
{{attemptSummary}}

Classify the failure, then investigate:
- **Wrong element targeted**: Use find_element or inspect_hidden to locate the real target.
- **Element not responding**: Use execute_js to check event listeners, or try press_key as alternative.
- **Page not updating**: Call read_page to refresh perception. Check if action triggered an AJAX load.
- **Navigation stuck**: Try a different URL path or use go_back/go_forward.
- **Unknown blocker**: Use xray_page + inspect_hidden to scan for hidden overlays or intercepting elements.

Do not repeat failed actions. If the task seems impossible on this page, navigate elsewhere or call done() explaining why.
