export type GpuTimer = {
  readonly begin: () => void
  readonly end: () => void
  readonly poll: (out: number[]) => void
  readonly supported: boolean
}

type QuerySlot = { query: WebGLQuery | undefined }

type TimerExtension = { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number }

const POOL = 8

const unsupported: GpuTimer = {
  begin: () => undefined,
  end: () => undefined,
  poll: () => undefined,
  supported: false,
}

export const createGpuTimer = (gl: WebGL2RenderingContext): GpuTimer => {
  // SAFETY: this is the extension object WebGL2 returns for EXT_disjoint_timer_query_webgl2; we read only its two enum fields.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null

  if (extension === null) {
    return unsupported
  }

  const free: WebGLQuery[] = Array.from({ length: POOL }, () => gl.createQuery())
  const pending: WebGLQuery[] = []
  const current: QuerySlot = { query: undefined }

  return {
    supported: true,
    begin: () => {
      current.query = free.pop()

      if (current.query !== undefined) {
        gl.beginQuery(extension.TIME_ELAPSED_EXT, current.query)
      }
    },
    end: () => {
      if (current.query !== undefined) {
        gl.endQuery(extension.TIME_ELAPSED_EXT)
        pending.push(current.query)
        current.query = undefined
      }
    },
    poll: (out) => {
      while (pending.length > 0) {
        const query = pending[0]!

        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) !== true) {
          return
        }

        const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT) === true
        const nanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT))
        pending.shift()
        free.push(query)

        if (!disjoint) {
          out.push(nanoseconds / 1e6)
        }
      }
    },
  }
}
