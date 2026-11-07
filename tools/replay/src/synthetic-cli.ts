import { parseArgs } from 'node:util'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { RECORDING_VERSION } from '@tokenfall/protocol/wire'
import { eventLine, headerLine } from './recording.ts'
import { createSynthetic } from './synthetic.ts'

const TICK_MS = 100

const { values } = parseArgs({
  options: {
    heroes: { type: 'string', default: '200' },
    guilds: { type: 'string', default: '12' },
    seconds: { type: 'string', default: '300' },
    tempo: { type: 'string', default: '1' },
    seed: { type: 'string', default: '1' },
    out: { type: 'string', default: 'recordings/synthetic.jsonl' },
  },
})

const startAt = 0
const synthetic = createSynthetic({
  seed: Number(values.seed),
  heroes: Number(values.heroes),
  guilds: Number(values.guilds),
  workspacesPerGuild: 3,
  tempo: Number(values.tempo),
  startAt,
})
const writer = Bun.file(values.out).writer()
void writer.write(
  headerLine({
    kind: 'recording',
    version: RECORDING_VERSION,
    startedAt: startAt,
    source: 'synthetic',
    note: `heroes=${values.heroes} seed=${values.seed} tempo=${values.tempo}`,
  }),
)

for (const hero of synthetic.heroes) {
  void writer.write(eventLine({ kind: 'hero.joined', at: startAt, hero }))
}

const events: HeroEvent[] = []
const endAt = Number(values.seconds) * 1000
let written = 0

for (let now = TICK_MS; now <= endAt; now += TICK_MS) {
  events.length = 0
  synthetic.step(now, events)

  for (const event of events) {
    void writer.write(eventLine(event))
  }

  written += events.length
}

await writer.end()
console.log(`wrote ${synthetic.heroes.length} heroes and ${written} events to ${values.out}`)
