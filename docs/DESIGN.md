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

- **Linear undo vs branching history**: if you undo and then do something new, do we keep branches?
- **Edit vs compensating command**: “edit score” as a new command that supersedes prior entries vs rewriting history.
- **Locking**: can finalized rounds be edited? under what constraints?

Decision: score/result edits are allowed only **until lock/finalization**; after lock/finalization, edits are blocked due to downstream implications.

Decision (unlocking): lock/finalization is reversible only with a **significant warning** and only after deleting **all dependent downstream stages**.

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

Decision: first usable version supports:

- **Individual group stage → bracket**
- **Team-versus-team** (two teams, variable team sizes, not necessarily equal; each player plays every opposing player; team result compiled from individual results)

Decisions (individual group stage → bracket):

- **Bracket count**: support a configurable number of brackets formed by **in-group performance bands** (e.g. one bracket with everyone; or separate “top half” and “bottom half” brackets per group; etc.).
- **Seeding**: use standard seeding patterns (e.g. 1–8, 2–7, …) while trying to keep **#1 and #2 from the same group as far apart as possible** in the bracket.
- **Power-of-two handling (lowest bracket)**: provide an option to either:
  - **fill** to the next power-of-two (assigning byes / free wins to top seeds), or
  - **cull** down to the previous power-of-two (cutting off lowest-ranked players).

Decision (team-versus-team winner): decide winner by total **matches won**, with tie-breakers by total **games/sets won**, then total **points won**.

Decision (team-versus-team team sizes): unequal team sizes are allowed; this is accepted as part of the format. Constraint: **every player on the same team plays the same number of matches**, and each team’s total match count is comparable across the fixture.

### 13) “Round” definition

- **What is a round** in each tournament type: simultaneous matches? sequential?
- **Partial rounds**: can a round be started before all matches are scheduled?
- **Late joins/withdrawals**: allowed mid-tournament?

Decision (team-versus-team): rounds are required; aim for each person to play **at most one game per round** (bounded by smallest team size), to make breaks controllable between rounds.

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

Decision (team-versus-team optimizer): a different optimizer is needed; desired experience is to play the **closest-in-strength** games at the end, with **top-vs-top** the very last.

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

- **Score entry**: always require **per-game scores** (for all sports types).
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
- **Scope**: handicap per player globally vs per tournament vs per matchup.
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

Decide which screens are “core” vs “nice-to-have”:

- Current round results entry
- Bracket view with winners
- Table usage (live)
- Upcoming matches queue
- Players list and stats
- Admin/audit/undo history

### 23) Interaction design

- **Fast score entry**: mobile-friendly numeric entry, minimizing taps.
- **Error prevention**: validation feedback timing (live vs on submit).
- **Correction flows**: edit/undo without fear; confirm prompts.
- **Accessibility**: font sizes, contrast, color-blind safe brackets, keyboard support.

### 24) Role model (optional)

- **Roles**: organizer/admin vs player vs viewer.
- **Permissions**: who can edit results or undo.

---

## Reliability, testing, and safety decisions

### 25) Data safety

- **Backups**: automatic export reminders, redundant storage options.
- **Corruption handling**: partial lines, truncated files, schema mismatch.
- **Recovery tools**: verify logs, rebuild indexes, repair commands.

### 26) Testing strategy

- **Property tests** for replay determinism and undo correctness.
- **Rule tests** for TT score legality and handicap interactions.
- **Golden-file tests** for projections (standings/brackets).

### 27) Performance targets

- Expected tournament sizes (players/matches) and acceptable load times.
- Strategy for rendering large brackets and frequent updates.

---

## Security & privacy decisions

### 28) Trust boundaries

- If remote hosting + local data: ensure the app can’t leak tournament data unintentionally.
- If any remote sync is introduced: encryption, authentication, and access control.

---

## Configuration & extensibility decisions

### 29) Configuration surface

- What is configurable per tournament:
  - match format, number of tables, handicap system, ordering algorithm, tie-breakers, naming conventions
- How config is stored: JSON, within logs, manifest, etc.

### 30) Plugin boundaries (sports, tournament types, sorting)

- Minimum interfaces needed for:
  - **Sport rules** (validation, vocabulary, match structure)
  - **Tournament type** (generation + projection)
  - **Ordering algorithm** (QoL “break variance” default)
  - **Handicap system** (advantage mapping)

---

## Open Q&A checklist (what we’ll decide together next)

- **Viewer modes**: expected viewer UX for URI mode vs local SSE share mode (discovery, permissions, caching).
- **TT match format configuration**: which formats must be available in the UI and stored in config?
- **Team-versus-team details**: how to compile team results; which per-player stats to show; how to seed/order players by “performance”.
- **Minimum lovable UI**: which views are mandatory for first usable version?
- **Undo policy**: do we allow editing locked rounds, and how visible is the audit log?

---

## Process note

Design is intentionally incomplete. We must continue this clarifying Q&A in a later session and resolve the remaining decisions before starting implementation.

