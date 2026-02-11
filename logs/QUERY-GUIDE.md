# Log Query Guide

## Getting Started

Start the log server to begin capturing logs from the extension:

```bash
bun run logs
```

This starts a local HTTP server on `127.0.0.1:7589` that receives log batches from the extension and writes them to `logs/opensidebar.jsonl`. The extension automatically drains logs to this server every ~5 seconds.

## Log Format

Logs are stored in `./logs/opensidebar.jsonl` in JSON Lines format (one JSON object per line).

```json
{"ts":"2026-02-09T16:30:45.123Z","lvl":"DEBUG","src":"background","cat":"workspace","msg":"Auto-created workspace","data":{"name":"QSidebar 1","tabId":123}}
```

**Fields:**
- `ts` - ISO 8601 timestamp
- `lvl` - Log level (DEBUG, INFO, WARN, ERROR)
- `src` - Source (background, content, sidepanel, offscreen)
- `cat` - Category (agent, workspace, sidebar, tools, system, navigation, memory, keepalive)
- `msg` - Message text
- `data` - Structured data (sanitized - API keys removed)

## Quick Start with CLI Tool

```bash
# Show last 50 log entries
bun run scripts/log-query.ts tail

# Show last 100 entries
bun run scripts/log-query.ts tail 100

# Show all errors
bun run scripts/log-query.ts errors

# Filter by category
bun run scripts/log-query.ts category workspace
bun run scripts/log-query.ts category sidebar
bun run scripts/log-query.ts category agent

# Filter by level
bun run scripts/log-query.ts level ERROR
bun run scripts/log-query.ts level DEBUG

# Search for text
bun run scripts/log-query.ts search "Auto-created"

# Show statistics
bun run scripts/log-query.ts stats

# Export to CSV
bun run scripts/log-query.ts export csv > logs/export.csv

# Show help
bun run scripts/log-query.ts help
```

## jq Query Recipes

### Basic Filtering

```bash
# View last 20 lines
tail -20 logs/opensidebar.jsonl

# Pretty print JSON
jq '.' logs/opensidebar.jsonl | less

# Filter by level
jq 'select(.lvl == "ERROR")' logs/opensidebar.jsonl

# Filter by category
jq 'select(.cat == "workspace")' logs/opensidebar.jsonl

# Multiple conditions (AND)
jq 'select(.lvl == "ERROR" and .cat == "workspace")' logs/opensidebar.jsonl

# Multiple conditions (OR)
jq 'select(.lvl == "ERROR" or .lvl == "WARN")' logs/opensidebar.jsonl
```

### Workspace Analysis

```bash
# All workspace events
jq 'select(.cat == "workspace")' logs/opensidebar.jsonl

# Workspace creation events
jq 'select(.cat == "workspace" and (.msg | contains("created")))' logs/opensidebar.jsonl

# Workspace deletion events
jq 'select(.cat == "workspace" and (.msg | contains("deleted")))' logs/opensidebar.jsonl

# Workspace events with formatted output
jq 'select(.cat == "workspace") | {time: .ts, event: .msg, name: .data.name}' logs/opensidebar.jsonl

# Timeline of workspace activity
jq 'select(.cat == "workspace") | [.ts, .msg, .data.name] | @tsv' logs/opensidebar.jsonl | column -t -s $'\t'
```

### Sidebar Behavior Analysis

```bash
# All sidebar events
jq 'select(.cat == "sidebar")' logs/opensidebar.jsonl

# Sidebar opened events
jq 'select(.cat == "sidebar" and (.msg | contains("opened")))' logs/opensidebar.jsonl

# Sidebar closed events
jq 'select(.cat == "sidebar" and (.msg | contains("closed")))' logs/opensidebar.jsonl

# Sidebar events by tab
jq 'select(.cat == "sidebar") | {time: .ts, action: .msg, tab: .data.tabId}' logs/opensidebar.jsonl
```

### Agent Activity

```bash
# All agent events
jq 'select(.cat == "agent")' logs/opensidebar.jsonl

# Agent errors
jq 'select(.cat == "agent" and .lvl == "ERROR")' logs/opensidebar.jsonl

# Agent status changes
jq 'select(.cat == "agent" and (.msg | contains("status")))' logs/opensidebar.jsonl

# Tool execution
jq 'select(.cat == "tools")' logs/opensidebar.jsonl
```

### Error Analysis

```bash
# All errors
jq 'select(.lvl == "ERROR")' logs/opensidebar.jsonl

# Errors by source
jq 'select(.lvl == "ERROR") | {source: .src, category: .cat, message: .msg}' logs/opensidebar.jsonl

# Error count by category
jq -s 'map(select(.lvl == "ERROR")) | group_by(.cat) | map({category: .[0].cat, count: length})' logs/opensidebar.jsonl

# Recent errors (last 10)
jq 'select(.lvl == "ERROR")' logs/opensidebar.jsonl | tail -10

# Errors with stack traces
jq 'select(.lvl == "ERROR" and .data.stack) | {time: .ts, message: .msg, stack: .data.stack}' logs/opensidebar.jsonl
```

