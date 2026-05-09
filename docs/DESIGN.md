# Tournament Tracker (Table Tennis first) — Design Document (Decisions Only)

**Implementation:** delivery status, gaps, and next steps live in [IMPLEMENTATION.md](IMPLEMENTATION.md) (design vs code cross-link).

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

Decision (v1 hosting): **static site only** — e.g. **GitHub Pages** or any static host (no server-rendered app requirement for v1). All application logic runs in the browser; assets are fetched once, then organizer flows work **offline-first** per below.

- **Offline-first**: should the app work fully offline once loaded?

Decision (offline-first): once the app is **loaded**, **admin flows must work fully offline** — **read and write** tournament data **without network**, using the local persistence model in §2/§4 (browser storage APIs, picked files, or equivalent). Viewers may still use optional network refresh where explicitly designed; the **organizer path** is offline-capable.

- **Device constraints**: minimum supported browsers and any “kiosk mode” for tournament desks.

### 2) Local data storage target (“variable spot”)

Decide what “variable spot” means in practice (decision: **admin device is Chrome; local filesystem or transparently network-mounted filesystem**):

Decision (v1 primary write path): **File System Access API** (or equivalent **folder/file pick** with persistent handles) as the **primary** way to read/write the per-tournament `.jsonl` where the browser supports it; **fallback** flows (download / re-upload, or copy of files) remain required for browsers that lack the API—format is unchanged.

- **User-selected file storage**: admin device can use direct folder/file picking in Chrome/Edge.
- **Fallback import/export**: Safari/iOS and Firefox can use download/upload (e.g. a zipped bundle or selected JSONL files) for viewer-style consumption.
- **External providers**: e.g. WebDAV, cloud drives, self-hosted endpoint, etc.
- **Local network**: admin device can optionally act as a “local hub” by hosting tournament data over a minimal HTTP server.
- **Multi-device access**: decision: **single-writer** (admin only). Viewers are **read-only**.

### 3) Browser-local cached settings

- **What is cached**: UI preferences only vs also “last opened tournament” pointers, recently used directories, etc.

Decision (v1): cache **UI preferences** **and** a **full recent-tournaments list** — each entry includes at least **title** (and identifiers needed to re-open the file or tournament, e.g. name + path/handle token per browser limits). Cap list length reasonably (e.g. last N) to bound storage.

- **Privacy posture**: what metadata is acceptable to persist locally.
- **Migration strategy**: versioning of settings as the app evolves.

---

## Data model & file format decisions

### 4) JSONL as the source of truth

- **Log structure**: one JSON object per line (decision: **store commands** for maximal reproducibility; commands are **structured-but-not-friendly** for manual editing).

Decision (primary tournament file): **one append-only `.jsonl` per tournament**, **commands only** (no parallel mandatory snapshot file in v1). A folder may hold **multiple** tournaments (each its own log); tournament identity must appear consistently in command payloads or a small agreed header convention if we add one later.

- **Schema versioning**: per-line version fields, global manifest, or both.

Decision (v1): **header convention** — the log begins with a **first line** (or fixed header block) carrying **schema / format version**; subsequent command lines omit a per-line version field **until** a breaking change forces a bump (then document whether new lines carry their own version or the file is migrated as a whole).
- **Referential integrity**: IDs, stable references, and how to handle deleted/merged entities.
- **Determinism**: rules to ensure replay reconstructs identical state (time, randomness, ordering).
- **Indexing**: whether to maintain derived indexes (locally) for fast UI.

### 5) Entity vocabulary & boundaries

Define which concepts are first-class entities:

- **Player**, **Team** (even if TT is mostly singles), **Match**, **Game** (table-tennis **game**; not “set” by default), **Round**, **Court/Table**, **Tournament**, **Event/Command**.

Decide:

- **Match vs game/set**: what gets stored and validated at which level.

Decision (v1): **Match** is the **command atomicity** unit for results: **one `EnterScore`-style command carries the full list of per-**game** scores for that match** (not one command per finished game). Each **game** remains a first-class scoring unit inside the payload for validation and display.

- **Lineups/doubles**: how teams map to players (for future).
- **Seeding, groups, brackets**: modeled explicitly or as tournament-type plugins.

