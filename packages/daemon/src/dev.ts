const root = `${import.meta.dirname}/../../..`
const children = [
  Bun.spawn(['bun', '--watch', 'packages/daemon/src/main.ts', '--dev'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  }),
  Bun.spawn(['bun', 'run', '--cwd', 'packages/game', 'dev'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  }),
]

const stop = (): void => {
  for (const child of children) {
    child.kill()
  }
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await Promise.race(children.map((child) => child.exited))
stop()
