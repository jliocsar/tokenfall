# Typing into a pane through Herdr's terminal control

Supersedes ADR 0005. The prompt box, Herdr's `agent.prompt` and the browser's prompt history are gone. From M8 the Character Sheet's terminal is the pane itself: you click into it and type, Esc and Ctrl+C included, and you scroll its history with the wheel.

How it works:

- **Watching is read-only.** While a sheet is open, the daemon runs `herdr terminal session observe <pane>` at the pane's own size (from `pane.layout`) and forwards its frames. Any number of observers can run, and none of them can write.
- **Typing takes control only while the terminal has focus.** Clicking into the terminal swaps the observer for `herdr terminal session control <pane>`, at the pane's own size, so your Herdr view never changes size. Keys (ghostty-web's `onData` bytes) go to it as `terminal.input`, and the wheel goes as `terminal.scroll`. Ctrl+], a click outside or closing the sheet sends `terminal.release` and goes back to observing.
- **Never takes over.** Control is started without `--takeover`. If another client already controls the pane, Herdr refuses, the sheet says "another client is typing here", and it keeps watching.
- **One door.** All spawning of `herdr` lives in `packages/daemon/src/adapters/herdr/stream.ts`, and only `terminal.ts` calls it. A test checks the argv only ever holds `terminal session observe|control` and never `--takeover`. The JSON-socket client is back to the read-only allowlist, with no write methods at all.
- **Nothing kept.** The daemon neither stores nor logs input bytes or frames. Nothing is kept in the browser either.
- **The same gate as before.** The WebSocket needs a matching Origin and the per-launch token. Input is ignored unless that socket holds control, and is capped at 1 MB, which is Herdr's own limit.

## Considered Options

- **Keep the prompt box (ADR 0005):** safe, but a prompt is all it can do. It can't answer a permission prompt, interrupt or scroll.
- **`pane.send_text` on the JSON socket:** no ownership at all, so your typing in Herdr and in the sheet could interleave. No wheel or mouse either.
- **`control` for as long as the sheet is open:** simpler, but it holds the pane (Herdr won't resize it) while you're only watching.
- **`--takeover`:** rejected. It would kick off whoever is typing there.

## Consequences

- A page holding the token can now type anything into a live Agent's pane, including answering approval dialogs. That is a bigger power than ADR 0005's typed prompt, and it's why control is held only while the terminal has focus and never taken over. The token stays per launch and the server stays on `127.0.0.1`.
- While you type, Herdr won't resize that pane. It's released the moment the terminal loses focus.
- The installed service needs the absolute `herdr` path. `install-service` writes it into the unit as `TOKENFALL_HERDR`.
- Any further write (starting Agents, focus, mouse clicks) needs its own ADR.