Decision (entity scope): players are **tournament-local**. A new tournament may initialize by copying from an older tournament, after which they are decoupled.

Decision (tournament initialization): when creating a new tournament from an existing one, copy all configuration/contextual data (players, teams, handicaps, rankings/seeding-related inputs, preferences/config), but **exclude actual match results/outcomes**.

### 6) Identifier strategy

- **ID type**: UUID-like strings, short IDs, human-readable codes.

Decision (v1): **short random strings** (e.g. nanoid-style) for **player and team** entity IDs generated by the app; human-readable display names remain separate from `id`.

- **Stability**: how to handle renames, merges, duplicate players.

Decision (identity / renames): treat identity as **log-versioned** — any change to canonical participant fields (rename, merge, etc.) is represented by **explicit commands** only (e.g. `RenamePlayer`, future merge commands). **No** silent out-of-band edits to history; replay must reconstruct the same state, and undo remains meaningful.

- **Cross-file references**: consistent IDs across JSONL files.

### 7) Tournament reconstruction & “single source”

- **What constitutes “the tournament”**: **Resolved** — see §4: **one command-only `.jsonl` per tournament**; multiple tournaments ⇒ multiple files in a folder (or subtrees), each with explicit tournament identity in data.

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

Decision (v1): **one command per completed match** for score entry — a single command carries **all game scores** for that match (see also §5). Finer per-point commands are **out of scope** for v1.

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

Decision (v1 — lock as command): **Round (or stage) lock is explicit and command-backed** — e.g. a dedicated `SetRoundLock` / `LockStage` command (exact name TBD) records lock state so it participates in **dependency-aware undo** like any other mutation. Unlocking is likewise a **command** (with guardrails / warnings per above), not a hidden toggle.

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

Decision (v1 product): ship **one combined bracket** from group results by default; **multiple performance bands → multiple brackets** may exist **behind a feature flag** or later milestone, but architecture should **allow** it without a rewrite.

- **Seeding**: use standard seeding patterns (e.g. 1–8, 2–7, …) while trying to keep **#1 and #2 from the same group as far apart as possible** in the bracket.

Decision (same-group top-two separation): apply **strict maximum separation** in the bracket between each group’s **#1 and #2** seeds when pairing/placing them. When the bracket size is awkward (byes, non-power-of-two, early **bye / “free” rounds** where one side advances without a played match), **measure separation ignoring those free rounds** — i.e. count effective path distance only through **played** bracket slots (document precisely in implementation notes when coding).

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

- **Score entry**: always require **per-game scores** (for all sports types), **no winner-only shortcut in v1** — **confirmed; not revisiting for v1**.
- **Non-played outcomes**: separate outcome type (initially only **forfeit** supported).
- **Per-stage configuration**: match format can vary by tournament stage (e.g. groups vs bracket).

### 18) Vocabulary & UX terms (TT-first)

Decide consistent terms in UI and data:

- **Table** vs **court**
- **Game** vs **set**
- **Match** vs **fixture**

Decision (playing surface, TT-first): default term is **Table** (table-tennis–native). “Court” is not the default in UI or copy; localization may choose differently later.

Decision (game vs set, TT-first): use **game** in UI and copy (ITTF-aligned); **set** is not the default term.

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

Decision (group standings default): rank by **total matches won**, then **head-to-head among the tied top players** (resolving two-way ties), then **games**, then **points scored**.

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

**Team-vs-team match entry (UX)** — decision: present cross-team play as a **flat list**: **one row per pairing** of a player from side A vs a player from side B (no team-first hierarchy as the primary layout). *Implementation note:* the **current** domain layer uses a single aggregate `TeamMatch` (games scored as team A vs team B). For rosters with more than one player per side, aligning UI with this flat list may require **per-pairing matches/commands** in a later iteration, or a single row when each team fields one player.

### 23) Interaction design & debug features

- **Fast score entry**: mobile-friendly numeric entry, minimizing taps.
- **Error prevention**: validation feedback timing (live vs on submit).

Decision (v1): **live** validation for **score legality** as the user edits (immediate feedback); tune copy so it does not feel noisy on partial input (e.g. only flag clear impossibilities, or stage hints by field).
- **Correction flows**: edit/undo without fear; confirm prompts.
- **Accessibility**: font sizes, contrast, color-blind safe brackets, keyboard support.

