import { $ } from 'bun'

const known = new Map<string, Promise<string>>()

const resolve = async (cwd: string): Promise<string> => {
  const common = await $`git -C ${cwd} rev-parse --path-format=absolute --git-common-dir`
    .quiet()
    .nothrow()

  return common.exitCode === 0
    ? common.stdout
        .toString()
        .trim()
        .replace(/\/\.git$/u, '')
    : ''
}

export const repoOf = (cwd: string | null | undefined): Promise<string> => {
  if (cwd === null || cwd === undefined || cwd === '') {
    return Promise.resolve('')
  }

  const cached = known.get(cwd)

  if (cached !== undefined) {
    return cached
  }

  const found = resolve(cwd)
  known.set(cwd, found)

  return found
}
