# Tournament Tracker (Table Tennis first) — Design Document (Decisions Only)

## Goals (what we’re building)

- **Portable web app**: remotely hosted, works well on phones/tablets/laptops.
- **Local, user-controlled data**: tournament data stored locally “somewhere” (user-chosen location/provider), plus **browser-local cached settings**.
- **Data-first & reconstructable**: entire state reconstructable from **JSONL append-only logs** for players/teams/games/etc.
- **Command–result architecture**: all state changes as commands producing results/events so we can **undo, redo, edit, and audit**.
- **Tournament operations**: scheduling, tracking matches, and tracking **courts/tables** and their occupancy.
- **Great UX**: multiple visual views (round results, brackets, court usage, upcoming games, etc.).
- **Validation**: sport-specific **score legality verification** (only implement table tennis rules initially, but keep abstractions open).
- **Handicaps**: abstract handicap model (default numeric) with ability to swap in alternative notations and advantage tables.
- **Scheduling QoL**: pluggable “game sorting” algorithm; default aims for **minimal variance in player breaks**.

## Non-goals (for now)

- Multi-sport rules beyond **table tennis** (keep interfaces, but don’t implement other sports yet).
- “Always-online” centralized backend storage (unless we later decide we need collaboration).
- Final UI/visual design decisions (this doc lists choices to make, not answers).
- **Team-based tournaments**: no multi-team events, no team-only group stages, no team brackets, and no “each player plays every opposing player” team round-robins. The codebase may still model **squads** only to support a **single optional team-vs-team match** (one aggregate contest between two teams, mutually exclusive with an individual player bracket in the same tournament).

## Current implementation scope (tournament modes)

For now the product and domain code support **only**:

1. **Individual per-player tournaments** — players, scheduling/brackets, and scoring at the player–player match level.
2. **At most one team-vs-team match per tournament** — two teams, game scores recorded between **team A and team B** as sides (not a tournament of many teams). This mode cannot be combined with a player bracket in the same tournament data.

Anything that looks like a **team tournament** (several teams, team standings feeding a team bracket, cross-team player grids, etc.) is **explicitly out of scope** until revisited.

---

## Core architectural decisions to make (no answers yet)

### 1) Hosting & runtime model

- **Static SPA vs SSR/MPA**: purely static hosting (CDN) vs server-rendered pages.
- **Offline-first**: should the app work fully offline once loaded?
- **Device constraints**: minimum supported browsers and any “kiosk mode” for tournament desks.

### 2) Local data storage target (“variable spot”)

Decide what “variable spot” means in practice (decision: **admin device is Chrome; local filesystem or transparently network-mounted filesystem**):

- **User-selected file storage**: admin device can use direct folder/file picking in Chrome/Edge.
- **Fallback import/export**: Safari/iOS and Firefox can use download/upload (e.g. a zipped bundle or selected JSONL files) for viewer-style consumption.
- **External providers**: e.g. WebDAV, cloud drives, self-hosted endpoint, etc.
- **Local network**: admin device can optionally act as a “local hub” by hosting tournament data over a minimal HTTP server.
- **Multi-device access**: decision: **single-writer** (admin only). Viewers are **read-only**.

### 3) Browser-local cached settings

- **What is cached**: UI preferences only vs also “last opened tournament” pointers, recently used directories, etc.
- **Privacy posture**: what metadata is acceptable to persist locally.
- **Migration strategy**: versioning of settings as the app evolves.

---

## Data model & file format decisions

### 4) JSONL as the source of truth

- **Log structure**: one JSON object per line (decision: **store commands** for maximal reproducibility; commands are **structured-but-not-friendly** for manual editing).
- **Schema versioning**: per-line version fields, global manifest, or both.
- **Referential integrity**: IDs, stable references, and how to handle deleted/merged entities.
- **Determinism**: rules to ensure replay reconstructs identical state (time, randomness, ordering).
- **Indexing**: whether to maintain derived indexes (locally) for fast UI.

### 5) Entity vocabulary & boundaries

Define which concepts are first-class entities:

- **Player**, **Team** (even if TT is mostly singles), **Match**, **Game** (set), **Round**, **Court/Table**, **Tournament**, **Event/Command**.

Decide:

- **Match vs game/set**: what gets stored and validated at which level.
- **Lineups/doubles**: how teams map to players (for future).
- **Seeding, groups, brackets**: modeled explicitly or as tournament-type plugins.

Decision (entity scope): players are **tournament-local**. A new tournament may initialize by copying from an older tournament, after which they are decoupled.

