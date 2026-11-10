# Tokenfall

An isometric idle RPG that shows the Claude Agents running in Herdr as Heroes. Read-only: no code path may write to a pane.

## Source of truth

- `spec.md`: the design. Section 6 holds the data-oriented rules every hot path follows, and section 10 the milestones.
- `GLOSSARY.md`: the domain words. Use them in code, docs and commits: Hero, not agent sprite; Guild, not repo group.
- `docs/adr/`: decisions that are hard to reverse. Read them before changing the ECS, identity or the wire format.

## Commands

```sh
bun install
bun run dev          # dev daemon on :47310 (state in ~/.local/state/tokenfall-dev) plus the game
                     # at http://127.0.0.1:47320/, showing your live Agents. ?heroes=100 is
                     # synthetic, ?replay reads a running replayer, benchmark at /bench.html
                     # /?measure measures the full Town into tmp/bench/
bun run dev:game     # only the game dev server
bun run daemon       # the daemon alone (--dev for the dev instance)
bun run install-service    # build, copy to ~/.local/share/tokenfall, run as systemd user unit on :47300
bun run uninstall-service  # remove the unit and the copy; the save in ~/.local/state/tokenfall stays
bun run preview      # production build served at http://127.0.0.1:47321 (measure the shipped build here)
bun run trace        # same, but every function in packages/game and tools/replay is wrapped in a trace span
bun run test         # unit tests plus the 1000-Hero synthetic load test
bun run load         # only the load test
bun run typecheck
bun run lint
bun run fmt
bun run record       # record live Herdr into recordings/herdr-<ts>.jsonl (read-only)
bun run replay -- --file recordings/x.jsonl --speed 4
bun run synthetic -- --heroes 500 --seconds 300 --out recordings/synthetic-500.jsonl
bun run references   # refresh references/repos from references/repos.json
```

## Layout

```
packages/protocol/   wire types: HeroInfo, HeroEvent, Snapshot, Delta, recordings. No runtime deps.
packages/daemon/     the truth: Herdr adapter (read-only allowlist), identity (world.ts), SQLite save
                     with migrations (store/), WebSocket and static server with a per-launch token
packages/game/       core/ (sim, stores, systems), effects/ (emitters + GPU), render/, bench/,
                     town/ (the Town page), features/ (one folder per feature)
tools/replay/        Herdr recorder, replayer, synthetic load generator
tools/sprites/       Blender render and pack pipeline, plus atlas.py
tools/ui/            UI skin build: tinted Kenney frames and woff2 fonts (build.py, skin.json)
tools/references/    refresh script for references/repos
data/                every tuning number: budgets, level curve, hero states, effects, world
assets/              committed art. sprites/heroes-atlas.* is what the game loads
```

`plugin/` is the Claude hooks plugin. Its README has the install commands, which the user runs.

## References: read the source, don't guess

`references/repos/<tool>/` holds a pinned, shallow copy of each dependency's source and docs: `bitecs`, `pixi`, `solid`, `wterm`, `rot`, `herdr`, `plannotator`. Each folder has a `VERSION` file. Before using an API you aren't sure of, read it there. Tooling ignores the folder. To upgrade, bump `references/repos.json` and the dependency together, then run `bun run references`.

Things learned from that source that the docs don't say:

