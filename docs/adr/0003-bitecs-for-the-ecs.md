# bitECS for the ECS

We switched the simulation from becsy to bitECS 0.4. It's more mature and more widely used, and its components are struct-of-arrays stores we define ourselves, which is exactly where we want control for hundreds of Heroes. Its data structures can be shared with workers through `SharedArrayBuffer`, so systems can move off the main thread later without changing the data layout.

We lose becsy's component enums and coroutines, so states are tag components and multi-step behaviors are state components advanced by systems. bitECS has no built-in worker API, and adding or removing entities and components must stay on the main thread. Every system is written against it, so swapping it later would mean rewriting the game layer.

## Considered Options

- **becsy:** has enums, coroutines and reactive queries built in. But it's one maintainer releasing about once a year with roughly 300 weekly downloads, against bitECS's 23 contributors and roughly 29,000. In our spike, one thrown error stopped the whole world.
- **XState for Hero states:** gives every machine its own object with subscribers, which goes against keeping hundreds of Heroes as typed-array data. We use table-driven state machines instead, and XState stays an option for the daemon's connection lifecycle if that gets complicated.

## Consequences

- The daemon must serve the game with COOP and COEP headers, because `SharedArrayBuffer` needs cross-origin isolation.
- The becsy spike's numbers don't carry over, so M0 benchmarks bitECS again.
