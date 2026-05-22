# TTC Tournament App

Portable web app for running table tennis tournaments: scheduling, brackets, scores, handicaps, and court usage. Tournament state is driven by an append-only command log (JSONL) so runs are auditable and reconstructable.

## Stack

- **Domain** — TypeScript library (`src/`) with command–result model and tests (Vitest)
- **UI** — Svelte 5 + Vite (`web/`), npm workspace linked to the library

## Quick start

**Prerequisites:** Node.js and npm.

```bash
npm install
npm run dev:web
```

Open the URL Vite prints (typically `http://localhost:5173/`). The dev server binds to `0.0.0.0` so you can reach it from other devices on your LAN.

## Scripts

| Command | Description |
| --- | --- |
| `npm test` | Run unit tests |
| `npm run dev:web` | Start the web UI dev server |
| `npm run build:web` | Production build → `web/dist/` |
| `npm run build` | Build the domain package |

## Layout

```
src/          Domain model, commands, controller, storage
web/          Svelte UI
tests/        Vitest specs
docs/         Design decisions and test notes
```

## Docs

- [DESIGN.md](docs/DESIGN.md) — architecture and product decisions
- [features.md](docs/features.md) — larger planned features (roadmap)
- [TEST_SPECIFICATION.md](docs/TEST_SPECIFICATION.md) — testing approach
