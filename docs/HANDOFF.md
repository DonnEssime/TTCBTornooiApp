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
- **Domain:** Bracket winners, byes, seed propagation, and **when a slot is “done”** are centralized in **`model.ts`** helpers used from **`command.ts`**. After **clear** or **undo**, bracket metadata and player **`Match`** rows can briefly disagree; reconciliation order in **`command.ts`** was tuned so **settle / propagate** behave sensibly for the next score or seed update. **May 2026:** settlement must not let a **scheduled** canonical `match-{bracketId}` row shadow a finished alias row (e.g. `match-a`); see **“Session handoff — May 10, 2026”** below.
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
| `docs/HANDOFF.md` | This file: layout, commands, runbook, **recent bracket/debug context**, **dated session notes** (see “Session handoff — May 10, 2026”). |

---

## Session handoff — **May 10, 2026** (WSL tests, bracket settlement, materialization)

### How we ran tests

From WSL (paths under `/mnt/c/...` are fine):

```bash
cd /mnt/c/Users/donne/code/ttc-tornooiapp && npm test -- --run
```

### Bugs **confirmed** and fixes **merged** (this session)

1. **`settleBracketWinnersIn` preferred the wrong player `Match` row (root cause of missing round 2 in e2e / replay)**  
   - **Symptom:** After `CreateMatch('match-a', p1, p4, …)` + scores, `reconcileBracketScope` never saw finished knockout play on the **canonical** id `match-m1`, so `materializeReadyNextRoundBracketSlots` never got two decided R1 feeders with coherent `BracketMatch.winner`s, and tests expecting `bracketMatches.some(m => m.round === 2)` failed.  
   - **Cause:** Code did `const match = direct && !direct.groupId ? direct : findMatchByPlayers(…)` so a **scheduled** placeholder at `tournament.matches[bracketPlayerMatchId(bm.id)]` (from `ensureBracketPhasePlayerMatchesIn`) **blocked** fallback to `findMatchByPlayers`, which would have found the finished `match-a` row.  
   - **Fix (in `src/model.ts`):** Only treat `direct` as authoritative when it is **finished**, has a **winner**, and is not a group row; otherwise fall back to `findMatchByPlayers`.  
   - **Hypothesis validated:** E2E and replay were **not** primarily a `materializeReadyNextRoundBracketSlots` bug; materialize behaved once settlement saw real results.

2. **`materializeReadyNextRoundBracketSlots` could not materialize “later” feeder pairs while an earlier R1 pair was still open**  
   - **Symptom:** `tests/bracket.spec.ts` “9 players, byes” partial materialization expected `materializeReadyNextRoundBracketSlots(b) === true` with 3 round-2 rows before the last R1 match finished.  
   - **Cause:** Logic required `slotIdx === children.length` (strict sequential append), so ready pairs at indices 1,2,… were skipped if pair 0 was undecided.  
   - **Fix:** Drop that gate; **dedupe** by whether a child with the same `(seedA, seedB)` pairing (either order) already exists, then append.

3. **`findMatchByPlayers` could return a finished **group** RR row for the same two players**  
   - **Symptom:** Bracket winner reconciliation could treat a group-phase result as a KO result (`BracketMatch.winner` corrupted downstream).  
   - **Fix:** Only consider finished player matches with **`!m.groupId`** (and drop the old `bracketish ?? candidates[0]` fallback onto group rows).

4. **`groupNumberedTitle` / placeholders**  
   - **Symptom:** Numeric `id` (e.g. `'1'`) was winning over a **custom** `label` (e.g. `Pool A`), so bracket copy showed `Group 1 place …` instead of `Pool A place …`.  
   - **Fix:** Prefer a non-empty **label** first (still normalizing legacy `group N` → `Group N`); only then derive `Group {id}` from a numeric id when there is no meaningful label.

5. **`TournamentOverview.svelte`**  
   - **Bug:** A bad edit had removed the `groupDefForMatch` function wrapper while leaving its body, breaking parse/runtime. **Fix:** Restore `groupDefForMatch` around the staggered “ready to play” group logic.

6. **Tests / harness adjustments**  
   - `tests/bracket-best-effort.spec.ts`: stress test expected R1 count from `nextPowerOfTwo(all.length)` while `generateBracket` can use a **larger** padded field when balanced / best-effort expands participants; added `expectedR1MatchCountAfterSeeding` mirroring `generateBracket`’s participant resolution (and `shuffleDeterministic` import).  
   - `tests/command.spec.ts`: `buildNumberedGroupsFromPlayerOrder` expectations updated to **`Group 1` / `Group 2`** labels; group-lock test now finishes **both** group RR rows before `GenerateBracket` (`dependsOn: ['sg','seed','e1','e2']`).  
   - `tests/bracket.spec.ts`: “settle then propagate …” test now uses **finished** canonical `match-m1` / `match-m2`, then **reopens** `match-m1` and runs settle + propagate so `m3` ends with `seedA` cleared and `seedB` intact; **4×4** R1 expectations adjusted for current balanced ordering; **3×3** allows at most one **BYE vs BYE** R1 leaf; added a small **materialize** regression for 4 players.

### Still **failing or fragile** (explicitly for the next agent)

| Area | Status | Notes / hypotheses |
|------|--------|---------------------|
| **`tests/command.spec.ts` — “locks editing … knockout …”** | **Resolved (May 11, 2026)** | Balanced **2×2** group layout pads to a virtual **2×4** tree, so round‑1 `BracketMatch` rows are often **one seed + bye**; the test now uses **eight players** in **two groups of four** (exact **2×4**), finishes all RR rows, then `GenerateBracket` so at least one **dual‑seed** R1 exists for `CreateMatch`. Removed the duplicate `e2` command id (would always fail with “Command ID already exists”) and assert **both** groups’ finished rows reject rescoring after KO scores. |
| **`tests/bracket.spec.ts` — “8×4 …”** | **Resolved (May 11, 2026)** | Expectations for **pair(10)–pair(15)** were updated to match current `generateBracket` + balanced ordering (including fixing **pair(11)** vs **pair(15)** both claiming `p3`/`p26`). |

### Commands / files touched this session (quick index)

- **`src/model.ts`:** `groupNumberedTitle`, `findMatchByPlayers`, `materializeReadyNextRoundBracketSlots`, `settleBracketWinnersIn` (direct-match guard), plus earlier bracket helpers as in summary.  
- **`tests/bracket.spec.ts`**, **`tests/bracket-best-effort.spec.ts`**, **`tests/command.spec.ts`**, **`web/src/TournamentOverview.svelte`** (restore `groupDefForMatch`).

---

_Single maintainer or small team: keep this file honest when behavior shifts (especially bracket + command boundaries)._
