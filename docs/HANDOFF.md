# Handoff — `ttc-tornooiapp`

Short orientation for the next person (or agent) picking up this repo. For deeper product and architecture notes, see `docs/DESIGN.md`.

**Maintainer environment:** Development uses **WSL** (Linux shell and paths such as `/mnt/c/...`), not Windows PowerShell. If your IDE or session metadata shows PowerShell, treat **WSL** as authoritative for how this repo is run and where it lives on disk.

---

## What this is

**Table tennis–first tournament helper**: a static **Svelte + Vite** web UI (`web/`) on top of a **TypeScript domain package** at the repo root (`src/`). The goal is local, organizer-controlled tournaments: players, groups, round-robin and brackets, scoring with TT-style legality checks, handicaps, and **undo/redo** over a single appendable **command log**.

The “task for the tool” in recent work has been: **ship a usable organizer flow in the browser** that respects the command model, stays offline-friendly, and defers big scope (multi-sport, team tournaments, full scheduling polish) until the core loop is solid.

---

## Repo layout (where to look)

| Area | Role |
|------|------|
| `src/model.ts` | Pure tournament state + rules: groups, RR, bracket structure, **score legality** (including deuce / post-11 **exact two-point margin**), handicaps, deterministic bracket shuffle when a seed string is provided. |
| `src/command.ts` | **Command types**, payloads, `applyCommand` / inverse helpers, validation that belongs at the command boundary (e.g. **duplicate display names** on create/rename). |
| `src/controller.ts` | Orchestration: dispatch commands, maintain log position for undo/redo, wire into `generateBracket` options like `shuffleKey`. |
| `web/src/App.svelte` | Main UI: **settings-first** entry, **create-tournament wizard**, session tabs, players, groups, bracket actions, import/export, status + **fixed footer** (last action + undo/redo). |
| `tests/*.spec.ts` | **Vitest** specs for model, commands, bracket behavior, scores. |

---

## How to run things (WSL)

Assume the repo lives on the Windows drive, e.g.:

```bash
cd /mnt/c/Users/donne/code/ttc-tornooiapp
```

### One-time / when dependencies change

```bash
npm install
```

Installs the root workspace and `web/` (the web app depends on the local `ttc-tornooiapp` package via `file:..`).

### Tests

From the **repository root**:

```bash
npm test
```

Runs **Vitest** once and exits. For watch mode during development:

```bash
npm run test:watch
```

### Web dev server (“test server”)

From the **repository root**:

```bash
npm run dev:web
```

This is `npm run dev -w web`: **Vite** with `--host 0.0.0.0` so you can open the printed URL from another device on the LAN. Default is often port **5173**; use whatever URL Vite prints.

### Optional: Svelte / TS check (web only)

```bash
npm run check -w web
```

Useful before a commit when UI or types changed under `web/`.

### Optional: production-style web build

```bash
npm run build -w web
npm run preview -w web
```

### WSL tips

- Use a **recent Node LTS** (the repo uses modern TypeScript and Vitest). If `npm install` fails inside WSL, install Node via **nvm**, **fnm**, or your distro package, then retry from the repo root.
- The repo on **`/mnt/c/...`** is convenient for editing on Windows and running in WSL; I/O on `/mnt/c` can be slower than a clone inside the Linux home filesystem (`~/code/...`). For heavy `npm test` loops, a Linux-native clone is sometimes faster.
- **Line endings**: if git shows mass `CRLF`/`LF` flips, normalize with your usual `.gitattributes` / core.autocrlf policy so diffs stay readable.

---

## Data flow (very short)

The UI keeps **per-tournament (or per-session) state** in memory and mirrors the **command log** mental model: export/import paths (JSON / JSONL-style bundles, depending on what `App.svelte` exposes) are how you move a tournament between machines or back up work. The **design target** in `DESIGN.md` is still **organizer-controlled local files** and offline-capable flows; the exact file API in the browser evolves with the UI.

When adding features, ask: **“Does this need a new command type?”** If yes, the change almost always touches **`command.ts`**, **`controller.ts`**, tests, and then the Svelte layer.

### Copy-paste: typical WSL session

```bash
cd /mnt/c/Users/donne/code/ttc-tornooiapp   # or your path
npm install
npm test
npm run dev:web
# second terminal, optional:
npm run check -w web
```

### Root package build (library `dist/`, not required for Vite dev)

The workspace root can emit **`dist/`** for the core package via **`npm run build`** (`tsup`). Day-to-day UI work usually does **not** need this, because Vite resolves the local package from source; run it when validating packaging or publishing.

---

## What we have been **focusing** on (high level)

