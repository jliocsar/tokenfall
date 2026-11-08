# The Experience ledger dedupes globally, and the first claimant wins

A Hero's Experience is every billed token in its session's transcript files. A fork, a `/clear` or a resume can copy earlier messages into a new session file, still under their original message ids. Claude also writes one message several times as it streams, with usage growing each time.

So the daemon keeps one ledger row per message id for the whole save, not per file or per session. It keeps the largest value of each usage field across the copies. The first Hero to claim a message id keeps it, and later copies in other sessions count for nothing. That's how a fork starts with only the tokens it spends itself.

## Considered Options

- **Dedupe per session:** simpler, but a fork inherits its parent's whole history and lands at the parent's Level on its first sight. You rejected that.
- **Credit the session that wrote the message first, by timestamp:** the fairest rule, but it needs every copy of a message across all files before anything can be counted, and that breaks the read-once-then-tail design.

## Consequences

- When the daemon happens to read a fork before its parent, the fork claims the shared messages and the parent never gets them back. Parents are almost always seen first, because they're older and already on screen.
- The ledger grows by one small row per assistant message ever read: an id and four numbers, never content.
- Changing the rule means throwing away the ledger and the file offsets and re-reading every transcript, which a save migration can do but costs one full read.