**Debug mode** (for UI development & testing):
- **Feature flag**: `DEBUG_MOCK_RESULTS` env/config flag to enable mock result generation.
- **Mock data endpoint**: when enabled, UI can easily fill in placeholder game scores for all scheduled matches in a round (e.g., "fill all with random scores respecting TT rules" or "fill top players as winners").
- **Purpose**: allows rapid UI iteration without manually entering dozens of scores; useful for testing bracket generation, standings updates, state flow without getting bogged down in data entry.

### 24) Role model (optional)

- **Roles**: organizer/admin vs player vs viewer.
- **Permissions**: who can edit results or undo.

Decision (v1): **defer** dedicated roles UI and accounts — assume **single organizer device** with the writable tournament file; viewers consume **read-only** exports or shared views. Revisit PIN/passphrase or multi-role when requirements mature.

---

## Reliability, testing, and safety decisions

### 25) Data safety

- **Backups**: automatic export reminders, redundant storage options.
- **Corruption handling**: partial lines, truncated files, schema mismatch.

Decision (v1 load / replay): on **malformed JSONL** (bad line, truncated file, unexpected shape), **stop** replay, show the **1-based line number** of the first offending line, and **do not** silently skip. The organizer may **manually fix** the file (or a copy) and **resume** loading from a corrected log; the app should support a clear **“retry after edit”** path once the file is valid again.

- **Recovery tools**: verify logs, rebuild indexes, repair commands.

### 26) Test-Driven Development (TDD) strategy

This project will follow a **test-first approach**: tests are formulated ahead of implementation and serve as executable specifications.

**Testing framework selection criteria** (largely satisfied in repo today):
- **Unit test framework**: **Vitest** (with room for **fast-check** per §31).
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
- **Test framework**: **Vitest** for unit/integration testing
- **Architecture pattern**: **Model-Controller-View** with clean separation:
  - **Model layer** (domain logic): fully testable in isolation; no I/O dependencies
  - **Controller layer**: command handlers, state mutation, dependency injection points
  - **View layer**: **Svelte** (v1 choice) — small runtime, compile-time model, strong fit for a **static SPA** with forms, lists, and bracket views without a heavy VDOM stack; team comfort may still pick **Vue** or **React** later if needed, but v1 standardizes on Svelte for weight vs. capability.
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
- **Naming conventions**: terminology (game vs set, table vs court, etc.) — **game** and **Table** decided for TT-first v1 (§18).

How config is stored: JSON manifest, within logs, versioned, with migration path.

### 33) Plugin boundaries (sports, tournament types, sorting)

- Minimum interfaces needed for:
  - **Sport rules** (validation, vocabulary, match structure)
  - **Tournament type** (generation + projection)
  - **Ordering algorithm** (QoL “break variance” default)
  - **Handicap system** (advantage mapping)

---

## Open Q&A checklist (TDD-driven design refinement)

### Recorded answers (explicit product discussion)

These items were **confirmed in writing** during design discussion for this project and take precedence over older “open” bullets where they overlap.

