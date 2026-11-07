# Tokenfall: spec

Tokenfall is a 2D isometric idle RPG that shows every Claude agent running in Herdr as a hero. You should be able to see who's working, who's finished and who needs you at a glance. It should feel like Ragnarok Online.

The vocabulary is defined in `GLOSSARY.md`, and this spec uses those terms. Spike code lives in `tmp/` and gets rewritten, not promoted.

Status: M0 done. Benchmarked on your machine (Intel Raptor Lake integrated graphics, 144 Hz). M1 in progress.

## 1. Decisions

### Scope

- **Platform:** web first. PWA or Tauri later, if it earns it.
- **Interaction:** read-only in v1. No code path may write to a pane.
- **Agents:** Claude only, from both `~/.claude` and `~/.claude-work`.
- **Machines:** local only in v1. Every hero and event carries a machine id from day one, set to `local`.
- **Sound:** none in v1, but every game event has a stable name so audio can hook in later.

### Grouping

- **Guild:** one Repo. Worktrees of a repository are one Guild.
- **Party:** one Workspace, inside its Guild. A lone Hero is a Party of one.
- **Wanderers:** the Guild for Agents working outside any Repo.
- **Rule as config:** the grouping rule is config, so it can be changed later.

### Progression

- **Experience:** every token billed to the Agent and its Subagents, workflow agents included. That means input, cache writes, cache reads and output, so it runs into the billions.
- **Level:** 1 to 99, derived from Experience on a curve where each Level costs more than the last.
- **Depth:** each Depth Tier covers a quarter of the levels: Prison 1–24, Caves 25–49, Catacombs 50–74, Hell 75–99.
- **Level 99:** the Hero gets a permanent Aura.
- **Existing Agents:** they show up at their real Level from the start, with no level-up bursts and one Chronicle line each.

### Life and death

- **A Hero is one Agent's session:** `/compact` and resume keep the same Hero. `/clear`, a fork or a fresh `claude` make a new one.
- **Death:** exiting, killing and `/clear` all cause a Death, and every Death plays the same Death Scene: the Horde attacks and the Hero falls. The Death Scene is one replaceable event.
- **Graves:** a Grave stands in the Graveyard for 24 hours.
- **Resurrection:** resuming a dead Hero's session brings it back at its old Level. It rises from its Grave if the Grave still stands, otherwise it arrives through a Warp Portal at its Camp.
- **Hero records** are kept forever.

### Characters

- **Personality:** rolled at random from about 8, like Brave, Cunning, Scholarly, Pious, Wild, Stoic, Cheerful and Grim. It sets the Class and the voice of the Hero's Narration.
- **Look:** name, palette and portrait are seeded per Hero. A future character creator will show these values pre-rolled, ready to edit.
- **Title:** a Hero whose Agent has a Herdr name gets it as a Title, so `code-reviewer` becomes "Aldric the Code Reviewer".
- **Lead:** `/team` marks its lead's pane with a Herdr sidebar label, and the game gives that Hero a crown.
- **Minions:** at most 5 shown per Hero, with a counter like "+37" for the rest.
- **Portraits:** simple generic placeholders in v1. Blender close-ups of each Hero's own model come later.

### Attention