Decision (tournament initialization): when creating a new tournament from an existing one, copy all configuration/contextual data (players, teams, handicaps, rankings/seeding-related inputs, preferences/config), but **exclude actual match results/outcomes**.

### 6) Identifier strategy

- **ID type**: UUID-like strings, short IDs, human-readable codes.
- **Stability**: how to handle renames, merges, duplicate players.
- **Cross-file references**: consistent IDs across JSONL files.

### 7) Tournament reconstruction & “single source”

- **What constitutes “the tournament”**: one folder with multiple JSONL files? one combined JSONL? manifest + logs?
- **Import/export**: packaging format (zip?), partial exports, anonymization.

Decision: support **multiple tournaments per folder**, with explicit tournament identity in data references.

---

## Command–result (undo/edit) system decisions

### 8) Command types & granularity

Define the command catalog (conceptually), e.g.:

- Create/update player
- Create round
- Assign match to table
- Enter score
- Confirm/lock round
- Undo/redo, edit score, invalidate match, etc.

Decisions:

- **Coarse vs fine commands**: e.g. “enter match result” as one command vs multiple incremental steps.
- **Atomicity**: what must be atomic for correctness and for undo to feel right.

### 9) Result/event representation

- **Events vs state diffs**: store computed diffs, domain events, or both.
- **Validation placement**: validate at command time only, or also during replay.
- **Audit trail**: what to log for human review (who/when/why).

Decision (command metadata): include original **timestamps** on commands; do **not** store identity or reason notes.

### 10) Undo/redo semantics

**Dependency-aware undo** (critical architectural requirement):

Unlike linear undo (only undo latest action), we support **selective undo**: an action can be undone **if and only if no subsequent action depends on it**.

This requires:
- **Dependency tracking**: maintain a DAG (directed acyclic graph) of command dependencies:
  - Command A depends on Command B if Command A reads/modifies state created or modified by B.
  - Example: "Enter score for Match 5" depends on "Create Match 5"; undoing "Create Match 5" is blocked until score entry is undone.
- **Dependency validation before undo**: before allowing undo of a command, verify no later commands reference it.
- **Undo ordering flexibility**: allow undoing action #3, then #2, then #5 (skipping #4 and #6 which are independent), provided dependencies permit.
- **Redo**: re-applying an undone action only makes sense if all dependencies it relies on are present in the current state.

**Implications for architecture**:
- Each command's result must explicitly declare what state it reads/modifies.
- Commands must be structured such that dependency chains can be computed efficiently.
- Test cases must verify complex undo scenarios (e.g., undo match creation even if later rounds are scheduled; verify bracket recomputation is correct).

**Lock/finalization constraints**:
- Score/result edits are allowed only **until lock/finalization**.
- After lock/finalization, edits are blocked due to downstream implications.
- Lock/finalization is reversible only with a **significant warning** and only after deleting **all dependent downstream stages**.

### 11) Concurrency and conflicts (if multi-device)

If multiple devices can write:

- **Single-writer vs multi-writer**: enforce one editor at a time?
- **Conflict resolution**: last-write-wins, CRDT-like merge, or manual resolution.
- **Clock/time**: ordering guarantees without a server clock.

Decision: **single-writer (admin device only)**. Viewers are read-only.

---

## Tournament types & scheduling decisions

### 12) Tournament type plugin model

- **Plugin interface**: what a “tournament type” must provide (round generation, standings, bracket progression, etc.).
- **Shared primitives**: groups, Swiss, round-robin, single elim, double elim, etc. (listed as future, not implemented yet).
- **Transition rules**: how you move from stage to stage (groups → bracket).

**In-scope now (see “Current implementation scope” above):**

- **Individual group stage → bracket** for **players** (not teams-as-competitors).

Decisions (individual group stage → bracket):

- **Bracket count**: support a configurable number of brackets formed by **in-group performance bands** (e.g. one bracket with everyone; or separate “top half” and “bottom half” brackets per group; etc.).
- **Seeding**: use standard seeding patterns (e.g. 1–8, 2–7, …) while trying to keep **#1 and #2 from the same group as far apart as possible** in the bracket.
- **Power-of-two handling (lowest bracket)**: provide an option to either:
  - **fill** to the next power-of-two (assigning byes / free wins to top seeds), or
  - **cull** down to the previous power-of-two (cutting off lowest-ranked players).

**Deferred / not in current scope — full team-versus-team *tournaments*** (multiple teams, team standings, each player vs each opposing player, team bracket seeding, unequal roster scheduling rules, etc.). A future design pass may revive these; they are **not** targets for the current codebase.

