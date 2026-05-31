# Feature roadmap

Central list of larger product items not yet fully delivered. Smaller fixes and refactors stay in issues/commits; update this file when scope or status changes.

## Planned

### Language support

- **Partial:** EN/NL locale switcher, shared catalog in `src/i18n/`, command `reason` keys, most web UI behind `<Msg>` / `msgText`. Dutch strings are empty until translated (English shown in red).
- Remaining: fill `nl` entries, any stray literals, optional CI `check:i18n` step.

### Multiple competition classes tournaments

- **Done:** competition classes, per-class registration flags, group phase (`SetClassGroups`), knockout generation/clear/elimination per class track, overview/PDF scoped by track. Single-class tournaments use the same command and model paths with `classId` omitted.

#### Shared resources (one tournament, not duplicated per class)

These are intentional **venue-wide** or **registration-wide** state — not independent copies per competition class:

| Resource | Scope | Notes |
|----------|--------|--------|
| **Physical tables** | Whole tournament | `tables`, live `assignMatchToTable`, and drag/drop on the overview share one table pool. Batch `AssignTables` / `scheduleRound` only replaces assignments for match ids on the requested track and round. |
| **Global seedings** | Whole tournament | `SetSeedings` defines one ordered player list; per-class seedings are derived via `playerClassFlags` and `recomputeClassTournamentSlices`. |
| **`matchFinishOrder`** | Whole tournament | Append-only finish order for match-ordering heuristics (may mix classes). |
| **`forfeitGroupMode`** | Whole tournament | First group forfeit sets `auto-win` vs `not-played` for the event. |
| **Player forfeit record** | One row per player | `forfeits.players[id]` stores `phase` and optional `classId` (track). Group/bracket forfeits apply only to that track when `classId` is set; bracket generation omits group-forfeited players only for the matching class. |
| **Team vs team** | Whole tournament | A standalone team fixture still blocks player brackets and group phase everywhere while it exists. |

Per-class tracks **do** own: `groups`, `bracketMatches`, `lockedBracketRounds`, group/knockout match rows (`Match.classId`), and class-scoped commands (`classId` required when `classDefinitions.length >= 2`).

### Team vs team

- **Partial today:** a single standalone team-vs-team fixture can exist; it blocks player brackets and group phase in several paths.
- **Still missing:** “Team vs team” as a first-class tournament format (see create-tournament UI: option is disabled / coming soon), including group-stage team tournaments and normal bracket integration.

### Direct to brackets

- **Today:** tournaments expect a group phase before knockout (`GenerateKnockoutBracket` requires groups).
- **Still missing:** “Direct to brackets” format — skip group phase and seed/build brackets from registration or explicit seeding (create-tournament UI: option is disabled / coming soon).
