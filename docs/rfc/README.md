# RFCs (Request for Comments)

This directory contains feature proposals, technical decisions, and implementation plans for future enhancements to OpenSidebar.

## Active RFCs

### [DOM Context Optimization](./IMPLEMENTATION_PLAN_DOM_OPTIMIZATION.md)

**Status:** Proposed  
Phase-based optimization to reduce system prompt size by 70% while improving agent grounding through viewport-aware filtering, attribute whitelisting, and progressive compression.

### [Content Script API Guard](./rfc-content-script-api-guard.md)

**Status:** Proposed  
Adds runtime context detection to prevent Chrome API errors when modules are accidentally loaded in content scripts.

### [Shadow DOM Support](./SHADOW_DOM_REPORT.md)

**Status:** Research phase  
Analysis and implementation plan for supporting web components that use Shadow DOM.

### [Computer Use Challenge](./computer-use-challenge.md)

**Status:** Exploratory  
Research into vision model integration and advanced computer use capabilities.

### [Implementation: Locked Workspace](./IMPLEMENTATION-Locked-Workspace.md)

**Status:** Proposed  
Adds workspace locking functionality to prevent accidental tab modifications during AI operations.

## Archived RFCs

Completed implementation phases and historical documents are stored in [archived/](./archived/):

- **Phase 0-8** - Initial implementation phases (all complete)
- **Technical Master Plan** - Original technical standards
- **Design Decisions** - Resolved product and UX decisions
- **Implementation Audits** - Historical gap analyses

## RFC Process

### Submitting an RFC

1. **Create RFC document** in this directory using the established template
2. **Technical review** - Core team evaluates technical feasibility
3. **Design review** - UX implications are considered
4. **Approval** - RFC moves to "Ready to implement" status
5. **Implementation** - Assigned to development milestone
6. **Archival** - Moved to archived/ when complete

### RFC Template

```markdown
# RFC: [Feature Name]

## Status

[Proposed | Ready to implement | In progress | Complete]

## Problem

[Clear description of the issue or opportunity]

## Solution

[Proposed implementation approach]

## Implementation

[Technical details and code changes]

## Testing

[Test plan and success criteria]

## Impact

[Effects on users, performance, security]
```

## Current Priorities

1. **DOM Optimization** - Performance improvements for complex pages
2. **Content Script Guards** - Prevent runtime errors
3. **Shadow DOM Support** - Support modern web components

## See Also

- [Features Documentation](../features/) - Implemented functionality
- [Architecture Documentation](../architecture/) - Technical reference
- [Agent Guidelines](../../AGENTS.md) - Development standards
