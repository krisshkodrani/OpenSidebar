# OpenSidebar Docs

This directory contains architecture notes, feature docs, guides, RFCs, and release/support content.

## Start Here

- [Developer Guide](./developer-guide.md)
- [Architecture Overview](./architecture/overview.md)
- [Perception Layer](./architecture/perception-layer.md)
- [Evals Program](./guides/evals-program.md)
- [Store Listing Draft](./store-listing.md)

## Structure

```text
docs/
  architecture/   System design and runtime ownership
  features/       User-facing capability docs
  guides/         Runbooks and operating guides
  research/       Supporting analysis and benchmarking
  rfc/            Historical RFC set
  rfcs/           Additional planning RFCs
  articles/       Longer-form writeups
  screenshots/    Documentation assets
  assets/         Media and supporting files
```

## Notes

- Some older RFCs and research notes describe previous model choices or earlier eval contracts. Treat the architecture and eval guides as the source of truth for the current shipped system.
- If a doc disagrees with code, prefer the code and update the doc.
