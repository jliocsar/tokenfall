# Sticky control, and shrinking only when needed

Amends ADR 0006 (control is held only while the terminal has focus) and ADR 0007 (typing always shrinks the pane to a 14 px grid). Both made every click into and out of the terminal reflow the Agent twice. Two reviews found that this, plus half-reflowed frames showing during the switch, was most of what felt off.

How it works now:

- **Keys still follow focus.** Input and wheel scrolling reach the pane only while the terminal has focus and Herdr has granted control. A blur stops them at once, in the daemon.
- **Control outlives focus, briefly.** After a blur the daemon keeps the controller, and the pane keeps the typing size, for `terminal.lingerMs` (10 s, `data/daemon.json`). Clicking back in within that time is instant: no spawn and no reflow. Closing the sheet, switching Hero, a dropped socket, or the linger running out releases it. That's tmux's `window-size latest`: the size stays with the last active client.
- **Shrink only when needed.** The sheet asks for the largest grid that fits its frame at `typingGrid.readablePx` (12 px). The daemon caps it at the pane's own size. So a pane that already draws at 12 px or more is never resized, and a wider one shrinks only as far as needed. Rows are kept when they fit.
- **The real pane size.** `pane.layout`'s rect includes Herdr's borders and scrollbar. The daemon uses `pane.get`'s `viewport_rows`, and for columns the rect width minus the same border count minus `terminal.scrollbarCols`. Checked live: a 117×53 rect was a 114×51 PTY, and a 233×56 one was 232×56. An observer asking for more than the PTY gets padding, never scaled text.
- **Make before break.** On focus the observer keeps running, with its frames no longer forwarded, until the controller's first frame. A refusal then never leaves the sheet blank. On release the daemon waits for Herdr's `terminal.closed` before observing again, and the sheet keeps the last frame meanwhile.
- **Settled paint.** When a frame arrives at a new size, the sheet holds painting until the output has been quiet for 50 ms (150 ms at most), so the Agent's half-redrawn screens never show. Window resizes are sent 150 ms after the drag stops.

## Considered Options

- **Release on every blur (ADR 0006):** the safest hold, but it reflows twice per click.
- **Hold control for as long as the sheet is open:** no reflows at all, but the pane stays narrow while you only watch, which ADR 0006 already rejected.
- **Always shrink to a fixed readable size (ADR 0007):** it resized panes that were already fine.

## Consequences

- Your real Herdr pane can stay at the sheet's size for up to 10 s after you click out. During that time no keys reach it from the sheet.
- The write surface is unchanged: the one `control` process, which only `terminal.ts` spawns, never with `--takeover`.
- A control attempt that Herdr refuses with "retry" (a read in progress) is retried once. A pending "Connecting…" gives up after `askTimeoutMs` (3 s), and any release the sheet didn't ask for takes focus off the terminal, so keys are never silently dropped.
