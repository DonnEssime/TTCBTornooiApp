# Playwright E2E Tests

Browser end-to-end tests for the TTC Tornooiapp web UI. These tests perform real clicks and typing in Chromium and verify both visible UI state and backend impact via a dev-only test bridge.

## Prerequisites

- WSL bash (recommended per project conventions)
- Node 22+
- Chromium for Playwright

```bash
cd web
npx playwright install chromium
sudo npx playwright install-deps chromium   # WSL/Linux system libraries (once)
```

If port 5173 is already in use (e.g. a manual `npm run dev`), stop it first or E2E will fail to start its own server:

```bash
fuser -k 5173/tcp   # WSL/Linux
```

## Commands

From repo root:

```bash
npm run test:e2e          # run all E2E tests
npm run test:e2e -w web -- --ui      # interactive UI mode
npm run test:e2e -w web -- --headed  # headed browser
npm run e2e:fixtures -w web          # regenerate JSONL fixtures
```

From `web/`:

```bash
npm run test:e2e
```

The dev server starts automatically with `VITE_E2E=true` (see `e2e/playwright.config.ts`).

## Diagnostics-only policy

This suite is a **diagnostic instrument**. Failures are findings to review — not a mandate to fix the app without approval.

| Rule | Detail |
|------|--------|
| Do not fix app code on failure | Report in `KNOWN-FAILURES.md`; use `test.fixme()` when unclear |
| Fix tests freely | Adjust specs, helpers, fixtures, selectors when the test is wrong |
| App fixes need approval | Only change `web/src/*` or `src/*` after confirming undesired behavior |

See `KNOWN-FAILURES.md` for tests pending review.

## Test bridge (`window.__ttcTest`)

Available only when `VITE_E2E=true`:

| Method | Description |
|--------|-------------|
| `getTournament()` | Clone of active session tournament |
| `getCommandLog()` | Active session command log |
| `exportJsonl()` | Export command log as JSONL |
| `canUndo()` / `canRedo()` | Undo/redo availability |
| `getLastCommandSummary()` | Last command type |
| `clearOpfs()` | Wipe OPFS tournament storage |
| `getActiveTournamentName()` | Active tab name |

Async: `window.__ttcTestListRecent()` for recent tournament list.

## Structure

- `e2e/*.spec.ts` — test specs (01–16 by feature area)
- `e2e/helpers/` — page objects and backend assertions
- `e2e/fixtures/` — committed JSONL import fixtures
- `e2e/scripts/build-fixtures.ts` — fixture generator

## Debug tools policy

Developer shortcuts (fill players, simulate scores) are enabled per tournament via the **Enable debug tools** checkbox on the Settings wizard (next to Create tournament). The checkbox is unchecked by default.

E2E helpers call `enableDebug()` via `createMinimalTournament()` so specs that use `debugFillPlayers` or simulate buttons get debug mode automatically. Specs that create tournaments without the helper leave debug off unless they check the box explicitly.

Some long flows use debug simulate buttons (`debug-simulate-group`, `debug-simulate-bracket`, `debug-simulate-score`) after 1–2 real score entries. Core specs (01, 02, 06, 07, 13, 15) use real interaction only.

## Future CI

When ready, add a GitHub Actions job:

```yaml
- run: npx playwright install --with-deps chromium
- run: npm run test:e2e
```

Upload `playwright-report/` on failure.