- **bitECS `query()` allocates on every call**: it hashes its terms into a string. Register a query once with `registerQuery(world, terms)` and iterate its `.dense` each frame. Call `commitRemovals(world)` once per frame, which the `commit-removals` system does.
- **bitECS `asBuffer` queries** return a fresh `Uint32Array` view each time `.dense` is read. Read it once per frame.
- **bitECS `addEntity`, `addComponent` and `removeEntity` allocate** (a `Set` per entity, closures per query). They're fine at spawn time and wrong per frame. Membership that changes often, like "moving", lives in a `DenseSet` (`core/dense-set.ts`), not in a component.
- **bitECS entity ids** start at 1 and get recycled, so stores sized to `budgets.entities` are enough. Don't turn on versioning: versioned ids overflow the stores.
- **Pixi's asset loader** treats any JSON with a top-level `frames` key as a spritesheet. Our atlas uses `cells`.
- **WebGL can't upload views of a `SharedArrayBuffer`**, so buffers the GPU reads (effect emitter data) are plain `ArrayBuffer`s. Sim stores stay on `SharedArrayBuffer`.
- **Pixi rebuilds a render group's whole instruction list** when anything in it flips `visible`, changes a BitmapText's text, or redraws a batchable Graphics. Keep churny layers in their own small render group (`isRenderGroup: true`), hide with `alpha`, and swap Sprite textures instead of changing text (see `features/entrance/badges.ts`).
- **Bitmap font glyph textures** carry a 100 px logical size: scale Sprites by `fontSize / font.baseMeasurementFontSize`.
- **Headless Chrome here has no GPU** (it falls back to SwiftShader), so its frame numbers are meaningless and it burns ~10 cores while a Town page is open. Close `agent-browser` when done. Real numbers come from the user running `/?measure` on `bun run preview` (:47321).
- **Herdr's `agent.list`** carries the Claude session id in `agent_session.value` when Herdr's own Claude integration reported it. Use it as the Hero id when it's there.
- **Herdr sends no event when `done` turns `idle`** (seen). The daemon re-reads `agent.list` after focus events and every few seconds while any Hero is done.
- **Herdr's `pane.read` `revision` is always 0.** Hash the text to spot changes. The size comes from `pane.layout` (`rect.width` is the column count).
- **rot.js has one global RNG.** Call `RNG.setSeed` right before each synchronous `create()` in `core/dungeon-gen.ts`, and keep `timeLimit` huge (`data/dungeon.json`) or Digger and Uniform return fewer rooms on a slow frame.
- **Herdr's `tab.list` labels** arrive as `<number> · <label>` on the live server. Strip the number before matching the `/team` skill's `lead` tab.
- **Pixi's `ParticleContainer`** treats `color` as static by default: tinting a particle after the first upload does nothing, and a never-uploaded color draws invisible. Put `color: true` in `dynamicProperties` (see `features/death/horde-layer.ts`).
- **A Pixi `Particle`'s `color` is packed ABGR**, not ARGB: `0xAA_BB_GG_RR`. Write raw `color` values as BGR, or set `tint` (which converts) when it isn't per frame (see `features/combat/monster-layer.ts`).
- **bitECS recycles entity ids**, so the behavior timer serial is never reset on spawn: a stale timer from the old occupant must not fire on the new one.
- **The sim clock is `now + sim.clockOffset`**: `performance.timeOrigin` for daemon and replay sources, 0 for synthetic. Compare it with wire times like `diedAt`, never raw `now`.
- **Tool calls made inside a code-mode tool** (one `mcp__codemode__run` running several Reads) each fire their own `PreToolUse` (seen live), so they count toward a Hero's intensity like parallel calls.
- **Combat marks** (`features/combat/marks.ts`) are two `ParticleContainer`s: HP bars are `Texture.WHITE` particles scaled to size, and damage numbers are digit glyph particles from one bitmap font page. Neither changes text or redraws a Graphics.
- **The Plannotator Inbox** is a private format. `adapters/inbox/parse.ts` follows its own state rules (spec §8). Read only `url` from `inbox.json`, never the token.

## How code is written here

- **Data-oriented, per `spec.md` section 6**: typed-array stores, no allocation in the frame loop, O(1) Hero lookup through `core/hero-index.ts`, table-driven Hero states from `data/hero-states.json`, budgets from `data/budgets.json`.
- **Every system declares its cost** in its `complexity` field, like `'O(moving heroes)'`. That field is the documentation the spec asks for, because comments are linted out. Nothing per frame may scale with total Heroes without saying so there.
- **Comments**: `@jliocsar/begone-slop` rejects them, except `SAFETY:` lines before a type assertion and tooling directives. Durable knowledge goes in this file, the spec or an ADR.
- **Lint order**: top-level types, then constants, then functions, then statements. No `switch`: use a lookup table or an if-chain on a discriminant.
- **JSON from outside** goes through `decodeTrusted` in `@tokenfall/protocol/json`, and only for formats we write or a pinned schema describes.
- **No Effect** in the game sim.
- **Tuning** belongs in `data/`, never as a literal in a system.
- **Tracing**: `core/trace.ts` records spans into a typed-array ring buffer, with nothing allocated per span. Wrap a new phase with `traceBegin(id)` and `traceEnd()`, where `id` comes from `traceId('name')` called once at module load. Every system already gets a span from `runSystems`. On the bench page, "trace 120 frames" (or `?trace`) saves a Chrome trace to `tmp/traces/` and prints the top self-time spans. Open the file at https://ui.perfetto.dev for the waterfall. `bun run trace` adds a span to every non-async function through `trace-all.ts`. Use it to find hot spots, not to judge small functions: two clock reads per call inflate their self time.

## Save migrations

The daemon saves to `~/.local/state/tokenfall/tokenfall.sqlite` (`tokenfall-dev/` for the dev daemon). Every format change gets a migration, written through the `.claude/skills/migrate-save-files` skill. Never edit a save by hand.

## Don't

- Write to a Herdr pane, or call any Herdr method outside `events.subscribe`, `agent.list`, `pane.read`, `pane.get`, `pane.list`, `pane.layout` and `tab.list`.
- Create Herdr panes except throwaway ones you close yourself, with `--no-focus`. Never touch the user's panes.
- `pkill bun` or kill by name: other Bun servers run on this machine. Kill the PID listening on our port.
- Edit `~/.claude*/settings.json` hooks. Hooks ship only through `plugin/`.
- Put scratch work anywhere but `tmp/`.