| Topic | Decision |
|-------|----------|
| **Tournament modes** | Support **only** individual per-player tournaments **and**, optionally, **at most one** aggregate team-vs-team match per tournament (two teams, side A vs side B games). **No** team-based tournaments: no multi-team events, team-only group stages, team brackets, or full cross-team player grids. Same detail as § [Current implementation scope (tournament modes)](#current-implementation-scope-tournament-modes). |
| **Offline-first (admin)** | After load: **full offline** for organizer/admin — **read + write** local tournament data **without network**. |
| **Primary tournament document** | **One append-only `.jsonl` per tournament**, **commands only**; multiple tournaments per folder allowed (§4, §7). |
| **Score entry v1** | **Strict per-game scores only**; **no** winner-only shortcut in v1 (not revisiting). |
| **Playing surface term (TT-first)** | Default **Table** (not “court”). |
| **Team-vs-team entry layout** | **Flat list**: **one row per cross-team player pairing** (A player vs B player). See §22 implementation note vs aggregate `TeamMatch`. |
| **v1 hosting** | **Static site** (e.g. **GitHub Pages**); SPA, no SSR requirement. |
| **v1 storage (primary)** | **File System Access API** / persistent file pick where supported; same `.jsonl` format with fallbacks elsewhere. |
| **Command log versioning (v1)** | **Header / first-line** format version; not every line carries version until a breaking change policy says otherwise. |
| **Entity IDs (v1)** | **Short random** app-generated strings (not UUID-by-default). |
| **Group → bracket bands (v1)** | **One** bracket in product by default; **multi-band** allowed **behind a flag** / later; architecture stays extensible. |
| **Score validation UX (v1)** | **Live** as user edits (with UX tuning to limit noise). |
| **Roles (v1)** | **Deferred** — single organizer device + read-only viewers; no accounts in v1. |
| **Local settings (v1)** | **Full recent-tournaments list with titles** (+ fields needed to reopen), capped to last **N**; plus UI prefs. |
| **Renames / identity** | **Log-versioned** — only **explicit commands** (e.g. `RenamePlayer`); no silent edits to history. |
| **Score command granularity** | **One command per completed match** (full per-**game** score list in payload). |
| **Round lock** | **Explicit commands** (`SetRoundLock` / `LockStage` TBD); lock and unlock participate in **undo** like other mutations. |
| **Same-group #1 vs #2 in bracket** | **Strict max separation**; ignore **bye / free rounds** when measuring separation under awkward bracket sizes. |
| **TT term: game vs set** | Default **game** (not “set”). |
| **UI framework (v1)** | **Svelte** — lightweight static-SPA default (see §31). |
| **Corrupt JSONL load** | **Stop**, show **line number** (1-based), **no silent skip**; user **manually fixes** file and **resumes**. |

**Note:** Kiosk/browser floor, import zip, and other §§ may still need decisions; add rows here as they are confirmed.

**[DECIDED]** Framework & testing setup:
- ✅ Language: **TypeScript** (web-first SPA)
- ✅ Test framework: **Vitest** with **fast-check** for property-based tests
- ✅ View (v1): **Svelte**
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
- ✅ Default surface term: **Table** (TT-first)
- ✅ Team-vs-team match entry: **flat list, one row per cross-team player pairing** (§22; model alignment TBD)
- ✅ Score validation: **live** feedback in v1 (§23)

**[DECIDED]** Platform & persistence (v1):
- ✅ Hosting: **static SPA** (e.g. GitHub Pages)
- ✅ Tournament file: **FS Access primary**; fallbacks same format
- ✅ Log versioning: **header / first line**
- ✅ IDs: **short random** strings
- ✅ Bracket bands: **one bracket** shipped; **multi-band** behind flag / later
- ✅ Roles: **deferred**; single-organizer assumption
- ✅ Recent tournaments: **full list with titles** in local settings
- ✅ Renames: **command-only**, log-versioned identity
- ✅ Enter score: **one command per match**
- ✅ Lock: **explicit lock/unlock commands**, undoable
- ✅ Bracket: **strict #1/#2 separation**, **ignoring bye rounds** in distance metric
- ✅ Terminology: **game** (not set) for TT
- ✅ View: **Svelte**
- ✅ Corrupt log: **fail at line**, manual fix + resume

**Remaining clarifications** (still open unless decided elsewhere in this doc):

1. **Score entry UX**: **Mobile-oriented input** only (keypad layout); **live** validation is **decided** (§23).

2. ~~**Single team-vs-team match (UI)**~~ **Decided** — flat pairing rows (§22); backend may need to grow to match multi-row UX.

3. ~~**Bracket seeding & draw**~~ **Partially decided** — same-group **#1 vs #2 max separation**, **ignoring free/bye rounds** in the separation metric (§12). Remaining product detail: **band count** (behind flag), **fill vs cull** default copy.

4. **Initial test specification priorities**: Which cases to pre-write **first** as the domain grows (e.g. TT score legality, bracket generation, undo dependencies). **Team-tournament test batches (Batch 3)** are **out of scope** under the recorded tournament-mode decision, not merely postponed.

---

## Process note

Design is intentionally incomplete for topics not yet copied into **Recorded answers** or marked decided in a numbered section. Domain and tests may proceed in parallel; when you settle a topic, add it to **Recorded answers** or edit the relevant § in place so “open” lists stay honest. Track what ships in code via [IMPLEMENTATION.md](IMPLEMENTATION.md).

