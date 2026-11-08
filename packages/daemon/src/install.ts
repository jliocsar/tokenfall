import { $ } from 'bun'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const HOME = process.env['HOME'] ?? homedir()
const SHARE = join(process.env['XDG_DATA_HOME'] ?? join(HOME, '.local', 'share'), 'tokenfall')
const UNIT_DIR = join(process.env['XDG_CONFIG_HOME'] ?? join(HOME, '.config'), 'systemd', 'user')
const UNIT = 'tokenfall.service'

const unitFile = (bun: string): string => `[Unit]
Description=Tokenfall daemon: your Claude Agents as Heroes, read-only
After=default.target

[Service]
ExecStart=${bun} ${join(SHARE, 'daemon.js')}
Environment=TOKENFALL_DIST=${join(SHARE, 'game')}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`

const install = async (): Promise<void> => {
  await $`bun run --cwd ${join(ROOT, 'packages', 'game')} build`
  await mkdir(SHARE, { recursive: true })
  await $`bun build ${join(ROOT, 'packages', 'daemon', 'src', 'main.ts')} --target bun --outfile ${join(SHARE, 'daemon.js')}`
  await rm(join(SHARE, 'game'), { recursive: true, force: true })
  await $`cp -r ${join(ROOT, 'packages', 'game', 'dist')} ${join(SHARE, 'game')}`
  await mkdir(UNIT_DIR, { recursive: true })
  await writeFile(join(UNIT_DIR, UNIT), unitFile(process.execPath))
  await $`systemctl --user daemon-reload`
  await $`systemctl --user enable ${UNIT}`
  await $`systemctl --user restart ${UNIT}`
  console.log(`installed to ${SHARE}, running as ${UNIT} on http://127.0.0.1:47300`)
}

const uninstall = async (): Promise<void> => {
  await $`systemctl --user disable --now ${UNIT}`.nothrow()
  await rm(join(UNIT_DIR, UNIT), { force: true })
  await $`systemctl --user daemon-reload`
  await rm(SHARE, { recursive: true, force: true })
  console.log(
    'removed the service and its installed copy; your save in ~/.local/state/tokenfall is kept',
  )
}

await (Bun.argv[2] === 'uninstall' ? uninstall() : install())
