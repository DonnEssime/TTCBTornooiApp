# Handoff — `ttc-tornooiapp`

Practical orientation for the **next developer or agent**: layout, how to run things, command boundaries, and **what changed recently** in the knockout bracket stack. Product intent and storage vision stay in **`docs/DESIGN.md`**; this file is a **map** and a **short operational memory**.

---

## What this is

A **table tennis–first** tournament helper: **Svelte 5 + Vite** under **`web/`** on a **TypeScript** domain package at the repo root (`src/`, consumed as `ttc-tornooiapp` from the web workspace). State is **command-driven**, **replayable**, and **undo/redo**-aware—start at **`src/controller.ts`** and **`src/command.ts`**.

---

## Repo layout

| Path | Role |
|------|------|
| `src/model.ts` | Tournament shape and pure logic: groups, round-robin, **TT score legality** (deuce / post-11 two-point margin), handicaps, bracket generation and settlement, group-balanced ordering, best-effort heuristic seeding, **elimination** outcomes, structural bye propagation. |
| `src/command.ts` | Command types, validation, apply/undo; bracket side-effects flow through **`reconcileBracketScope`** (settle → propagate → settle order matters). |
| `src/controller.ts` | UI-facing API: dispatch commands, undo/redo, bracket generation options (`shuffleKey`, `bracketSeedingMode`, `fillByes`). |
| `src/view.ts` | Presentation helpers for CLI / tests where used. |
| `src/storage.ts` | Persistence helpers (see DESIGN). |
| `web/src/App.svelte` | Main shell: sessions, players, groups, **bracket phase** (seeding choice, knockout actions, import/export, undo/redo). Large—search before copying patterns. |
| `web/src/TournamentOverview.svelte` | Overview / status-style bracket and group context (kept in sync with bracket commands). |
| `web/src/BracketStreamView.svelte` + `BracketSubtree.svelte` | Stream-style knockout visualization. |
| `web/src/bracketStream/slotOutcome.ts` | Per-slot winner/loser styling; ignores internal structural-bye winners. |
| `tests/*.spec.ts` | **Vitest**; bracket-heavy coverage in **`tests/bracket.spec.ts`**, **`tests/bracket-best-effort.spec.ts`**, **`tests/command.spec.ts`**. |

---

## How to run

**Requirements:** Node.js and npm (root workspace includes `web/`).

From the **repository root**:

```bash
npm install
npm test -- --run
npm run test:watch
npm run dev:web
npm run check -w web
npm run build -w web
```

Use WSL or Windows paths consistently after `cd` into the repo.

---

## Architecture rules worth keeping

1. **User-visible state changes** should be **commands** with stable **`commandId`** and correct **`dependsOn`** so replay and undo stay coherent.
2. **Domain rules** live in **`model.ts`**; **`command.ts`** validates and applies; **`controller.ts`** is the façade the UI calls.
3. Knockout **player `Match`** rows (`match-{bracketSlotId}`) may be created when the user opens a pairing or via reconciliation—do not assume every bracket row exists before first interaction.

New surface area typically touches **model + command + controller + tests + web**.

---

## Knockout bracket (May 2026 state)

### Seeding modes (`BracketSeedingMode`)

When generating a bracket from group-qualified participants, the app chooses **`bracketSeedingMode`** (UI radios; controller always sends it with **`fillByes: true`**):

| Mode | Behaviour |
|------|-----------|
| **`closed_form`** | Equal-sized groups must match an **exact** built-in **G×4** grid (2×4, 4×4, 8×4). No virtual padding. |
| **`extend_closed_form`** | Same group constraints, but allows **virtual padding** to the next supported grid; dummies become **`BYE`** in `generateBracket`. |
| **`heuristic`** | **`bestEffortOrderParticipantsForGroupBracket`** when group data fits; else deterministic shuffle from `shuffleKey`. |

There is **no silent auto-expand** into a balanced grid: the mode is explicit. Old tests that assumed implicit balanced expansion were updated to pass **`extend_closed_form`** where that geometry is intended.

### Byes and “empty” slots

- **`generateBracket`** pads to the next power of two with **`BYE`**, maps layout dummies (`--empty--#…`) and **`BYE`** to **empty seeds** on `BracketMatch`.
- **Double-empty R1** (both sides empty / bye): **`BRACKET_STRUCTURAL_EMPTY_ADVANCE`** is stored on **`BracketMatch.winner`** so the slot counts as decided. **`bracketWinnerToNextRoundSeed`** maps that to **`undefined`** in the next round. **`settleBracketWinnersIn`** re-derives this and, for **round ≥ 2**, awards a **walkover** to a lone real seed when the missing side is a propagated structural empty (feeder-aware), not only when the sibling feeder is “still playing”.