**Single team-vs-team match (only)**: winner is determined from the **aggregate game scores** of that one contest (same table-tennis legality as a normal match, with “A”/“B” mapping to the two teams). Squad `memberIds` are for roster metadata and validation; they do **not** drive a matrix of individual matches in v1.

### 13) “Round” definition

- **What is a round** in each tournament type: simultaneous matches? sequential?
- **Partial rounds**: can a round be started before all matches are scheduled?
- **Late joins/withdrawals**: allowed mid-tournament?

**Deferred (team tournaments)**: if full team tournaments return to scope, rounds and per-player scheduling constraints would be decided then.

### 14) Match generation vs match ordering

Separate:

- **Generation**: which matches should exist in the round.
- **Ordering**: in which order to play them / which get assigned to tables.

Your directive applies to ordering; decisions to make (plus decisions already made):

- **Metric for breaks**: define “break” precisely (time, number of matches, rounds).
- **Fairness constraints**: avoid consecutive matches, avoid repeated opponents, avoid table bias, etc.
- **Pluggability**: how to swap sorting algorithm per tournament/sport.

Decision: ordering remains **properly abstracted** (decision rules must be swappable).

Decision (default constraint): add a hard constraint like **“no back-to-back matches if avoidable”** even if it slightly increases break variance.

**Deferred (team tournaments)**: a dedicated ordering optimizer for cross-team player grids is **out of scope** until team tournaments are.

---

## Court/table management decisions

### 15) Table model

- **Table identity**: named/numbered tables; location notes.
- **Availability**: tables out of service; time windows.
- **Assignment workflow**: auto-assign vs manual drag-and-drop.
- **Reassignment rules**: moving a match mid-play; how to record it.

Decisions:

- **Table equality**: all tables are considered equal (no per-table attributes).
- **Assignment**: table assignment is **always manual** (no automatic assignment).

### 16) Real-time “what’s playing now”

- **State transitions**: scheduled → called → started → finished → verified.
- **Display rules**: what counts as “up next” and “on deck.”
- **Notification model**: optional call-outs, printing, screen casting.

Decisions (viewer updates):

- **Local share mode**: admin device can run a minimal local HTTP host with **SSE** for real-time pushes to viewers.
- **Arbitrary URI mode (web-hosted files)**: viewers can point at any URI; updates via **polling using last-changed timestamp**.

Decision (lifecycle): use a minimal state model of **scheduled** and **finished**.

---

## Table tennis specific rules (implementation decisions)

### 17) Table tennis scoring validation scope

Decisions to define (TT-only implementation, but via sport abstraction):

- **Match format**: configurable; default **best-of-5**, **to 11**, win-by-2, deuce behavior.
- **Per-game scoring legality**: maximum plausible score, incomplete games, forfeits.
- **Edge cases**: retirements, walkovers, disqualifications, missing players.
- **Input UX**: enter per-game scores vs just match result; correction workflows.

Decisions:

- **Score entry**: always require **per-game scores** (for all sports types), no winner-only shortcut in v1.
- **Non-played outcomes**: separate outcome type (initially only **forfeit** supported).
- **Per-stage configuration**: match format can vary by tournament stage (e.g. groups vs bracket).

### 18) Vocabulary & UX terms (TT-first)

Decide consistent terms in UI and data:

- **Table** vs **court**
- **Game** vs **set**
- **Match** vs **fixture**

Localization considerations (if multilingual is a future possibility).

---

## Handicap system decisions

### 19) Handicap representation (abstract, TT implementation uses default numeric)

- **Default numeric model**: decision: **starting score offset** (points head start).
- **Application**: decision: applied **to all games** in the match.
- **Representation constraint**: decision: keep **one player at zero** starting points (the other gets a positive head start or a negative head start).
- **Flexible notation**: how to support future handicap “codes” and an advantage lookup table.
- **Scope**: handicap per player **within one tournament** (fixed for tournament); can change between tournaments.
- **Visibility**: how much to show to players (comfort directive).
- **Validation interaction**: how handicap modifies “legal scores” checks.

---

## Computed views & derived state decisions

### 20) Projection layer (derived models)

- **Where to compute**: in-browser projection from logs; cached projections.
- **Incremental updates**: recompute all vs incremental reducers.
- **Deterministic rendering**: guarantee same standings/brackets after replay.

### 21) Standings and tie-breakers (TT-first decisions deferred)

- **Standing inputs**: match wins, game ratio, point ratio, head-to-head.
- **Configurable rules**: per tournament type.

Decision: matches are **always decisive** (no draws); outcomes are win/loss or a separate outcome type (e.g. forfeit).

