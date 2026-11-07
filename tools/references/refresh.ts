import { $ } from 'bun'
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeTrusted } from '@tokenfall/protocol/json'

type Reference = {
  readonly name: string
  readonly url: string
  readonly ref: string
  readonly keep: readonly string[]
}

const ROOT = join(import.meta.dir, '..', '..')
const TARGET = join(ROOT, 'references', 'repos')
const DROP = ['node_modules', '__tests__', 'test', 'tests', '*.png', '*.jpg', '*.gif', '*.mp4', '*.webm', '*.webp', '*.jpeg', '*.woff', '*.woff2', '*.ttf']

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

const refresh = async (reference: Reference): Promise<void> => {
  const scratch = await mkdtemp(join(ROOT, 'tmp', `ref-${reference.name}-`))
  await $`git -c advice.detachedHead=false clone --quiet --depth 1 --filter=blob:none --branch ${reference.ref} ${reference.url} ${scratch}`
  const destination = join(TARGET, reference.name)
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })

  for (const path of reference.keep) {
    const source = join(scratch, path)

    if (await exists(source)) {
      await cp(source, join(destination, path), { recursive: true })
    }
  }

  for (const pattern of DROP) {
    await $`find ${destination} -name ${pattern} -prune -exec rm -rf {} +`.quiet()
  }

  await writeFile(join(destination, 'VERSION'), `${reference.url} ${reference.ref}\n`)
  await rm(scratch, { recursive: true, force: true })
  console.log(`${reference.name} ${reference.ref}`)
}

const only = new Set(process.argv.slice(2))
const manifest = decodeTrusted<readonly Reference[]>(
  await Bun.file(join(ROOT, 'references', 'repos.json')).text(),
)
await mkdir(join(ROOT, 'tmp'), { recursive: true })
await Promise.all(
  manifest.filter((reference) => only.size === 0 || only.has(reference.name)).map(refresh),
)
