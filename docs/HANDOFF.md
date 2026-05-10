# Handoff — `ttc-tornooiapp`

Orientation for the **next developer or agent**: where things live, how to run them, and what the codebase has been **doing lately**. Product goals, non-goals, and storage vision live in **`docs/DESIGN.md`**; this file is a **practical map** and a **short memory** of recent work.

---

## What this is

A **table tennis–first** tournament helper: **Svelte 5 + Vite** UI under **`web/`** on top of a **TypeScript domain package** at the repo root (`src/`, published build in `dist/` when you run `npm run build`). State is meant to be **command-driven**, **replayable**, and **undo/redo**-friendly—see **`src/controller.ts`** and **`src/command.ts`**.

---

## Repo layout

| Path | Role |
|------|------|
| `src/model.ts` | Tournament shape, pure helpers: groups, RR, brackets, **TT score legality** (including deuce / post-11 **exact two-point margin**), handicaps, bracket shuffle keyed by a string, bracket settlement and sync helpers. |
| `src/command.ts` | Command types, `applyCommand`, validation, inverse/undo wiring. Bracket side-effects often go through **`reconcileBracketScope`**-style paths (settle / propagate ordering matters after clear or undo). |
| `src/controller.ts` | Public API for the UI: dispatch commands, undo/redo cursor, bracket generation (`shuffleKey`, etc.). |
| `src/view.ts` | View-model / presentation helpers consumed by the app or tests where relevant. |
| `src/storage.ts` | Persistence helpers (see DESIGN for intent). |
| `web/src/App.svelte` | Main shell: settings, wizard, sessions, players, groups, bracket phase, import/export, status, footer with undo/redo. Large file—search before duplicating patterns. |
| `web/src/BracketStreamView.svelte` | Centered “stream” knockout layout; coordinates with **`BracketSubtree.svelte`** for interaction. |
| `tests/*.spec.ts` | **Vitest**—model, commands, scores, **`tests/bracket.spec.ts`** for bracket behavior. |

---

## How to run

**Requirements:** Node.js and npm (workspace at root includes `web/`).

From the **repository root**:

```bash
npm install          # root + web (web depends on local package file:..)
npm test             # Vitest, once
npm run test:watch   # watch mode
npm run dev:web      # Vite dev server (--host 0.0.0.0); use the URL Vite prints (often port 5173)
npm run check -w web # svelte-check + TS (run after UI/type changes)
npm run build -w web # production bundle under web/dist/
```

Paths like `/mnt/c/...` (WSL) or `C:\...\` (Windows) are both fine—the commands are the same once `cd` is correct.

---

## Architecture you should not fight

1. **Meaningful mutations** should become **commands** with stable **`commandId`** and correct **`dependsOn`** so replay and undo stay coherent.
2. **Heavy rules** live in **`model.ts`**; **`command.ts`** validates at the boundary and applies; **`controller.ts`** is the façade the UI calls.
3. When the UI shows **knockout** rows, some flows **create a `Match` on demand** (e.g. opening a pairing) so the log always has something to attach scores to—do not assume every bracket slot row exists before first open.

If you add a user-visible persistent action, expect to touch **command + controller + tests + App (or child component)**.

---

## Knockout bracket (recent focus)

- **UI:** **`BracketStreamView`** / **`BracketSubtree`** implement the interactive bracket “phase” view (click pairing → score entry; alignment with **`openBracketPairingModal`** in `App.svelte`).
- **Domain:** Bracket winners, byes, seed propagation, and **when a slot is “done”** are centralized in **`model.ts`** helpers used from **`command.ts`**. After **clear** or **undo**, bracket metadata and player **`Match`** rows can briefly disagree; reconciliation order in **`command.ts`** was tuned so **settle / propagate** behave sensibly for the next score or seed update.
- **Debug:** Under `DEBUG_UI`, **“[DEBUG] Simulate phase matches”** fills the **current minimum open knockout round** with random legal BO5 scores. Implementation details that matter after undo/clear:
  - Ensures missing **`match-{bracketSlotId}`** rows via **`createMatch`** (same dependency idea as the pairing modal).
  - Treats a slot as simulatable based on the **`Match`** (scheduled, no scores), **not** on **`BracketMatch.winner`** alone, so stale `winner` does not hide open games.
  - **Re-queries** the tournament after each score so the same “min round” pass completes the round instead of using a stale snapshot.

**Limitation (as of this writing):** that debug helper walks **`tournament.bracketMatches`** (main draw). **Per-class** brackets live under **`classTournaments[cid].bracketMatches`** in the model; the class tab UI may still show stubbed “create bracket” actions while reusing stream views for an existing class draw—if you extend simulation or row creation, thread **`classId`** / slice bracket arrays through the same way **`bracketScopeForPlayerMatch`** does in **`command.ts`**.

---

## Small UI / product notes from recent passes

- **Tournament name:** the toolbar **“Use suggested”** button was **removed**; **`applySuggestedTournamentTitle`** / **`deriveLabel`** remain in **`App.svelte`** for a possible future control.
- **Wizard / formats:** paths beyond the implemented **group + bracket** flow stay **stubbed or disabled** where the wizard exposes them.
- **Lint:** root **`npm run lint`** is still a placeholder; rely on **tests** and **`npm run check -w web`**.

---

## Where to start for common tasks

| Task | Start here |
|------|----------------|
| Change TT scoring rules | `src/model.ts` (`isMatchScoreLegal`, related helpers), then `tests/score.spec.ts` |
| New persisted action | New command type in `src/command.ts`, wire `src/controller.ts`, Vitest, then UI |
| Bracket generation / shuffle | `generateBracket` / `GenerateBracket` payload and `shuffleKey` from session |
| Bracket wrong after undo | `src/command.ts` (`reconcileBracketScope`, bracket command handlers), `src/model.ts` settlement/propagation |
| Blank UI / runtime errors | Browser console; Svelte 5 runes (`$state`); run **`npm run check -w web`** |

---

## Doc map

| Document | Use |
|----------|-----|
| `docs/DESIGN.md` | Goals, non-goals, hosting, data/log vision. |
| `docs/TEST_SPECIFICATION.md` | Scenario-style testing notes (if kept in sync). |
| `docs/AGENT_SUMMARY.md` | Extra agent-oriented notes if present on your branch. |
| `docs/HANDOFF.md` | This file: layout, commands, runbook, **recent bracket/debug context**. |

---

_Single maintainer or small team: keep this file honest when behavior shifts (especially bracket + command boundaries)._
