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

## Language / i18n

- All user-visible strings live in `src/i18n/catalog*.ts` with **English** in `en` and **Dutch** in `nl`.
- New UI copy: add a catalog key with `en` filled; `nl` may stay empty until translated.
- In Svelte markup use `<Msg key="ui...." />` from `web/src/i18n/Msg.svelte`.
- In script, attributes, PDF, and command toasts use `msgText()` / `showInfoKey()` / `showErrorKey()` from `web/src/i18n/msg.ts`.
- Command failures use `MessageKey` in `reason` (see `src/i18n/command-result.ts`), not raw English.
- Empty `nl` shows English with **red** text (`.i18n-fallback`) until translated.
- Run `npm run check:i18n` for warn-only missing-Dutch report (does not fail CI).

## Versioning

Bump the app version when the user asks for a release/version bump, or when wrapping up a batch of user-visible changes they intend to ship.

Use [semver](https://semver.org/): **patch** for fixes, **minor** for new features (backward compatible), **major** for breaking user-facing behavior.

**Do not** bump the version for every small commit, refactors, tests-only work, or internal changes with no release intent.

**App version** (`APP_VERSION`) is separate from **tournament log format version** (`TOURNAMENT_STORAGE_FORMAT_VERSION` in `src/storage-format.ts`). Only bump format version when saved tournament logs would break compatibility with older app builds.

When bumping the app version, update all of these to the same value:

1. `package.json` (`version` — source of truth for build info)
2. `web/package.json` (`version`)
3. `src/storage-format.ts` (`APP_VERSION` — embedded in exported tournament logs)
4. `web/src/generated/build-info.default.json` (`version` — fallback when git is unavailable)
5. `package-lock.json` (root and `web` workspace entries)
6. Run `node scripts/update-build-info.mjs` to refresh `web/src/generated/build-info.json`

Prefer a dedicated commit: `chore: bump version to X.Y.Z`.

## Quality guidance

- Avoid large diff refactors in the same commit as feature work.
- Keep code paths explicit and easy to unit test.
- Use types and simple domain models (`Player`, `Match`, `Round`, `Tournament`, `Command`).

## LLM model usage guidance

- For suggestions, ask the model for the smallest possible patch that satisfies the current failing test.
- Keep prompt context limited to the single decision scope to avoid broad refactor noise.
- If uncertain, produce a three-line design note and ask for validation before coding.
