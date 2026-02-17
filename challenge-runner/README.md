# Challenge Discovery

This module generates a reproducible task manifest for challenge sites.

## Command

```bash
bun run challenge:discover --url https://serene-frangipane-7fd25b.netlify.app
```

## Options

- `--url <site>`: Required seed URL.
- `--out <file>`: Output manifest path (default `challenge-runner/tasks-manifest.json`).
- `--expect <n>`: Expected number of tasks (default `30`).
- `--max-pages <n>`: Same-origin crawl cap (default `120`).
- `--timeout-ms <n>`: Per-request timeout (default `8000`).
- `--manual-manifest <file>`: Skip crawling and validate/copy a curated manifest.

## Outputs

1. Manifest JSON:
   - `challenge-runner/tasks-manifest.json`
2. Diagnostics JSON:
   - `challenge-runner/tasks-manifest.diagnostics.json`

## Notes

- Discovery combines DOM anchors and route-literal extraction from HTML.
- The crawler is same-origin only.
- If count is not equal to `--expect`, inspect diagnostics and rerun with a higher `--max-pages` or fallback to a manually curated manifest.
