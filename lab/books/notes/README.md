# Book Notes

Structured notes connecting reference books to project decisions and code.

## Source Books

| Book | Author | Notes File | Key Influence |
|------|--------|-----------|---------------|
| Agentic Design Patterns | Antonio Gulli | [agentic-design-patterns-notes.md](agentic-design-patterns-notes.md) | Pattern catalog: routing, reflection, planning, tools, memory, HiTL |
| Context Engineering for Multi-Agent Systems | Denis Rothman | [context-engineering-notes.md](context-engineering-notes.md) | Context > model thesis, compression, planner/executor/tracer architecture |
| Designing Multi-Agent Systems | Victor Dibia | [designing-multi-agent-systems-notes.md](designing-multi-agent-systems-notes.md) | Agent execution loop, middleware, UX principles, evaluation patterns |

## Topical Notes

| Topic | Notes File | Key Influence |
|-------|-----------|---------------|
| Prompt Management | [prompt-management-notes.md](prompt-management-notes.md) | Centralized prompts, versioning, governance |

## How to Read These Notes

Each book note follows the same structure per chapter/concept:

1. **Book concept** -- what the book says (1-3 sentences)
2. **Where we applied it** -- file paths, class names, function names in OpenSidebar
3. **What we learned** -- where reality diverged from theory, what we added

## Cross-Book Pattern Map

The final table in [designing-multi-agent-systems-notes.md](designing-multi-agent-systems-notes.md)
maps every pattern to which book(s) cover it and where it lives in our code.

## Conventions

- Notes are implementation-oriented, not summaries
- Every claim links to a file path or RFC
- "What we learned" sections capture knowledge that would otherwise be lost
- Evidence grades (A/B/C/D from lab/README.md) used for empirical claims