### Statistics & Aggregation

```bash
# Count total entries
jq -s 'length' logs/opensidebar.jsonl

# Count by level
jq -s 'group_by(.lvl) | map({level: .[0].lvl, count: length})' logs/opensidebar.jsonl

# Count by category
jq -s 'group_by(.cat) | map({category: .[0].cat, count: length})' logs/opensidebar.jsonl

# Count by source
jq -s 'group_by(.src) | map({source: .[0].src, count: length})' logs/opensidebar.jsonl

# Timeline - entries per hour
jq -s 'group_by(.ts[:13]) | map({hour: .[0].ts[:13], count: length})' logs/opensidebar.jsonl

# Most recent 100 entries
jq -s '.[-100:]' logs/opensidebar.jsonl | jq '.[]'
```

### Real-time Monitoring

```bash
# Watch all logs (like tail -f)
tail -f logs/opensidebar.jsonl

# Watch with pretty printing
tail -f logs/opensidebar.jsonl | jq '.'

# Watch only workspace events
tail -f logs/opensidebar.jsonl | jq -R 'fromjson? | select(.cat == "workspace")'

# Watch only errors
tail -f logs/opensidebar.jsonl | jq -R 'fromjson? | select(.lvl == "ERROR")'

# Watch sidebar open/close
tail -f logs/opensidebar.jsonl | jq -R 'fromjson? | select(.cat == "sidebar") | {time: .ts, action: .msg}'
```

### Advanced Queries

```bash
# Find all tab operations
jq 'select(.data.tabId) | {time: .ts, category: .cat, tab: .data.tabId, message: .msg}' logs/opensidebar.jsonl

# Search for specific text in messages
jq 'select(.msg | contains("failed"))' logs/opensidebar.jsonl

# Case-insensitive search
jq 'select(.msg | ascii_downcase | contains("error"))' logs/opensidebar.jsonl

# Find entries with specific data field
jq 'select(.data.workspaceId)' logs/opensidebar.jsonl

# Extract specific fields for all entries
jq '{timestamp: .ts, level: .lvl, message: .msg}' logs/opensidebar.jsonl

# Compact output (one line per entry)
jq -c 'select(.lvl == "ERROR")' logs/opensidebar.jsonl

# Convert to CSV
jq -r 'select(.cat == "workspace") | [.ts, .lvl, .msg, .data.name] | @csv' logs/opensidebar.jsonl
```

### Multi-file Queries (Rotated Logs)

```bash
# Query all log files (including rotated)
cat logs/opensidebar.jsonl logs/opensidebar.jsonl.1 logs/opensidebar.jsonl.2 | jq 'select(.lvl == "ERROR")'

# Count across all files
cat logs/opensidebar.jsonl* | jq -s 'length'

# Find first occurrence of an event
cat logs/opensidebar.jsonl* | jq 'select(.msg | contains("workspace"))' | head -1
```

### Export & Visualization

```bash
# Export to CSV for Excel
jq -r 'map([.ts, .lvl, .src, .cat, .msg]) | .[] | @csv' logs/opensidebar.jsonl > logs/export.csv

# Export to TSV for spreadsheets
jq -r 'map([.ts, .lvl, .src, .cat, .msg]) | .[] | @tsv' logs/opensidebar.jsonl > logs/export.tsv

# Create simple HTML report
jq -s '<!DOCTYPE html><html><head><style>table{border-collapse:collapse}th,td{border:1pxsolid#ddd;padding:8px}</style></head><body><table><tr><th>Time</th><th>Level</th><th>Message</th></tr>' + (map(&quot;<tr><td>\(.ts)</td><td>\(.lvl)</td><td>\(.msg)</td></tr>&quot;) | join(&quot;&quot;)) + &quot;</table></body></html>&quot; logs/opensidebar.jsonl > logs/report.html
```

## Tips

1. **Always use `-R` with `tail -f`** to handle incomplete lines:
   ```bash
   tail -f logs/opensidebar.jsonl | jq -R 'fromjson?'
   ```

2. **Handle missing fields gracefully**:
   ```bash
   jq 'select(.data?.tabId == 123)' logs/opensidebar.jsonl
   ```

3. **Chain multiple jq commands**:
   ```bash
   jq 'select(.cat == "workspace")' logs/opensidebar.jsonl | jq -s 'sort_by(.ts) | .[0:10]'
   ```

4. **Use `--slurp`/`-s` for aggregate operations** (loads entire file into memory):
   ```bash
   jq -s 'length' logs/opensidebar.jsonl
   ```

5. **Stream large files** without `-s` to save memory:
   ```bash
   jq 'select(.lvl == "ERROR")' logs/opensidebar.jsonl
   ```

## Windows Users

If you don't have `jq` installed:

1. **Install with Chocolatey**: `choco install jq`
2. **Install with Scoop**: `scoop install jq`
3. **Download binary**: https://jqlang.github.io/jq/download/

Or use the CLI tool instead: `bun run scripts/log-query.ts`
