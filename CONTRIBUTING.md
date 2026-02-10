# Contributing to OpenSidebar

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

1. Fork the repository
2. Clone your fork: `git clone git@github.com:yourusername/OpenSidebar.git`
3. Install dependencies: `bun install`
4. Copy environment file: `cp .env.example .env`
5. Add your API keys to `.env`
6. Build: `bun run build`

## Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Run tests: `bun test`
4. Run linter: `bun run lint`
5. Commit with descriptive messages
6. Push to your fork
7. Create a Pull Request

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

## Pull Request Process

1. Ensure all tests pass
2. Ensure linter passes with no errors
3. Update documentation if needed
4. Reference any related issues
5. Wait for review from maintainers

## Questions?

Open an issue or discussion on GitHub.