### Elimination vs forfeit

- **`MatchStatus`** includes **`eliminated`** (bureaucratic advance without normal scored play), distinct from **`forfeit`**.
- **`EliminateLowestBracketRound`** (command): in an open round, marks the lower group-finisher in each two-player slot as eliminated and the better finisher as winner, with tie-breaks (larger group, then deterministic salt).

### Reconciliation

After scores / clears / undo, **`reconcileBracketScope`** runs **`settleBracketWinnersIn`**, **`propagateBracketSeedsFromChildWinners`**, **`materializeReadyNextRoundBracketSlots`**, **`syncBracketMatchPlayerRows`**, and may **`advanceBracketRound`** when a round is complete. Settlement must prefer a **decisive** canonical or alias player row over a **scheduled placeholder** at `bracketPlayerMatchId`—see **`settleBracketWinnersIn`** and **`findMatchByPlayers`** (non–group rows only).

### Heuristic placement tweak

In **`bestEffortOrderParticipantsForGroupBracket`**, placement **prefers participant indices whose round-1 opponent leaf is still empty** (will become a bye after padding), using a shared bonus and **`pickPreferringR1ByeAmong`** on ties and fallbacks—without overriding hard bans (e.g. never R1 vs own group winner).

### Multi-class brackets

Main-draw helpers and much of the UI still assume **`tournament.bracketMatches`**. Per-class slices live under **`classTournaments[cid]`**; extending elimination, simulation, or materialization to every slice should follow **`bracketScopeForPlayerMatch`** patterns in **`model.ts`** / **`command.ts`**.

---

## Debug UI note

Under **`DEBUG_UI`**, “simulate phase matches” and similar helpers may still target the **main** bracket array only. Thread **`classId`** / slice **`bracketMatches`** when extending.

---

## Where to start

| Task | Start here |
|------|------------|
| TT scoring rules | `src/model.ts` (`isMatchScoreLegal`), `tests/score.spec.ts` |
| New persisted action | `src/command.ts`, `src/controller.ts`, Vitest, then UI |
| Bracket seeding / BYE / structural empty | `generateBracket`, `settleBracketWinnersIn`, `materializeReadyNextRoundBracketSlots`, `BRACKET_STRUCTURAL_EMPTY_ADVANCE` |
| Heuristic ordering | `bestEffortOrderParticipantsForGroupBracket` |
| Bracket wrong after undo | `reconcileBracketScope` in `src/command.ts` |
| UI types / runes | `npm run check -w web` |

---

## Doc map

| Document | Use |
|----------|-----|
| `docs/DESIGN.md` | Goals, non-goals, hosting, data vision. |
| `docs/TEST_SPECIFICATION.md` | Scenario-style testing notes (if maintained). |
| `docs/HANDOFF.md` | This file: layout, runbook, **current bracket behaviour**. |

---

## Session notes — **May 2026** (bracket seeding, elimination, structural byes)

Consolidated from recent work on this branch:

1. **Explicit seeding + tests** — `expectedR1MatchCountAfterSeeding` in **`tests/bracket-best-effort.spec.ts`** mirrors **`generateBracket`** participant resolution per **`bracketSeedingMode`** (default **`extend_closed_form`** in the stress loop). Large virtual layouts use **`extend_closed_form`** in **`tests/bracket.spec.ts`** where the scenario is “balanced padding, not raw shuffle”.

2. **Structural double-bye propagation** — Without a sentinel **`winner`**, **`materializeReadyNextRoundBracketSlots`** never saw two “decided” feeders for empty–empty R1. Fixed end-to-end in **`model.ts`**; **`web/src/bracketStream/slotOutcome.ts`** and **`displayBracketColumns`** in **`App.svelte`** use **`bracketWinnerToNextRoundSeed`** so previews do not copy the sentinel into **`seedA`/`seedB`**.

3. **Heuristic bye preference** — Empty R1 neighbour preference added in **`bestEffortOrderParticipantsForGroupBracket`** with **`preferR1ByeSlotBonus`** and **`pickPreferringR1ByeAmong`**.

4. **Commit** — Large cohesive commit on **`main`**: `feat: bracket seeding modes, elimination, and structural bye propagation` (message lists seeding modes, elimination command, structural sentinel, heuristic tweak, web, tests, handoff).

---

_Keep this file aligned when bracket or command contracts change; prefer updating a short “Session notes” paragraph over growing stale bug tables._
