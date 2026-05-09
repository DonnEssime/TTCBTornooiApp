# Implementation tracker

**Design:** product intent and decisions — [DESIGN.md](DESIGN.md).

**Purpose:** Track delivery progress, gaps, and next steps. Product **design is on hold** for now; treat **DESIGN.md** as the north star, but **stub or placeholder** anything not yet decided or not yet worth building.

**How to use this file:** Update after meaningful milestones (new feature slice, test batch, infra). Keep bullets factual; link PRs or commits if helpful.

---

## Current state (repository)

| Area | Status | Notes |
|------|--------|--------|
| **Distribution** | TypeScript **library** (`src/` → `dist/` via `tsup`) | No Svelte app shell yet (**DESIGN.md** targets Svelte SPA + static host later). |
| **Domain (`model.ts`)** | **In progress** | Players, matches, team match, bracket generation (fill/cull), settle/advance, forfeits, scheduling hooks, TT-oriented scoring helpers. |
| **Commands (`command.ts`)** | **In progress** | Create player/team/match, enter scores, forfeits, dependency-aware undo replay. `SetRoundLock` appears in `CommandType` but **no command interface or `applyCommand` branch** yet — type-level stub only. |
| **Controller (`controller.ts`)** | **Thin** | Orchestrates runner + optional view; bracket gen guards team mode; `settleAndAdvance` after scores. |
| **Views (`view.ts`)** | **Dev-oriented** | Console / HTML string / DOM-shaped views for tests or demos — not production UI. |
| **Persistence (`storage.ts`)** | **Minimal** | JSON line ↔ command parse/replay helpers. **No** file I/O, **no** log header/version, **no** FS Access. |
| **Tests** | **Vitest**, ~31 tests | `tests/*.spec.ts` cover model, commands, replay, e2e controller flows, bracket, team single-match mode, view smoke. |
| **Tooling** | Partial | `npm run build`, `npm test`. `lint` script is a **placeholder** (`echo 'no lint configured yet'`). |
| **Deps** | Review later | `package.json` lists many transitive-style entries; cleanup is **non-blocking** for features. |

---

## Implemented vs missing (high level)

### Done enough for library-first iteration

- Command log replay (`replayCommandsFromJsonLines`).
- Core bracket path for player tournaments (with team-vs-team mutually exclusive rule enforced in model/controller).
- `EnterScore` / `EnterTeamScore` set `winner` for bracket settlement.
- Basic undo via full history replay.

### Partial / needs hardening

- **Dependency graph:** present for undo; expand tests as new command types land.
- **JSONL on disk:** format not finalized in code (no header line contract, no tournament id in every command — design says header + per-tournament file).
- **Groups → bracket:** model has `groups`; wiring from group results to bracket seeding may be incomplete vs product flow — verify against tests and upcoming UI needs.

### Missing blocks (expected next waves)

1. **Svelte SPA (v1 shell)** — static hosting–ready app: routing, layout, empty states, build pipeline (Vite + Svelte + TS), consume this package or monorepo workspace.
2. **File System Access + offline persistence** — open/save append-only `.jsonl`, implement **header/first-line version** on create, corruption path: **stop + line number + retry** per design.
3. **Round lock** — implement `SetRoundLock` (and optional unlock) in `Command` union, runner, model state, controller, tests; enforce “no score edits after lock” where design requires.
4. **Rename / identity commands** — e.g. `RenamePlayer` as explicit command (design: log-versioned identity); today renames would be ad-hoc if done at all.
5. **Settings store** — recent tournaments list with titles (`localStorage` or equivalent), capped **N**; no spec in code yet.
6. **Lint & CI** — ESLint/Prettier (or Biome), GitHub Action running `npm test` + `npm run build` on push.
7. **`fast-check`** — listed in design; not wired in repo yet (optional next test batch).

### Intentionally deferred (design or product)

- Team **tournaments** (multi-team grids, team brackets) — out of scope; see `docs/DESIGN.md`.
- Full **Batch 3** test spec in `docs/TEST_SPECIFICATION.md` — future if product scope changes.

---

## Next steps (suggested order)

Workstreams can overlap; order is a default when unsure.

1. **Lock command slice** — model field for round/stage lock, `SetRoundLockCommand` + runner + tests + controller hook; stub UI toggle until SPA exists.
2. **JSONL file adapter** — read/write file with header line + append commands; integrate `storage.ts`; unit-test malformed line → error with index.
3. **Svelte scaffold** — new `app/` or `web/` package: minimal screen listing “open tournament” placeholder + mount read-only state from library.
4. **FS Access wrapper** — browser module with graceful fallback message (Safari/Firefox) per design.
5. **Recent tournaments** — persist list in `localStorage` when a file is successfully opened/saved.
6. **Lint + CI** — low friction quality gate before UI grows.

After each slice: run `npm test` (e.g. from WSL as in `docs/AGENT_SUMMARY.md`), update the **Current state** table above.

---

## Stub / placeholder policy (while design is on hold)

- **Prefer:** small typed stubs (`throw new Error('Not implemented: …')` or no-op with `console.warn`) behind a single feature flag or unreachable branch until the slice is scheduled.
- **Avoid:** silent wrong behavior in commands that could end up in a real log.
- **Document:** one-line comment `// DESIGN: …` pointing to the relevant `docs/DESIGN.md` section when non-obvious.

---

## Changelog (manual)

| Date | Change |
|------|--------|
| 2026-05-09 | Initial tracker created. |
