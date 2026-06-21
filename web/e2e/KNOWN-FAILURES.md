# Known E2E failures (diagnostics)

Last full run: **39 passed / 15 failed / 4 skipped** (8.0 min, Chromium on WSL).  
Test-bug re-run (2026-06-21): **26 passed** across all formerly failing test-bug specs.

Run: `npm run test:e2e -w web`  
Report: `web/playwright-report/` (after failure) or `npx playwright show-report` from `web/`.

## Harness fix applied (2026-06-21)

Initial run failed with **"Test bridge not installed"** because Playwright reused an existing `npm run dev` server without `VITE_E2E=true`. Fixed:

- `reuseExistingServer: false` in `e2e/playwright.config.ts`
- `import.meta.env.VITE_E2E === 'true'` check in `App.svelte`
- Removed static `define` override from `vite.config.ts`

If port 5173 is busy: `fuser -k 5173/tcp` (WSL) before running tests.

## Test-bug fixes applied (2026-06-21)

All nine **test bug** failures are fixed:

| Spec | Test | Fix |
|------|------|-----|
| 01 | handicap config | `workspaceTab()` scopes to `nav.workspace-tabs` |
| 04 | doubles even players | `expectDoublesTrack()` via domain helpers |
| 04 | imported doubles matrix | `importJsonlAndOpen()` + doubles fixture `format` |
| 06 | accepts legal BO5 | Assert finished count diff, not arbitrary match id |
| 08 | two-class isolation | `selectClassTrackTab()` + fixture `cmd-p*` command ids |
| 13 | Dutch create tournament | `waitForTournamentTab()` |
| 15 | language mid-wizard | `waitForTournamentTab('Lang')` |
| 16 | rename persists in tab | `workspaceTab()` |
| 16 | empty tab placeholder | Rewritten: close returns to settings, tab removed |

Helpers added: `workspaceTab`, `selectCompetitionClassTab`, `selectClassTrackTab`, `importJsonlAndOpen`, `expectDoublesTrack`, `expectNewGroupMatchFinished`.

## Remaining failures

None from the original diagnostic batch. **07 redo** fixed via `footerRedoEnabled` derived + correct match id in spec.


| Spec | Test | Fix |
|------|------|-----|
| 03 | blocks illegal 11-10 | Single-game `11–10` rejection (game 2 disabled after `10–10`) |
| 05 | hybrid simulate | Manual first score + `simulateBracketToCompletion()` via placements |
| 05 | removes bracket | Bracket create wait + confirm dialog handler; app `onclick={() => removeKnockoutBracket()}` |
| 07 | multi-step undo | `addPlayer()` navigates to Players tab |
| 07 | redo restores finished | `footerRedoEnabled` derived (UI reactivity) + `finishedGroupMatchId()` helper |
| 11 | round lock | Fixture `cmd-p*` ids; assert save blocked (command layer), not disabled save button |


## Passed areas (high confidence)

- Wizard: minimal, handicap, misc, multi-class, table boundary, empty class name
- Players: add, rename, validation, debug fill
- Groups singles: create, score, hybrid simulate complete, clear
- Groups doubles: even/odd validation, imported pair matrix
- Bracket: closed-form create, score from slot click
- Multi-class: import isolation, class-scoped match ids
- Scores: BO5, deuce, validation rejects
- Undo: single score undo, redo-after-new-action blocked, undo-with-dependents blocked
- Overview tables: stepper, ready list, table grid
- Import/export: JSONL round-trip, valid import, corrupt rejection, OPFS recent list
- PDF export smoke
- i18n locale switch EN/NL, Dutch tournament create
- Player modal: open, rename, match history
- Invariant breakers: modal cancel without mutation, undo with modal, rapid undo, language mid-wizard
- Session: version footer, import control, rename tab, close returns to settings

## How to triage

1. Run the failing test with `--debug` or inspect `playwright-report/`.
2. Classify: **app bug** / **test bug** / **unclear**.
3. If app bug → confirm with maintainer before fixing `web/src` or `src`.
4. If test bug → fix spec/helpers and remove from this table.
5. If unclear → keep `test.fixme()` and note here.
