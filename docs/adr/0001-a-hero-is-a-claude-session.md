# A Hero is a Claude session

A Hero is keyed on its Claude session id, not on the Herdr pane or terminal it runs in. Experience is counted per session from the transcripts. A resumed session is meant to come back as the same Hero with its Level intact. Herdr itself resumes sessions after a restart, so reboots don't lose anyone.

The cost is that `/clear` kills the Hero, because it starts a new session. That's deliberate: `/clear` is how a fresh agent gets started, and resuming the old session resurrects its Hero. Hero records are kept forever, so changing the identity key later would mean migrating them.

## Considered Options

- **Pane id:** survives Herdr restarts but changes when a pane moves to another Workspace, and would keep one Hero across unrelated sessions.
- **Terminal id:** survives moves but not Herdr restarts.
- **One Hero per pane, across sessions:** a `/clear` would keep a veteran in Hell doing unrelated work, and its Experience couldn't come from one session's transcripts.
