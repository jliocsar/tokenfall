# Tokenfall

An isometric idle RPG that shows the Claude Agents running in Herdr as Heroes. Read-only: no code path may write to a pane.

## Source of truth

- `spec.md`: the design. Section 6 holds the data-oriented rules every hot path follows, and section 10 the milestones.
- `GLOSSARY.md`: the domain words. Use them in code, docs and commits: Hero, not agent sprite; Guild, not repo group.
- `docs/adr/`: decisions that are hard to reverse. Read them before changing the ECS, identity or the wire format.

## Commands

```sh
bun install
bun run dev          # game dev server: the Town at http://127.0.0.1:47320/?heroes=100
                     # (?replay reads a running replayer), benchmark at /bench.html
                     # /?measure=500,1000 measures the full Town into tmp/bench/
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
packages/game/       core/ (sim, stores, systems), effects/ (emitters + GPU), render/, bench/,
                     town/ (the Town page), features/ (one folder per feature)
tools/replay/        Herdr recorder, replayer, synthetic load generator
tools/sprites/       Blender render and pack pipeline, plus atlas.py
tools/ui/            UI skin build: tinted Kenney frames and woff2 fonts (build.py, skin.json)
tools/references/    refresh script for references/repos
data/                every tuning number: budgets, level curve, hero states, effects, world
assets/              committed art. sprites/heroes-atlas.* is what the game loads
```

The daemon, the plugin and `features/` arrive in M1 and M2.

## References: read the source, don't guess

`references/repos/<tool>/` holds a pinned, shallow copy of each dependency's source and docs: `bitecs`, `pixi`, `solid`, `wterm`, `rot`, `herdr`, `plannotator`. Each folder has a `VERSION` file. Before using an API you aren't sure of, read it there. Tooling ignores the folder. To upgrade, bump `references/repos.json` and the dependency together, then run `bun run references`.

Things learned from that source that the docs don't say:

- **bitECS `query()` allocates on every call**: it hashes its terms into a string. Register a query once with `registerQuery(world, terms)` and iterate its `.dense` each frame. Call `commitRemovals(world)` once per frame, which the `commit-removals` system does.
- **bitECS `asBuffer` queries** return a fresh `Uint32Array` view each time `.dense` is read. Read it once per frame.
- **bitECS `addEntity`, `addComponent` and `removeEntity` allocate** (a `Set` per entity, closures per query). They're fine at spawn time and wrong per frame. Membership that changes often, like "moving", lives in a `DenseSet` (`core/dense-set.ts`), not in a component.
- **bitECS entity ids** start at 1 and get recycled, so stores sized to `budgets.entities` are enough. Don't turn on versioning: versioned ids overflow the stores.
- **Pixi's asset loader** treats any JSON with a top-level `frames` key as a spritesheet. Our atlas uses `cells`.
- **WebGL can't upload views of a `SharedArrayBuffer`**, so buffers the GPU reads (effect emitter data) are plain `ArrayBuffer`s. Sim stores stay on `SharedArrayBuffer`.
- **Herdr's `agent.list`** carries the Claude session id in `agent_session.value` when Herdr's own Claude integration reported it. Use it as the Hero id when it's there.

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

Saved state lands in M2, under `~/.local/state/tokenfall/` (`tokenfall-dev/` for the dev daemon). Each format change gets a migration written by Claude through the `.claude/skills/migrate-save-files` skill, which is created alongside the first saved format. Never edit a save by hand.

## Don't

- Write to a Herdr pane, or call any Herdr method outside `events.subscribe`, `agent.list`, `pane.read` and snapshot reads.
- Create Herdr panes except throwaway ones you close yourself, with `--no-focus`. Never touch the user's panes.
- `pkill bun` or kill by name: other Bun servers run on this machine. Kill the PID listening on our port.
- Edit `~/.claude*/settings.json` hooks. The plugin comes in M2, with approval.
- Put scratch work anywhere but `tmp/`.