- **Ravens** appear for exactly two things: a permission prompt in the terminal (Herdr's `blocked`) and a question sent to the Plannotator Inbox. Each Raven shows where to answer. Reports and FYI messages get nothing.
- **Loot Chests** appear when an Agent finishes. A chest opens only once you've looked at that Agent in Herdr, so the game never marks anything seen itself.
- **Attention Queue order:** Ravens first, then Loot Chests. One key cycles through it.
- **Nothing leaves the game:** no phone or desktop notifications.

### Feel

- **Effects:** Ragnarok-style and GPU-based, all in v1: the angel ring burst on level up, the Level 99 Aura, Warp Portals, Resurrection, the Death Scene and Hero light.
- **Warp Portals:** Heroes walk to their Guild's Dungeon entrance and warp in, and warp out when they finish. Warp Portals are how a Hero appears anywhere.
- **Chronicle:** a Ragnarok-style chat box logs Level ups, Deaths, Ravens and Resurrections. When you come back to the tab, the game jumps to the current state and skips missed animations, and the Chronicle tells you what happened.
- **Town:** permanent dusk, so Hero light always reads.
- **Light:** Heroes emit light when it's dark around them. There's no torch sprite.
- **No emotes in v1.**

### Project

- **Repo:** private on GitHub at `jliocsar/tokenfall`.
- **Paths:** config in `~/.config/tokenfall/`, state in `~/.local/state/tokenfall/`.
- **Generated art:** rendered sheets are committed, not rebuilt on each machine.
- **References:** a minimal shallow copy of each dependency's source and docs lives in `references/repos/{tool}`, pinned to the exact version we use, with no git history. One script refreshes them on upgrade, tooling ignores the folder, and `CLAUDE.md` lists them so agents read the real source instead of guessing. This covers bitECS, Pixi, Solid, wterm and rot.js, plus Herdr and Plannotator.
- **Save migrations:** handled by Claude through a `.claude/skills/migrate-save-files` skill, described in `CLAUDE.md`.
- **Keybinds:** decided during the build and listed in `packages/game/src/render/camera.ts`. So far: WASD or arrows pan, drag pans, wheel or `+`/`-` zooms. Rotation and the Attention Queue key come in M1.

### Failure states

- **Blocking:** the game blocks with a full-screen message only when it can't reach the daemon, or Herdr is down.
- **Partial:** if the inbox or transcripts fail, the game keeps running with a small banner, like "Ravens unavailable".

### Look

- **Art:** isometric, pre-rendered from CC0 KayKit models with Blender.
- **UI:** dark fantasy windows framed with textures, based on Kenney's Fantasy UI Borders. Its license still needs confirming.

### Tech

- **Language:** TypeScript.
- **Daemon:** Bun, running as a systemd user service from login.
- **Rendering:** PixiJS 8 on WebGL2.
- **ECS:** bitECS 0.4, with typed-array component stores. See ADR 0003.
- **UI:** SolidJS.
- **Terminal view:** wterm.
- **Toolchain:** Bun, oxlint, oxfmt and TS7, from your `agents-boilerplate`, with no Effect in the game sim.
- **Math library, when needed:** `math` from pmndrs (MIT, allocation-free functions that write into an `out` argument). We adopt it the first time we need noise for Dungeons, springs for the camera, easing, shapes or color. It doesn't replace our existing iso, level or random code, and hot loops stay scalar over our stores.

## 2. Goals

v1 is done when you can open the game and:

1. See every live Claude Agent as a Hero at its real Level, grouped by Guild and Party.
2. Tell from the Roster alone who's working, finished or waiting on you.
3. Jump through the Attention Queue with one key.
4. Read Narration in each Hero's own voice.
5. Watch working Heroes warp into their Guild's Dungeon, deeper as they level.
6. Get a Raven for every permission prompt and inbox question, and see it clear once answered.
7. Open a Character Sheet with a read-only terminal.
8. See the Death Scene, Graves and Resurrections.
9. Catch up on what you missed from the Chronicle.
10. Reboot your machine and get the same world back.

### Not in v1

Prompting or starting Agents, the character creator, the software factory, Blender portraits, sound, emotes, gear upgrades, multiple machines, the open-field map for 100+ Hero armies, non-Claude agents, and native builds.

## 3. Game model

### Status to behavior

| Herdr status | Behavior |
| --- | --- |
| `idle` | Relaxing at the Guild's Camp |
| `working` | Walks to the Dungeon entrance, warps in, and works at its Depth Tier |
| `done` | Warps out to Camp with a Loot Chest |
| `blocked` | Raven, terminal kind |
| `unknown` | Stands still, shown dimmed |

Herdr's `done` means idle and not yet seen. Seen is per tab, not per pane: switching to the tab or refocusing the terminal on it marks every pane in that tab seen. There's no status event for that, so the daemon re-reads status after `workspace.focused`, `tab.focused` and `pane.focused` events. None of this has been tested live yet.

### Level curve

Tuned on your real numbers. Across 356 local sessions, with cache reads counted, the median session used 1.93M tokens, the 90th percentile 54M, and the biggest 3.83B.

The starting targets are a median session around Level 40, the 90th percentile around 65, and Level 99 at about 4B tokens. The curve and the targets are both data, not code.

### Identity

- **Key:** a Hero is keyed on its Claude session id.
- **Panes:** a pane id tracks where the Hero lives right now. Pane ids survive a Herdr restart, but they change when a pane moves to another Workspace.
- **Terminal ids:** they survive a pane move but not a Herdr restart, so they're never used as identity.
- **Before the first hook:** an Agent that hasn't reported a session id yet is shown by pane id, then linked when the first hook arrives.

### Death detection

| Signal | Result |
| --- | --- |
| `pane_closed`, `pane_exited` | Death |
| `pane_agent_detected` with `released: true` | Death: Claude quit, shell stayed |
| `SessionEnd`, any reason except `resume` | Death. `/clear` counts |
| `SessionStart` with `source: resume` for a dead Hero | Resurrection |

Signals are deduped per Hero. Losing the Herdr connection kills nobody. Herdr restores Claude panes after a restart by running `claude --resume`, so Heroes come back as themselves. Heroes still missing after a full resync get a Grave without a Death Scene.

### Narration

Narration lines live in data files keyed by Personality and tool name. They're written once by Claude, skimmed by you, and committed, so nothing is generated while the game runs. Unknown and MCP tools fall back to a generic pool per Personality. `tool_input` never reaches a line.

### Light

The scene is multiplied by a light map of ambient light plus additive lights. A Hero turns its light on below 0.30 brightness and off above 0.42, so it doesn't flicker at the edge. Both values need tuning.

## 4. Town and roster prototype

Built first, on recorded and synthetic data. It needs to answer:

1. How do Guild Camps, Party clusters and the Graveyard lay out at 10, 100 and 500 Heroes? The Town comes from a seed rolled on first launch and saved, so everyone's Town differs but yours never changes. Each new Guild takes the next plot in seeded order, Camps never move, and plots get reused when a Guild's last Hero is gone.
2. How does the Roster collapse Guild, Party and Hero rows so attention is always visible?
3. How does a Dungeon entrance show what's inside it?
4. Where do Narration bubbles go when hundreds of Heroes could speak?
5. Does the dark fantasy UI skin read well over the dusk Town?

You pick a direction from running builds, not mockups.

**Picked so far:**

- **Layout:** the road town. A main road leads out of the gate, with side streets every two plots. Guild plots fill outward along it in seeded order: two deep on each side of the road, then further back. The Graveyard sits by the gate. Each Dungeon entrance sits at the back of its Guild's plot.
- **Roster:** a tree of Guild, then Party, then Hero rows. "Needs you" is pinned on top, with Ravens first and then Loot Chests. Collapsed rows show counts. Above 60 Heroes the Guilds start collapsed. Each Hero row shows a portrait, name and Title, Quest, Level and status.
- **Dungeon entrance:** a badge above it with the number of Heroes inside and four tier pips.

## 5. Architecture

```
Herdr socket ──────────┐
Claude hooks ──────────┤
Transcript files ──────┼─> Daemon (Bun, always on) ── snapshot + deltas ──> Game (browser)
Inbox JSONL files ─────┘   adapters, identity,                            bitECS sim, Pixi + GPU
                           experience, SQLite                             effects, Solid UI
```

- **The daemon owns the truth** and persists it. The game is a projection that can be thrown away and rebuilt from a snapshot, which is also how it recovers when a system throws.
- **Graceful resume:** after a reboot or a Herdr restart, the daemon starts from its last saved state, serves it immediately, and resyncs with Herdr, the transcripts and the inbox. The game never shows an empty world while syncing.
- **First run:** the daemon picks up whatever Herdr has right now and backfills Experience from the transcripts.
- **Adapters:** they're the only code that knows external formats. Everything past them uses the types in `protocol`.

### Repo layout

```
CLAUDE.md            agent instructions: references, save migrations, the rules in section 6
.claude/skills/      migrate-save-files
references/repos/    dependency source and docs, read-only
packages/protocol/   event, snapshot and id types, no dependencies
packages/daemon/     adapters/{herdr,hooks,transcripts,inbox}, identity, experience, store, server
packages/game/       core/, effects/, ui/, features/{town,roster,narration,light,dungeon,minions,raven,chest,death,chronicle,character-sheet,terminal}
plugin/              Claude plugin with the hooks
data/                personalities, narration, names, level curve, effect definitions
tools/sprites/       Blender render and pack pipeline
tools/replay/        event recorder, replayer, synthetic load generator
assets/              generated sheets, UI skin, fonts, CREDITS.md
```

A feature is a folder of components, systems and data. Removing the folder removes the feature, so features can't import each other. They talk through components and events in `core/`.

## 6. Data-oriented design

These rules apply to all game and daemon hot paths, and get checked in review.

### Layout

1. Components are struct-of-arrays stores of typed arrays, indexed by entity id. They hold only numbers and entity ids, never strings or objects.
2. Strings live in side tables indexed by a `uint32` id, and only the UI reads them.
3. Renderer objects live in plain arrays indexed by a slot number held in a component.
4. Tuning lives in `data/`, not in systems: curve, tiers, thresholds, effects, narration and names.
5. Every store is allocated at a fixed capacity up front, on `SharedArrayBuffer` so systems can move to workers later. Memory gets budgeted per component and checked against the synthetic load. Buffers the GPU reads, like effect emitter data, are plain `ArrayBuffer`s, because WebGL refuses views of shared memory.

### Per frame

6. Nothing is allocated in the frame loop. Use pools, preallocated typed arrays and reused scratch buffers.
7. Every system declares its complexity in its `complexity` field, for example `'O(moving heroes)'`, since the linter forbids comments. Nothing per frame scales with total Heroes unless that field says so. The M0 render sync is O(Heroes) for its depth sort and cull; a spatial grid replaces it if the benchmark asks for one.
8. Events drain in one system at the start of the frame. Network callbacks only push to a queue.
9. Heroes are looked up through an id-to-entity index in O(1), a typed array, never by scanning a query.
10. Off-screen Heroes are just data. Moving between places is a timestamp, resolved when it comes back into view.
11. Town movement uses shared flow fields per destination, not per-Hero A*.
12. Budgets for visible bubbles, lights, Minions and Horde units, with the excess dropped by priority.
13. Entity spawns are spread across frames, so a backfill of hundreds of Heroes doesn't spike one frame.
14. Hero states are table-driven state machines. Each Hero's state is a `uint8` in a typed array, and the transitions live in a table in `data/`, for example `working` plus `done` becomes `warping-out`. Systems advance states from that table each frame. The runner is a small set of pure functions, and diagrams can be drawn from the table. Multi-step behaviors like "walk to the entrance, then warp in" work the same way, never as callbacks or coroutines. UI state uses Solid signals.
15. Single-threaded in v1. Systems move to workers only if profiling says so, using `asBuffer` queries. Structural changes stay on the main thread.

### Daemon

16. Transcripts are tailed from saved byte offsets, never re-read whole. Usage is deduped by `message.id`, keeping the largest value of each field across its lines, across all files.
17. Events get coalesced into deltas on a fixed tick, starting at 10 Hz. Token usage becomes a counter per Hero.
18. JSON first. Move to a binary format only if profiling says so.

### Rendering

19. Share atlases to keep batches small, and cull before sorting.
20. One wterm instance, which exists only while a Character Sheet is open.

### Performance targets

On your real machine: 60 fps with 500 Heroes, 30+ fps with 1000, no steady-state garbage collection while the game runs, and hooks that add no noticeable delay to Agents. A synthetic load test with 1000 Heroes runs in CI and fails on regressions.

**Measured in M0** on Intel Raptor Lake integrated graphics at 144 Hz, 2286x913:

| Scenario | GPU mean / p99 | CPU sim + sync | CPU render submit |
| --- | --- | --- | --- |
| 1000 Heroes | 0.78 / 1.70 ms | 0.57 ms | 0.64 ms |
| 1000 Heroes + 512 angel rings (49k particles) | 1.41 / 2.19 ms | 0.44 ms | 0.48 ms |

The display's 144 Hz was the ceiling in every scenario where the tab stayed in front. So the targets are raised: **144 fps with 1000 Heroes** on this machine, a frame budget of **4 ms CPU** and **3 ms GPU** at p99, and an effects budget of **1.5 ms GPU** for the worst storm. The heap still creeps 1–3 MB per 6 s in the bench, from synthetic event objects and the HUD. That gets traced and closed before the daemon's deltas land in M2.

**Tracing:** every system and render phase records a span into a typed-array ring buffer (`core/trace.ts`), exported as a Chrome trace that Perfetto shows as a waterfall. A dev mode wraps every function. M1 can draw the in-game waterfall from the same buffer.

## 7. Effects

- **Stateless GPU particles:** each particle's position, color and size are computed in the vertex shader from its emitter's spawn time, a per-particle seed and the current time. The CPU does no work per particle, and an effect is just one instanced draw.
- **Composable:** an effect is an entity with components like `Emitter`, `EffectShader`, `Lifetime` and `AttachedTo`. Effect definitions live in `data/effects/`, and the angel ring burst is data, not code.
- **Effects in v1:** the level-up angel ring burst, the Level 99 Aura, the Warp Portal, the Resurrection rise, the Death Scene, Hero light, Raven arrival and the chest opening.
- **Platform:** WebGL2 through Pixi as the baseline, with WebGPU as an option later.
- **Validation:** effect shaders get a GPU timing budget, measured in M0 on your machine.

## 8. Integrations

### Herdr

- Socket at `$HERDR_SOCKET_PATH` (defaulting to `~/.config/herdr/herdr.sock`), using newline-delimited JSON.
- **Connections:** a connection that has subscribed can't take another request; a second message closed it in testing. Plain requests also hung on reuse, so assume one request per connection.
- **Status subscriptions:** `pane.agent_status_changed` requires a `pane_id`. New panes are batched about every 250 ms onto a new subscription connection, and connections get compacted over time.
- **Gaps:** after subscribing, re-read with `agent.list`, and reconcile every 30 seconds so missed changes don't stick.
- **Event names:** you subscribe to `pane.closed` and receive `pane_closed`, while `pane.agent_status_changed` keeps its dot. Accept both.
- **Repos:** Herdr only fills `worktree` for workspaces it created as worktrees, so the daemon resolves the Repo itself from each Agent's working folder through git.
- **Labels:** the `tokens` fields aren't token usage, they're sidebar labels. The `/team` lead marker is one of them.
- **Session ids:** `agent.list` carries the Claude session id in `agent_session.value` when Herdr's own Claude integration reported it, seen live on some panes and null on others. When it's there, a Hero is keyed on it from the first sight, without waiting for a hook.
- **Remote machines:** they only answer one-off requests, with no event stream. A future multi-machine view would poll `api snapshot`.
- **Allowed methods in v1:** `events.subscribe`, `agent.list`, `pane.read` and snapshot reads, enforced with an allowlist.

### Claude hooks

Shipped as a plugin, installed in both `~/.claude` and `~/.claude-work` once you approve it.

- **Events:** `SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop` and `Stop`. `PostToolUse` is left out because its `tool_response` can be huge.
- **Delivery:** each is a command hook with `async: true`. It sends stdin with `curl --max-time 1` to every socket in `$XDG_RUNTIME_DIR/tokenfall/`, with `$HERDR_PANE_ID` in a header and `|| true` at the end, so a dead daemon can't hurt an Agent.
- **Dev alongside the service:** the service and a dev daemon each put a socket in that folder, so both get live events. The dev daemon also gets its own state folder (`~/.local/state/tokenfall-dev/`) and port, so your real save is never touched. One dev command runs the dev daemon and the game.
- **Minions:** tool events inside a Subagent carry `agent_id`, which ties them to the right Minion.
- **What's kept:** event name, session id, tool name, agent id, agent type, `SessionEnd` reason and `SessionStart` source. `tool_input` is dropped on arrival.

### Transcripts

- **Where:** `<config>/projects/<project>/<session>.jsonl`, with Subagents in `<session>/subagents/` and workflow agents in `<session>/subagents/workflows/`. Subagent lines carry the parent's session id.
- **What counts:** `message.usage` on assistant lines, deduped as in rule 16. Counting naively nearly doubles the total.
- **Session ids:** `/clear` and forks write a new session file. `/compact`, `--resume` and `--continue` append to the same file under the same id.
- **Privacy:** only usage numbers and ids are read. Message content is never parsed or stored.

### Plannotator Inbox

- **Source:** a read-only tail of `~/.plannotator/inbox/projects/*/questions.jsonl` and `messages.jsonl`.
- **Matching:** a message's `author.session` ties it to a Hero by session id. Questions from sessions with no Hero land on the Town board.
- **Clearing:** a Raven clears when its question has `sent_reply_id`, has `superseded_by`, or its thread has `resolved_at`. Only the superseded case has been seen in real data, so M3 has to check the answered case.
- **Stability:** these files are a private format, so the adapter fails soft and the game shows "inbox unavailable" instead of breaking. `inbox.json` holds a token and is never read.
- **Click-through:** opens the thread, using the address from `plannotator inbox --background`.

### Terminal view

- **Source:** wterm reading `pane.read` with `format: ansi` and `source: visible`, polled at 1–2 Hz while the Character Sheet is open. Repaints are skipped when `revision` hasn't changed.
- **Setup:** a no-op `onData` handler plus `inert`, because wterm echoes keystrokes without one. Columns come from the source pane, scaled to fit, with a bundled nerd font.

### bitECS

- **Package:** 0.4.0, MPL-2.0, about 1.5k GitHub stars. Last npm release December 2025, with commits as of August 2026.
- **Data:** components are plain objects you define, so we write our own struct-of-arrays stores. That's where the data-oriented rules live.
- **Built in:** queries, observers for adds and removes, relations, hierarchies and serialization.
- **Not built in:** component enums and coroutines, which the old becsy spike used. We replace them with tag components plus transition systems (rule 14).
- **Allocation (read in its source):** `query()` hashes its terms into a new string on every call, so systems register each query once and iterate its `.dense`. `addEntity`, `addComponent` and `removeEntity` allocate, so they happen at spawn time only, and fast-changing membership like "moving" lives in our own typed dense sets. Entity ids start at 1 and get recycled, and versioning stays off so ids fit the stores.
- **Threading:** "thread-friendly", not multi-threaded. There's no worker API, but typed-array stores on `SharedArrayBuffer` plus `asBuffer` queries can be shared with workers, and adding or removing entities and components must stay on the main thread.
- **Browser setup:** `SharedArrayBuffer` needs cross-origin isolation, so the daemon serves the game with COOP and COEP headers.
- **Licensing:** MPL-2.0 only covers changes to bitECS's own files, so using it in a private repo is fine.

### wterm

0.5.x, Apache-2.0, a Vercel Labs experiment. Isolated in one feature folder so it's easy to replace.

## 9. Art and UI

- **Sprites:** Blender 5.2 headless renders 8 directions with a 2:1 orthographic camera, at about 50 seconds per character. 128 px cells, 1024x2048 per sheet for idle and walk.
- **Variety:** Class meshes, weapon toggles and per-part palette swaps, all rendered ahead of time. Whole-model hue shifts look bad.
- **UI skin:** windows framed with textures using CSS `border-image`, scaled in whole pixels, with each skin as one file of CSS variables. Plain CSS, no Tailwind.
- **Fonts:** a pixel font for headings and numbers, and a readable font for longer text.
- **Credits:** all packs are CC0 per their license files unless noted, credited in `assets/CREDITS.md`.

| Need | Pack | State |
| --- | --- | --- |
| Heroes | KayKit Adventurers | Rendered and tested |
| Dungeon | KayKit Dungeon Remastered | One room tested, corner gap to fix |
| Town | KayKit Medieval Hexagon | Not tested, built for hex tiles |
| Horde | KayKit Skeletons | Not tested |
| Graves | KayKit Halloween Bits | Not tested |
| UI frames | Kenney Fantasy UI Borders | Not tested, license not confirmed |
| Fonts | To pick | Must be OFL or CC0 |

The Depth Tiers start as palette and lighting changes on the one dungeon set. Hell may need more than that.

## 10. Milestones

Each one ends with something you can run.

**M0: Foundations. Done.** Repo, toolchain, `protocol`, recorder and replayer, synthetic load, the effects core with one stateless particle effect, and the id-to-entity index. Done when we have real render and effect benchmarks for 100 to 1000 Heroes on your GPU, and section 6 is adjusted to match.

**M1: Town and roster prototype.** Answers section 4 on replayed and synthetic data. Includes the UI skin, Hero light, placeholder portraits, names, Personalities and Titles. Done when you've picked a direction.

**M2: Live, read-only.** Daemon as a service, the Herdr, hook and transcript adapters, Experience with backfill, Levels and the level-up effect, the Aura, the Roster and Attention Queue on real data, Narration, the Chronicle, SQLite, and graceful resume. Done when your real Agents appear at their true Levels and survive a reboot.

**M3: Ravens, chests and the terminal.** Inbox adapter, permission Ravens, Loot Chests cleared by seen state, the Character Sheet and the terminal view. Done when a real question raises a Raven that clears once answered, and looking at a finished Agent in Herdr opens its chest.

**M4: Dungeons.** Seeded generator using rot.js, with a seed stored per Guild, four Depth Tiers, Warp Portals, Minions and the lead's crown. Like Diablo, only one Dungeon is open at a time, showing one tier. It opens on the tier of the Hero you clicked, and stairs or keys switch tiers. Done when you can watch a Guild at any tier.

**M5: Death and Resurrection.** Death Scene, Horde, Graveyard, 24-hour Graves and Resurrection. Done when killing, clearing and resuming a test session all play out correctly.

**After v1:** prompting from the game with an auth token and Origin checks, then the character creator and hiring heroes, then the software factory. Also on the list: Blender portraits, sound, multiple machines and the open-field army map.

## 11. Verified and not

**Built and tested in M0:**

- The sim core with 1000 synthetic Heroes: 0.024 ms mean per frame in Bun, in the CI load test.
- The Herdr recorder against live Herdr: `agent.list`, per-pane status subscriptions and repo resolution through git.
- The stateless particle effect and hero particle layer in the browser, then the full benchmark on your GPU (section 6).
- Function-level tracing, with the trace-everything mode tested on the bench page.

**Tested in spikes:**

- Live Herdr roster, status events, pane creation and close.
- An ECS with Pixi in the browser, though that spike used becsy, not bitECS.
- wterm with real ANSI output.
- The sprite pipeline and the light map.

**Read in Herdr's and Claude's source, docs or local data, but not tested live:**

- Herdr seen state and restore behavior.
- Claude session id rules and token counting.

**Unknown:**

- Whether one subscription connection can carry hundreds of panes.
- How heavy hooks are with hundreds of Agents.
- Serving with COOP and COEP headers alongside the inbox click-through and fonts.
- How the town pack and UI frames fit.
- Whether the Depth Tiers read at game zoom.

## 12. Security and privacy

- **Read-only:** enforced by the method allowlist, not by convention.
- **Server:** binds to `127.0.0.1` and checks Origin plus a per-launch token, because terminal contents are sensitive.
- **Hook socket:** mode `0600`.
- **What's stored:** never message content, tool inputs or inbox bodies. SQLite holds identity, Experience, Graves and the Chronicle, under `~/.local/state/tokenfall/`.
