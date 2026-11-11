# Resizing a pane while typing into it

Amends ADR 0006, which took control at the pane's own size so the Herdr view never changed. That made the text unreadable for wide panes: a 233×53 pane fills a 1398 px canvas at about 10 px. An observer can't pick its own size, since Herdr gives it no resize authority, so the only way to bigger text is a narrower pane.

How it works:

- **Watching is unchanged.** While you're only watching, the daemon observes at the pane's own size, and the text is as small as that size needs.
- **Focus asks for a grid.** When you click into the terminal, the sheet works out how many columns and rows fit its frame at a readable font (`data/sheet.json` `typingGrid.fontPx`, 14 px), from the cell size it's drawing now. It sends that grid with `focus`, and the daemon starts `herdr terminal session control` with those `--cols`/`--rows`. Herdr resizes the pane's terminal to the controller's size, so the Agent reflows to fit and the sheet redraws at about 14 px.
- **Never larger than the pane.** The daemon caps the grid at the pane's size from `pane.layout`. A small pane is never grown, and the sheet just scales it up.
- **A window resize follows.** While held, a resized sheet frame sends `resize`, and the daemon writes `terminal.resize` (capped the same way). Frame-driven refits never send one, so the two can't chase each other.
- **Release puts it back.** On `terminal.release`, or when the controller exits, Herdr restores the tab's own geometry. Seen live on a throwaway pane: `tput` read 120×30 while held, 90×25 after `terminal.resize`, and 232×56 after the release.

## Considered Options

- **Collapsible sidebar, or the card as a top band:** they keep the pane untouched, but they only reach about 11.5 to 12 px on a 233-column pane.
- **Resize while only watching:** that needs control, and holding it while watching was already rejected in ADR 0006.
- **Pick a bigger font and crop the columns:** it hides the right edge of whatever the Agent draws.

## Consequences

- While you type in the sheet, your real Herdr pane is that smaller size too, and the Agent's output reflows twice, once on focus and once on release. Before, Herdr only refused to resize it.
- `focus` and `resize` carry a grid, validated to 1–1000 in each direction. `PROTOCOL_VERSION` is 9.
- The write surface is still the one `control` process from ADR 0006. `terminal.resize` is the only new command it sends.
