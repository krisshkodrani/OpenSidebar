# Contributing to OpenSidebar

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

1. Fork the repository
2. Clone your fork: `git clone git@github.com:yourusername/OpenSidebar.git`
3. Install dependencies: `bun install`
4. Copy environment file: `cp .env.example .env`
5. Add your API keys to `.env`
6. Build: `bun run build`

## Project Architecture

OpenSidebar is a Chrome extension with four isolated execution contexts:

```
Side Panel (React/Zustand) ←→ Service Worker (Agent Loop) ←→ Content Script (DOM)
                                        ↕
                                Offscreen Document (Memory)
```

See [docs/architecture/](docs/architecture/) for detailed documentation.

## Adding New Tools

To add a new tool:

1. **Define the tool** in `src/background/tools/index.ts`:

   ```typescript
   {
     name: "my_new_tool",
     description: "What the tool does",
     parameters: {
       type: "object",
       properties: {
         param1: { type: "string", description: "Parameter description" }
       },
       required: ["param1"]
     }
   }
   ```

2. **Add metadata** in `src/background/tools/metadata.ts`:

   ```typescript
   // Add to appropriate set
   DOM_MODIFYING_TOOLS.add("my_new_tool"); // if it modifies DOM
   SEQUENTIAL_TOOLS.add("my_new_tool"); // if must run alone
   ```

3. **Implement the executor** in the same file (see existing examples)

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/background/agent.test.ts

# Run tests matching pattern
bun test --grep "AgentLoop"
```

## Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Run tests: `bun test`
4. Run linter: `bun run lint`
5. Format code: `bun run fmt`
6. Commit with descriptive messages
7. Push to your fork
8. Create a Pull Request

## Commit Message Format

```
type: Subject (50 chars max)

Body (optional, wrap at 72 chars)

Footer (optional)
```

Types:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Code style (formatting, semicolons, etc)
- `refactor:` Code refactoring
- `test:` Adding/updating tests
- `chore:` Build process, dependencies, etc

## Code Style

- TypeScript strict mode enabled
- Use 2 spaces for indentation
- Run `bun run fmt` before committing
- Follow existing patterns in the codebase
- Add JSDoc to new public functions

## Pull Request Process

1. Ensure all tests pass
2. Ensure linter passes with no errors
3. Update documentation if needed
4. Reference any related issues
5. Wait for review from maintainers

## Questions?

Open an issue or discussion on GitHub.
