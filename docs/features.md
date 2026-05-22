# Feature roadmap

Central list of larger product items not yet fully delivered. Smaller fixes and refactors stay in issues/commits; update this file when scope or status changes.

## Planned

### Language support

- **Partial:** EN/NL locale switcher, shared catalog in `src/i18n/`, command `reason` keys, most web UI behind `<Msg>` / `msgText`. Dutch strings are empty until translated (English shown in red).
- Remaining: fill `nl` entries, any stray literals, optional CI `check:i18n` step.

### Multiple competition classes tournaments

- **Partial today:** competition classes can be defined; players are assigned per class; per-class group tabs exist (`SetClassGroups`).
- **Still missing:** full tournament flows with multiple classes — e.g. per-class bracket generation from class tabs (global bracket control is disabled when class tabs are active), and any cross-class scheduling/reporting that product needs.

### Team vs team

- **Partial today:** a single standalone team-vs-team fixture can exist; it blocks player brackets and group phase in several paths.
- **Still missing:** “Team vs team” as a first-class tournament format (see create-tournament UI: option is disabled / coming soon), including group-stage team tournaments and normal bracket integration.

### Direct to brackets

- **Today:** tournaments expect a group phase before knockout (`GenerateKnockoutBracket` requires groups).
- **Still missing:** “Direct to brackets” format — skip group phase and seed/build brackets from registration or explicit seeding (create-tournament UI: option is disabled / coming soon).
