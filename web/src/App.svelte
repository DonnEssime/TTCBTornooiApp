<script lang="ts">
  import type { BracketMatch, Match, Tournament } from 'ttc-tornooiapp';
  import {
    TournamentController,
    exportCommandsAsJsonLines,
    tournamentControllerFromCommandLog,
  } from 'ttc-tornooiapp';

  let controller = $state(new TournamentController());
  let tournament = $state<Tournament>(snapshot());
  let status = $state<string | null>(null);

  let newName = $state('');
  let newHc = $state(0);
  let fillByes = $state(true);
  let lockRoundInput = $state(1);

  /** Stable player order for seeding (append-only when adding players). */
  let playerOrder = $state<string[]>([]);

  function snapshot(): Tournament {
    return structuredClone(controller.getTournament());
  }

  function pull(): void {
    tournament = snapshot();
    const next = { ...scoreDrafts };
    for (const m of Object.values(tournament.matches)) {
      if (m.status === 'scheduled' && !next[m.id]) {
        next[m.id] = defaultRows(5);
      }
    }
    scoreDrafts = next;
  }

  function newId(): string {
    return `p-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
  }

  function newTournament(): void {
    controller = new TournamentController();
    playerOrder = [];
    scoreDrafts = {};
    status = 'Started a new empty tournament.';
    pull();
  }

  function doUndo(): void {
    status = null;
    const r = controller.undoLast();
    if (!r.success) {
      status = r.reason ?? 'Undo failed';
    } else {
      status = 'Undid one step (logged as Undo command).';
    }
    pull();
  }

  function doRedo(): void {
    status = null;
    const r = controller.redo();
    if (!r.success) {
      status = r.reason ?? 'Redo failed';
    } else {
      status = 'Redo: removed last Undo from the log.';
    }
    pull();
  }

  function addPlayer(): void {
    status = null;
    const name = newName.trim();
    if (!name) {
      status = 'Enter a player name.';
      return;
    }
    const id = newId();
    const cmdId = `cmd-${id}`;
    const r = controller.createPlayer(id, name, newHc, cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not add player';
      return;
    }
    playerOrder = [...playerOrder, id];
    newName = '';
    newHc = 0;
    status = `Added ${name} (${id}).`;
    pull();
  }

  function applySeedingFromList(): void {
    status = null;
    if (playerOrder.length === 0) {
      status = 'Add at least one player first.';
      return;
    }
    const deps = playerOrder.map((id) => `cmd-${id}`);
    const r = controller.setSeedings([...playerOrder], deps, 'cmd-seed');
    if (!r.success) {
      status = r.reason ?? 'SetSeedings failed';
      pull();
      return;
    }
    status = 'Seeding order saved (command log).';
    pull();
  }

  function runGenerateBracket(): void {
    status = null;
    const t = controller.getTournament();
    if (t.seedings.length === 0) {
      status = 'Set seeding first (use “Apply seeding from list”).';
      return;
    }
    const r = controller.generateBracket(fillByes, false, ['cmd-seed'], 'cmd-gen');
    if (!r.success) {
      status = r.reason ?? 'Bracket generation failed';
      pull();
      return;
    }
    status = 'Bracket generated.';
    pull();
  }

  function createMatchesForRound1(): void {
    status = null;
    const live = controller.getTournament();
    const r1 = live.bracketMatches.filter((m) => m.round === 1 && m.seedA && m.seedB);
    if (r1.length === 0) {
      status = 'No round‑1 pairings with two players.';
      return;
    }
    for (const bm of r1) {
      const mid = `match-${bm.id}`;
      if (live.matches[mid]) continue;
      const a = bm.seedA!;
      const b = bm.seedB!;
      const r = controller.createMatch(mid, a, b, ['cmd-gen', `cmd-${a}`, `cmd-${b}`], `cmd-m-${bm.id}`);
      if (!r.success) {
        status = r.reason ?? 'createMatch failed';
        pull();
        return;
      }
    }
    status = 'Created player matches for every round‑1 bracket pairing.';
    pull();
  }

  function playerLabel(id: string | undefined): string {
    if (!id) return '—';
    return tournament.players[id]?.name ?? id;
  }

  function bracketRows(matches: BracketMatch[]): BracketMatch[] {
    return [...matches].sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
  }

  function movePlayer(id: string, dir: -1 | 1): void {
    const i = playerOrder.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= playerOrder.length) return;
    const next = [...playerOrder];
    [next[i], next[j]] = [next[j], next[i]];
    playerOrder = next;
  }

  function setRoundLock(locked: boolean): void {
    status = null;
    const r = controller.setRoundLock(
      lockRoundInput,
      locked,
      [],
      `cmd-lock-${lockRoundInput}-${locked ? 'on' : 'off'}-${crypto.randomUUID().slice(0, 8)}`,
    );
    if (!r.success) {
      status = r.reason ?? 'SetRoundLock failed';
    } else {
      status = locked ? `Locked bracket round ${lockRoundInput}.` : `Unlocked bracket round ${lockRoundInput}.`;
    }
    pull();
  }

  function downloadJsonl(): void {
    const text = exportCommandsAsJsonLines(controller.getCommandLog());
    const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tournament-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
    status = 'Downloaded command log (.jsonl).';
  }

  async function onImportFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    status = null;
    const text = await file.text();
    const { controller: next, replay } = tournamentControllerFromCommandLog(text);
    if (!replay.success) {
      const reason = replay.results.find((r) => !r.success)?.reason ?? 'Replay failed';
      status = `Import failed: ${reason}`;
      return;
    }
    controller = next;
    playerOrder = Object.keys(controller.getTournament().players);
    scoreDrafts = {};
    status = `Imported ${file.name} (${replay.results.length} commands).`;
    pull();
  }

  type ScoreRow = { a: string; b: string };

  function defaultRows(n: number): ScoreRow[] {
    return Array.from({ length: n }, () => ({ a: '', b: '' }));
  }

  let scoreDrafts = $state<Record<string, ScoreRow[]>>({});

  function addGameRow(matchId: string): void {
    const cur = scoreDrafts[matchId] ?? defaultRows(5);
    scoreDrafts = { ...scoreDrafts, [matchId]: [...cur, { a: '', b: '' }] };
  }

  function submitScores(match: Match): void {
    status = null;
    const rows = scoreDrafts[match.id];
    if (!rows) {
      status = 'Internal: no score draft for this match.';
      return;
    }
    const scores: Array<{ playerA: number; playerB: number }> = [];
    for (const row of rows) {
      const a = Number(row.a);
      const b = Number(row.b);
      if (row.a === '' && row.b === '') continue;
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        status = 'Each entered game needs two numeric scores.';
        return;
      }
      scores.push({ playerA: a, playerB: b });
    }
    if (scores.length === 0) {
      status = 'Enter at least one game score.';
      return;
    }
    const bm = tournament.bracketMatches.find(
      (x) =>
        x.seedA &&
        x.seedB &&
        ((x.seedA === match.playerA && x.seedB === match.playerB) || (x.seedA === match.playerB && x.seedB === match.playerA)),
    );
    const createCmdId = bm ? `cmd-m-${bm.id}` : undefined;
    const deps = createCmdId ? [createCmdId] : [];
    const r = controller.enterScore(match.id, scores, deps, `cmd-score-${match.id}-${Date.now()}`);
    if (!r.success) {
      status = r.reason ?? 'enterScore failed';
      pull();
      return;
    }
    status = `Saved scores for ${match.id}.`;
    pull();
  }
</script>

<main class="wrap">
  <header class="hero">
    <p class="eyebrow">TTC tornooiapp</p>
    <h1>Run a tournament</h1>
    <p class="lede">
      Add players, fix seed order, generate a bracket, create matches for round 1, then type per‑game scores for each match. Commands are logged for
      <strong>JSONL export</strong> / import. Round lock blocks score entry for matches mapped to that bracket round.
    </p>
  </header>

  {#if status}
    <p class="banner" role="status">{status}</p>
  {/if}

  <section class="panel toolbar">
    <button type="button" class="ghost" onclick={newTournament}>New tournament</button>
    <button type="button" class="ghost" onclick={doUndo} title="Append Undo command for latest undoable step">Undo</button>
    <button type="button" class="ghost" onclick={doRedo} disabled={!controller.canRedo()} title="Drop last Undo from log (not a command)">Redo</button>
    <button type="button" class="primary" onclick={downloadJsonl}>Export JSONL</button>
    <label class="file-btn">
      Import JSONL
      <input type="file" accept=".jsonl,.txt,application/json,text/plain" class="sr" onchange={onImportFile} />
    </label>
  </section>

  <section class="panel">
    <h2>Players</h2>
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        addPlayer();
      }}
    >
      <input class="grow" placeholder="Name" bind:value={newName} autocomplete="off" />
      <input class="hc" type="number" bind:value={newHc} min="0" step="1" title="Handicap" />
      <button type="submit" class="primary">Add player</button>
    </form>
    <p class="hint">Seeding list (drag order with ↑ ↓). “Apply seeding” records order as a command.</p>
    <ol class="seed-list">
      {#each playerOrder as pid (pid)}
        <li>
          <span class="name">{playerLabel(pid)}</span>
          <code>{pid}</code>
          <span class="sp"></span>
          <button type="button" class="icon" onclick={() => movePlayer(pid, -1)} title="Up">↑</button>
          <button type="button" class="icon" onclick={() => movePlayer(pid, 1)} title="Down">↓</button>
        </li>
      {/each}
    </ol>
    <div class="row">
      <button type="button" class="primary" onclick={applySeedingFromList}>Apply seeding from list</button>
    </div>
  </section>

  <section class="panel">
    <h2>Bracket</h2>
    <div class="row align-end">
      <label class="chk"><input type="checkbox" bind:checked={fillByes} /> Fill byes to next power of two</label>
      <button type="button" class="primary" onclick={runGenerateBracket}>Generate bracket</button>
      <button type="button" onclick={createMatchesForRound1}>Create round‑1 matches</button>
    </div>
    {#if tournament.lockedBracketRounds.length}
      <p class="locks">Locked rounds: <strong>{tournament.lockedBracketRounds.join(', ')}</strong></p>
    {/if}
    <table class="grid">
      <thead>
        <tr>
          <th>Rd</th>
          <th>Slot</th>
          <th>Pairing</th>
          <th>Winner</th>
        </tr>
      </thead>
      <tbody>
        {#each bracketRows(tournament.bracketMatches) as m (m.id)}
          <tr>
            <td>{m.round}</td>
            <td><code>{m.id}</code></td>
            <td>{playerLabel(m.seedA)} vs {playerLabel(m.seedB)}</td>
            <td>{m.winner ? playerLabel(m.winner) : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="panel">
    <h2>Round lock</h2>
    <p class="hint">While a round is locked, you cannot enter scores for player matches that map to that bracket round.</p>
    <div class="row">
      <label>Bracket round <input class="num" type="number" bind:value={lockRoundInput} min="1" step="1" /></label>
      <button type="button" class="primary" onclick={() => setRoundLock(true)}>Lock</button>
      <button type="button" onclick={() => setRoundLock(false)}>Unlock</button>
    </div>
  </section>

  <section class="panel">
    <h2>Matches & scores</h2>
    <p class="hint">Best‑of‑5 style: enter enough games (e.g. three lines of 11–9) so the library accepts a winner.</p>
    {#each Object.values(tournament.matches) as match (match.id)}
      <article class="match-card">
        <header>
          <strong>{playerLabel(match.playerA)}</strong> vs <strong>{playerLabel(match.playerB)}</strong>
          <span class="meta">{match.status}</span>
        </header>
        {#if match.status === 'scheduled' && scoreDrafts[match.id]}
          <table class="mini">
            <thead>
              <tr><th>#</th><th>{playerLabel(match.playerA)}</th><th>{playerLabel(match.playerB)}</th></tr>
            </thead>
            <tbody>
              {#each scoreDrafts[match.id] as row, gi (gi)}
                <tr>
                  <td>{gi + 1}</td>
                  <td><input type="number" bind:value={row.a} /></td>
                  <td><input type="number" bind:value={row.b} /></td>
                </tr>
              {/each}
            </tbody>
          </table>
          <div class="row">
            <button type="button" onclick={() => addGameRow(match.id)}>Add game row</button>
            <button type="button" class="primary" onclick={() => submitScores(match)}>Save scores</button>
          </div>
        {:else}
          <ul class="done-scores">
            {#each match.scores as g, i (i)}
              <li>Game {i + 1}: {g.playerA}–{g.playerB}</li>
            {/each}
          </ul>
        {/if}
      </article>
    {/each}
    {#if Object.keys(tournament.matches).length === 0}
      <p class="hint">No player matches yet — generate a bracket, then “Create round‑1 matches”.</p>
    {/if}
  </section>
</main>

<style>
  .wrap {
    max-width: 52rem;
    margin: 0 auto;
    padding: 2rem 1.25rem 3rem;
  }

  .hero {
    margin-bottom: 1.25rem;
  }

  .eyebrow {
    margin: 0 0 0.35rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
  }

  .lede {
    margin: 0.5rem 0 0;
    max-width: 46rem;
    color: #334155;
  }

  .banner {
    margin: 0 0 1rem;
    padding: 0.65rem 0.85rem;
    border-radius: 8px;
    background: #e0f2fe;
    border: 1px solid #7dd3fc;
    color: #0c4a6e;
  }

  .panel {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 1rem 1.15rem 1.15rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgb(15 23 42 / 6%);
  }

  .panel h2 {
    margin: 0 0 0.65rem;
    font-size: 1.05rem;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.5rem;
  }

  .row.align-end {
    align-items: flex-end;
  }

  .grow {
    flex: 1 1 12rem;
    min-width: 8rem;
  }

  .hc {
    width: 4.5rem;
  }

  .num {
    width: 4rem;
    margin-left: 0.35rem;
  }

  .hint {
    font-size: 0.85rem;
    color: #64748b;
    margin: 0.5rem 0;
  }

  .locks {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }

  .seed-list {
    margin: 0.5rem 0;
    padding-left: 1.25rem;
  }

  .seed-list li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.35rem;
  }

  .seed-list .name {
    font-weight: 600;
    min-width: 6rem;
  }

  .seed-list code {
    font-size: 0.8rem;
    color: #64748b;
  }

  .sp {
    flex: 1;
  }

  .icon {
    padding: 0.15rem 0.45rem;
  }

  .chk {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.9rem;
  }

  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
    margin-top: 0.75rem;
  }

  .grid th,
  .grid td {
    text-align: left;
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid #e2e8f0;
  }

  .grid th {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
  }

  .match-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.75rem;
  }

  .match-card header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.5rem;
  }

  .match-card .meta {
    font-size: 0.8rem;
    color: #64748b;
    text-transform: uppercase;
  }

  .mini {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
  }

  .mini th,
  .mini td {
    border: 1px solid #e2e8f0;
    padding: 0.25rem 0.35rem;
  }

  .mini input {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    padding: 0.25rem 0.35rem;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
  }

  .done-scores {
    margin: 0;
    padding-left: 1.1rem;
    color: #334155;
  }

  .ghost {
    border: 1px dashed #94a3b8;
    background: #f8fafc;
  }

  .file-btn {
    position: relative;
    display: inline-block;
    padding: 0.5rem 0.9rem;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #fff;
    cursor: pointer;
    font: inherit;
  }

  .file-btn:hover {
    background: #f1f5f9;
  }

  .sr {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    overflow: hidden;
  }

  .grow,
  .hc,
  .num {
    font: inherit;
    padding: 0.35rem 0.5rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
  }

</style>