Decision (group standings default): rank by **total matches won**, then **head-to-head among the tied top players** (resolving two-way ties), then **games/sets**, then **points scored**.

---

## UI/UX view decisions (visual interface)

### 22) Primary views to ship first

**Minimum v1 views** (required for initial testing & usability):
- **Tournament setup**: create/configure tournament, add players, set match format
- **Round/match entry**: view upcoming matches for current round, enter game scores (per-game breakdown)
- **Bracket view**: visualize bracket structure, see seeding, view results
- **Standings/rankings**: group results, tie-breaker ranking, player statistics

**Future views** (nice-to-have, post-v1):
- Court/table assignment & live occupancy
- Upcoming matches queue/scheduling
- Comprehensive audit/undo history visualization

### 23) Interaction design & debug features

- **Fast score entry**: mobile-friendly numeric entry, minimizing taps.
- **Error prevention**: validation feedback timing (live vs on submit).
- **Correction flows**: edit/undo without fear; confirm prompts.
- **Accessibility**: font sizes, contrast, color-blind safe brackets, keyboard support.

**Debug mode** (for UI development & testing):
- **Feature flag**: `DEBUG_MOCK_RESULTS` env/config flag to enable mock result generation.
- **Mock data endpoint**: when enabled, UI can easily fill in placeholder game scores for all scheduled matches in a round (e.g., "fill all with random scores respecting TT rules" or "fill top players as winners").
- **Purpose**: allows rapid UI iteration without manually entering dozens of scores; useful for testing bracket generation, standings updates, state flow without getting bogged down in data entry.

### 24) Role model (optional)

- **Roles**: organizer/admin vs player vs viewer.
- **Permissions**: who can edit results or undo.

---

## Reliability, testing, and safety decisions

### 25) Data safety

- **Backups**: automatic export reminders, redundant storage options.
- **Corruption handling**: partial lines, truncated files, schema mismatch.
- **Recovery tools**: verify logs, rebuild indexes, repair commands.

### 26) Test-Driven Development (TDD) strategy

This project will follow a **test-first approach**: tests are formulated ahead of implementation and serve as executable specifications.

**Testing framework selection criteria** (to be decided):
- **Unit test framework**: must support property-based testing, fixtures, parameterization, and clear assertion messages.
- **Integration test framework**: ability to test command-result workflows end-to-end with deterministic replay.
- **Test data generation**: fixtures or factories for tournaments, players, matches, JSONL logs.
- **Test isolation**: ability to test domain logic independently from storage/UI concerns.
- **Mocking/stubbing**: clean seams for injecting test doubles (e.g., file I/O, randomness).
- **Performance**: test suite must run quickly to enable TDD feedback loop.
- **Coverage & visibility**: clear reporting of test coverage, especially for critical domain logic.

**Test categories (pre-formulated before implementation)**:

1. **Domain logic tests** (highest priority, must be first):
   - **Command validation**: each command type enforces preconditions (e.g. can't enter score for a non-existent match).
   - **State transitions**: commands produce valid state changes.
   - **Deterministic replay**: applying the same command sequence twice produces identical state.
   - **Undo/redo**: undo correctly reverses a command; redo correctly reapplies it.

2. **Sport rule validation tests** (table tennis focus initially):
   - **Score legality**: valid transitions within a game (0–11, win-by-2 deuce rules, etc.).
   - **Match completion**: correct detection of match winner (best-of-5, etc.).
   - **Handicap interaction**: score legality with head starts applied.
   - **Edge cases**: retirements, walkovers, forfeits, disqualifications.

3. **Data structure & projection tests**:
   - **Standings computation**: correct ranking, tie-breaker application, head-to-head resolution.
   - **Bracket generation**: correct seeding, bye assignment, power-of-two handling.
   - **JSONL round-trip**: serialize & deserialize tournament state with zero data loss.

4. **Scheduling & optimization tests**:
   - **Round generation**: correct match count and player pairings for group/bracket stages.
   - **Ordering constraints**: no back-to-back violations when achievable; fair break distribution.

5. **Storage & resilience tests**:
   - **Log corruption recovery**: graceful handling of truncated/malformed lines.
   - **Schema migration**: forward/backward compatibility for config changes.

6. **UI / event flow tests** (lower priority for TDD start):
   - **Fast entry paths**: verify score input happy path produces correct state.
   - **Concurrent edits** (eventual, if multi-viewer): conflict detection warnings.

**Test formulation approach**:
- Create a **test specification document** (separate file) listing each test case before coding.
- Each test will have: **given (precondition)**, **when (action)**, **then (assertion)**.
- Use **concrete examples** from real tournament scenarios (e.g. "Player A, B advance from group; seed them in bracket; verify #1 vs #8, #2 vs #7 pairings").
- Tests for "happy path" are written first; edge cases added iteratively as they are identified.

### 27) Performance targets

- Expected tournament sizes (players/matches) and acceptable load times.
- Strategy for rendering large brackets and frequent updates.

---

## Security & privacy decisions

### 34) Trust boundaries

- If remote hosting + local data: ensure the app can’t leak tournament data unintentionally.
- If any remote sync is introduced: encryption, authentication, and access control.

---

## Framework & technology decisions (for testing & development)

### 31) Programming language & framework stack

**Decisions made**:
- **Primary language**: **TypeScript** (web-first SPA as first-class concern)
- **Test framework**: **Vitest** or **Jest** for unit/integration testing
- **Architecture pattern**: **Model-Controller-View** with clean separation:
  - **Model layer** (domain logic): fully testable in isolation; no I/O dependencies
  - **Controller layer**: command handlers, state mutation, dependency injection points
  - **View layer**: React/Vue/similar UI framework (TBD)
  - Dependency injection: enable swapping real storage/randomness with test doubles
- **Property-based testing**: **fast-check** (or similar) for invariant validation (deterministic replay, undo correctness)
- **Test approach**: 
  - **Increment-based**: write tests as domain concepts are modeled incrementally
  - **Pre-E2E**: write end-to-end test stubs early; start passing them as implementation progresses
  - Both **unit tests** (domain logic in isolation) and **integration tests** (command replay, JSONL round-trip)

## Configuration & extensibility decisions

### 32) Configuration surface

- **Hosting & runtime model**: web app (SPA/SSR), offline-first, device constraints.
- **Data storage**: local filesystem vs cloud.
- **Match format**: configurable best-of, point targets, deuce rules.
- **Number of tables**: tournament size.
- **Handicap system**: numeric default, custom notations.
- **Ordering algorithm**: pluggable; default aims for minimal break variance.
- **Tie-breakers**: sport-specific ranking rules.
- **Naming conventions**: terminology (game vs set, table vs court, etc.).

How config is stored: JSON manifest, within logs, versioned, with migration path.

### 33) Plugin boundaries (sports, tournament types, sorting)

- Minimum interfaces needed for:
  - **Sport rules** (validation, vocabulary, match structure)
  - **Tournament type** (generation + projection)
  - **Ordering algorithm** (QoL “break variance” default)
  - **Handicap system** (advantage mapping)

---

## Open Q&A checklist (TDD-driven design refinement)

**[DECIDED]** Framework & testing setup:
- ✅ Language: **TypeScript** (web-first SPA)
- ✅ Test framework: **Vitest/Jest** with **fast-check** for property-based tests
- ✅ Architecture: **Model-Controller-View** with clean DI seams for testability
- ✅ Test approach: incremental + pre-E2E stubs, both unit and integration tests
- ✅ Property-based tests: **yes** (deterministic replay, undo/redo invariants)

**[DECIDED]** Tournament structure & algorithm:
- ✅ Scope: **individual group→bracket** for players, plus **at most one team-vs-team match** per tournament if needed — **no team-based tournaments** in current scope
- ✅ Bracket sizing: **default to fill** (assign byes to top seeds) with option to cull
- ✅ Undo semantics: **dependency-aware** (allow undoing any action if no downstream action depends on it)

**[DECIDED]** UI & UX:
- ✅ Minimum v1 views: **tournament setup, round/match entry, bracket view, standings**
- ✅ Debug mode: **mock result filling** with feature flag for rapid UI iteration
- ✅ Fast entry: numeric-friendly score input with mobile optimization

**Remaining clarifications**:

1. **Score entry UX**: 
   - Should we also support "quick match result entry" (just winner, no per-game breakdown) as an alternative, or is per-game-score-entry always required?
   - Any particular mobile-oriented numeric keypad design preferences?

2. **Single team-vs-team match (UI)**:
   - Layout for entering per-game scores when only two **team** sides exist (no grid of player pairings).

3. **Bracket seeding & draw (player tournaments)**:
   - Open questions from §12 that still apply to **individual** brackets only.

4. **Initial test specification priorities**:
   - Which test cases should we pre-write **first** before any implementation? (e.g., TT score legality tests, bracket-generation tests, undo-dependency tests, etc.)
   - Full **team tournament** test batches remain **deferred** until that format is in scope again.

Which of these would you like to tackle next?

---

## Process note

Design is intentionally incomplete. We must continue this clarifying Q&A in a later session and resolve the remaining decisions before starting implementation.