- **Command-oriented state**: every meaningful mutation goes through a typed **command** with `id`, `dependsOn`, and replayable application. **Undo** is modeled as commands (and/or inverse application), not ad-hoc state snapshots.
- **Organizer UX**: open on **Settings**; **wizard** to create a tournament (name, format choice with **non–group-bracket paths stubbed/disabled**, handicap toggle, **classes only at creation** — no rich in-session class editor after create).
- **Honest rules in the model**: e.g. when either side is **above 11**, the winning margin must be **exactly 2** (not “≥2” for high scores).
- **Bracket seeding fairness without server RNG**: **deterministic shuffle** for bracket generation, keyed by an optional **`shuffleKey`** (UI passes something stable like the tournament tab name) so the same tournament name yields the same bracket order.
- **Player names**: **duplicate display names** rejected on create/rename using a **normalized** comparison; internal player ids stay stable so renames are safe.
- **Shell polish**: **sticky** global **status** / header region so notices do not scroll away; **fixed bottom bar** with last command summary + **Undo / Redo**; hide **“Create groups & matches”** once groups already exist (global and per-class where applicable).
- **Handicap** surfaced in labels and wizard where relevant.
- **Tests** extended for the above (scores, bracket shuffle, command validation).

---

## What we have been **de-prioritizing / ignoring** (for now)

- **Full tournament format matrix**: anything beyond the **group + bracket** (or RR) path that the UI exposes is **stubbed or disabled** in the wizard — not implemented end-to-end.
- **Team tournament product**: domain may still mention teams for a narrow case; **multi-team tournaments** and team brackets remain **out of product scope** per `DESIGN.md`.
- **Post-create class editing** in the session UI: deliberately removed in favor of **wizard-only** class setup.
- **Backend / multi-writer / real-time sync**: still **single-organizer**, browser-local or file-based workflows; no “always online” server requirement.
- **Lint / CI hardening**: root `lint` script is still a placeholder; rely on tests + `svelte-check` when touching UI.
- **Visual design system**: pragmatic layout and spacing; not a polished design system pass.

---

## Prime design decision: **commands + log + undo/redo**

1. **Tournament state** is derived by **applying an ordered command list** (with a cursor for “current time” in the log).
2. **Commands** are small, typed, serializable records. Heavy lifting stays in **`model.ts`**; **`command.ts`** validates and delegates.
3. **Undo** does not silently fork arbitrary state: it works through the **same command machinery** (e.g. inverse operations or dedicated undo entries — see **`src/controller.ts`** and **`Undo`** handling in **`src/command.ts`** for the live behavior). **Redo** reapplies work that was undone: in practice, redo is meaningful when the **tail of the log** is consistent with “we just undid something” (the UI footer is meant to make that legible to the organizer).
4. **Benefits**: audit trail, export/import as JSONL, easier testing (feed commands, assert state), and a clear place for **sport-specific validation** before state changes commit.

Secondary choices aligned with that:

- **Pure functions** in the model where possible, so tests do not need a browser.
- **Explicit keys** (`shuffleKey`) for reproducible bracket draws instead of `Math.random()` in the domain layer for that path.
- **UI reflects the log**: footer text summarizes the **last command** so organizers trust what will undo.

---

## Quick pointers for the next change

- If scoring rules change, start in **`src/model.ts`** (`isMatchScoreLegal` / winner helpers), then add **`tests/score.spec.ts`** cases.
- If a new user-facing action should persist, add a **`CommandType`** + handler in **`command.ts`**, wire **`controller.ts`**, then UI in **`App.svelte`**.
- If bracket fairness or seeding changes, **`generateBracket`** and **`GenerateBracket`** payload (`shuffleKey`) are the choke points.
- If the web app shows a **blank page** after a change, open the browser console first: recent bugs in this stack were often **undefined Svelte 5 `$state`** fields or a **`svelte-check`** failure that only appears in the editor until you run `npm run check -w web`.

---

## Doc map

| Document | Use |
|----------|-----|
| `docs/DESIGN.md` | Goals, non-goals, storage, offline, broader roadmap. |
| `docs/TEST_SPECIFICATION.md` | Testing intent / scenarios (if maintained). |
| `docs/AGENT_SUMMARY.md` | Short agent-oriented notes if present in your branch. |
| `docs/HANDOFF.md` | This file: **recent focus**, **run commands (WSL)**, **command architecture** snapshot. |

### Running a single Vitest file (optional)

From the repo root, Vitest accepts path filters:

```bash
npx vitest run tests/score.spec.ts
npx vitest run tests/command.spec.ts
```

Useful when iterating on one area without running the full suite.

---

_End of handoff (~180 lines). Adjust the `cd` path if your clone is not under `/mnt/c/Users/...`._
