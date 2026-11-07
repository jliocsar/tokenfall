---
status: superseded by ADR-0003
---

# becsy for the ECS

The game's simulation uses becsy, even though it's 0.x, has one maintainer, and its headline multi-threading isn't implemented yet. What we wanted was: typed array storage, reactive queries for spawning and removing sprites, component enums for Hero states, and coroutines for multi-step scripts like "walk to the entrance, then warp in". A spike gave 0.15 ms per frame for 1000 Heroes in its perf build, so speed isn't the concern. Every system and component is written against its API, so replacing it later would mean rewriting the game layer.

## Considered Options

- **bitECS:** smaller and faster, but has no reactive queries, enums or coroutines, so we'd have to build them ourselves.
- **No ECS:** less machinery, but harder to keep features independent and data-oriented with hundreds of Heroes.

## Consequences

- becsy's quirks are listed in `spec.md` section 8.
- A thrown system error appeared to wedge the world, so the game must be able to rebuild from a daemon snapshot.
