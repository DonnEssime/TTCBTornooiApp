# TTCB Tornooiapp — handleiding

Dutch visual how-to for a simple singles **group phase + closed-form knockout**.

## Artifacts

| File | Role |
| --- | --- |
| [index.html](./index.html) | Source document (NL) |
| [print.css](./print.css) | Screen + print styles |
| [images/](./images/) | Playwright screenshots |
| [TTCB-Tornooiapp-handleiding.pdf](./TTCB-Tornooiapp-handleiding.pdf) | Generated PDF |

## Regenerate screenshots + PDF

From the repo root (Chromium via Playwright required):

```bash
npm run howto:pdf
```

This starts the web app with `VITE_E2E=true`, walks a demo tournament in **NL** (no debug tools, handicap 0–9 / max start 7, 16 players, 4×4 groups, gekende formule), writes PNGs under `images/`, and prints `TTCB-Tornooiapp-handleiding.pdf`.
