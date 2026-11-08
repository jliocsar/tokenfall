# Tokenfall hooks plugin

This plugin forwards Claude Code hook events to every Tokenfall daemon socket in `$XDG_RUNTIME_DIR/tokenfall/`. That's the service daemon (`service.sock`) and the dev daemon (`dev.sock`). Each hook is async, gives up after one second, and exits 0 no matter what, so a missing daemon can't slow an agent down.

It forwards these events: `SessionStart`, `SessionEnd`, `PreToolUse`, `SubagentStart` and `SubagentStop`.

The daemon keeps only these fields: the event name, session id, tool name, subagent id and type, start source and end reason. Everything else in the payload, including `tool_input`, is dropped on arrival.

## Install

Once per config directory:

```sh
claude plugin marketplace add /home/jliocsar/Projects/claude-agents-visualizer/plugin
claude plugin install tokenfall@tokenfall
CLAUDE_CONFIG_DIR=~/.claude-work claude plugin marketplace add /home/jliocsar/Projects/claude-agents-visualizer/plugin
CLAUDE_CONFIG_DIR=~/.claude-work claude plugin install tokenfall@tokenfall
```

Claude copies installed plugins into its cache. After you change anything in this folder, run `claude plugin update tokenfall@tokenfall` (and the same with `CLAUDE_CONFIG_DIR=~/.claude-work`). Sessions pick up the change after a restart or `/reload-plugins`.

## Remove

```sh
claude plugin uninstall tokenfall@tokenfall
CLAUDE_CONFIG_DIR=~/.claude-work claude plugin uninstall tokenfall@tokenfall
```
