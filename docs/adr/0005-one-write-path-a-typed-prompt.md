# One write path: a prompt the person typed

Tokenfall was read-only. Its daemon could call only Herdr's read methods, and an allowlist enforced that. From M7 there is one exception: the prompt box under a Character Sheet's terminal sends the text the person typed to that Hero's pane through Herdr's `agent.prompt`.

The exception is kept as narrow as it can be:

- **One method, one door.** `agent.prompt` is not on the read-only allowlist. The only way to reach it is `sendPrompt(pane, text)` in the Herdr client, and the only caller is the daemon's prompt handler. `request` and `send` still refuse it.
- **Only typed text.** A prompt is sent only from a client `prompt` message, which only the prompt box emits, when the person presses Enter. Nothing in the daemon, the game or a replay sends one on its own.
- **Only a live pane.** The Hero must be live in Herdr, and not blocked on an approval or a question. Herdr refuses a blocked Agent anyway.
- **Nothing kept.** The daemon neither stores nor logs the text. Only the browser keeps the last few prompts, for arrow-up.
- **The same gate as the terminal.** The WebSocket still needs a matching Origin and the per-launch token.

## Considered Options

- **Stay read-only, and copy the prompt** for the person to paste in Herdr: safe, but it isn't steering. It takes a trip to Herdr every time.
- **Send it through the Agent's Inbox thread:** keeps Tokenfall read-only, but only works for Agents that read the Inbox, and only between turns.
- **Allow Herdr's send-keys too,** for an Interrupt button: rejected for now. Keys can answer approval dialogs, which is a much bigger power than typing a message.

## Consequences

- A page holding the token can now type into any live Agent. The token stays per launch and the server stays on `127.0.0.1`, as before.
- The "read-only" promise in the spec and CLAUDE.md now reads "read-only, except a prompt you typed".
- Any further write (keys, focus, starting Agents) needs its own ADR.
