# Project: AI-Driven Trading Tool Builder

## Architecture

See `docs/ARCHITECTURE_PLAN.md` for the full architecture plan, target file structure, core contracts, and phased execution plan with verification checklists.

## Current Status

- Phase 1: Core Infrastructure — NOT STARTED
- Phase 2–6: Blocked on Phase 1

## Key Rules

- Vanilla JS + ES modules, no build step, no framework
- Global CSS + BEM naming (no Shadow DOM)
- Single-user, single WebSocket
- Components communicate via event bus only, never reference each other directly
- Plugin self-containment: everything about OKX lives in `plugins/okx/`
- Core engine in `core/` is domain-agnostic
- `public/core/` is client-side framework code
- `public/index.html` should be a minimal shell (~50 lines)

## Workflow

- Read `docs/ARCHITECTURE_PLAN.md` before starting any phase
- Each phase has a verification checklist with `[AI]` and `[YOU]` tags
- Complete all `[AI]` checks before asking the user to verify `[YOU]` checks
- Keep the old code working until the new code is verified (don't delete prematurely)
