# OpenSidebar Logs

Extension logs are automatically drained to `opensidebar.jsonl` in this directory via a local HTTP server.

## Quick Start

```bash
# Terminal 1: Start the log server
bun run logs

# Terminal 2: Run the extension
bun run dev
```

Logs appear in `logs/opensidebar.jsonl` in near-real-time (~5s flush interval).

## Querying Logs

```bash
bun run logs:query tail          # Last 50 entries
bun run logs:query errors        # ERROR-level only
bun run logs:query since 5m      # Last 5 minutes
bun run logs:query search "text" # Search messages
bun run logs:query stats         # Aggregate counts
bun run logs:query help          # All commands
```

Or read the file directly with any tool (grep, jq, Read, etc.).

## Architecture

The extension's `StorageLogger.flush()` fire-and-forgets log batches to `http://127.0.0.1:7589/ingest`. The server appends entries as JSONL lines. If the server isn't running, logs are silently dropped (chrome.storage remains the authoritative source).

## File Rotation

When `opensidebar.jsonl` exceeds 50 MB it rotates through `.1` to `.5` (250 MB total cap).

See [QUERY-GUIDE.md](QUERY-GUIDE.md) for jq recipes and advanced queries.
