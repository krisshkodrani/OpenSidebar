# Contributing to OpenSidebar

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

1. Fork the repository
2. Clone your fork: `git clone git@github.com:yourusername/OpenSidebar.git`
3. Install dependencies: `npm install`
4. Copy environment file: `cp .env.example .env` and add your OpenRouter API key
5. Start development: `npm run dev`

## Project Architecture

Chrome Manifest V3 extension with three isolated execution contexts:

```
Side Panel (React/Zustand) <--> Service Worker (Agent Loop) <--> Content Script (DOM)
```

See [CLAUDE.md](./CLAUDE.md) for the full internal architecture reference, and [docs/architecture/](docs/architecture/) for detailed documentation.

## Adding New Tools

1. **Add the enum value** in `src/types/enums.ts` (`ToolName` enum)
2. **Add typed args** in `src/types/tools.ts` (`ToolArgsMap`)
3. **Define the tool schema** in `src/background/tools/definitions.ts` (OpenAI function-calling format)
4. **Add metadata** in `src/background/tools/metadata.ts` (`ToolMeta` — risk, domModifying, sequential)
5. **Register the executor** in `src/background/tools/index.ts`
6. **Implement the action** in `src/content/actions.ts` (if it interacts with the DOM)

Important: tool parameter names must match across all layers (definition, TypeScript types, executor).

## Running Tests

```bash
npm test                                          # Run all tests
npx vitest run tests/background/tools.test.ts     # Run a specific file
npx vitest run --grep "AgentLoop"                 # Run tests matching pattern
```

Tests use Vitest + happy-dom. The test setup (`tests/setup.ts`) mocks `chrome.*` APIs. Tests are not type-checked by `tsc` — only `src/` is included in `tsconfig.json`.

## Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Run tests: `npm test`
4. Run linter: `npm run lint`
5. Format code: `npm run fmt`
6. Commit with descriptive messages
7. Push to your fork
8. Create a Pull Request

## Commit Message Format

```
type: subject (50 chars max)

Body (optional, wrap at 72 chars)
```

Types: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`

## Code Style

- TypeScript with strict mode
- 2-space indentation
- Run `npm run fmt` before committing
- Follow existing patterns in the codebase
- Path alias: `@/*` maps to `./src/*`

## Design Principles

- **Generic over task-specific** — no site-specific heuristics. Everything must work on sites the agent has never seen.
- **Tools are generic primitives** — click, type, scroll, navigate. Higher-level behavior emerges from LLM reasoning.
- **Plans are dynamic** — the planner decomposes any query into subtasks based on context, not templates.

## Pull Request Process

1. Ensure all tests pass (`npm test`)
2. Ensure linter passes (`npm run lint`)
3. Update documentation if needed
4. Reference any related issues
5. Wait for review from maintainers

## Questions?

Open an issue or discussion on GitHub.
