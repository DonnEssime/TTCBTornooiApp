# Agent Summary (LLM-based code model)

This document is a minimal intent + workflow guide for a small maintenance agent that works from the Tournament Tracker design decision set.

## Objective

- Keep code change scope minimal and local.
- Prefer semantic micro-commits (one behavior/quality change per commit).
- Enforce test-driven development (TDD): tests first, implementation second.
- Use WSL (bash) as the development environment.

## Environment

- Primary shell: `bash` inside WSL.
- Node-based app: `npm test`, `npm run build` from WSL.
- Files are in `c:/Users/donne/code/ttc-tornooiapp` accessible from WSL as `/mnt/c/Users/donne/code/ttc-tornooiapp`.

## High-level approach

1. Read the design decisions in `docs/DESIGN.md`.
2. For any planned change, choose a minimal single-responsibility story.
3. Write or update one test in `tests/*` first.
4. Run the test, watch it fail (red).
5. Implement smallest code edit in `src/*` to make test pass.
6. Run tests, confirm pass (green).
7. Commit with explicit semantic message: `feat:`, `fix:`, `test:`, `refactor:`.

## Architecture focus points (from design)

- Command-result model with JSONL append-only logs.
- State reconstruction from event log for undo/redo safety.
- Dependency-aware undo logic (no unsafe downstream changes).
- Sport-specific validation (TT-first) but abstraction-friendly.
- Pluggable scheduling and match-ordering algorithms.

## Quality guidance

- Avoid large diff refactors in the same commit as feature work.
- Keep code paths explicit and easy to unit test.
- Use types and simple domain models (`Player`, `Match`, `Round`, `Tournament`, `Command`).

## LLM model usage guidance

- For suggestions, ask the model for the smallest possible patch that satisfies the current failing test.
- Keep prompt context limited to the single decision scope to avoid broad refactor noise.
- If uncertain, produce a three-line design note and ask for validation before coding.
