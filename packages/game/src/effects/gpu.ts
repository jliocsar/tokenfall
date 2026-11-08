import {
  BufferImageSource,
  Container,
  Geometry,
  Mesh,
  Shader,
  UniformGroup,
  type UniformData,
} from 'pixi.js'
import type { Sim } from '../core/sim.ts'
import { effectClock, EMITTER_STRIDE, type EffectDefinition } from './emitters.ts'
import { AURA_VERTEX } from './shaders/aura.ts'
import { RING_BURST_FRAGMENT, RING_BURST_VERTEX } from './shaders/ring-burst.ts'

type ShaderSource = { readonly vertex: string; readonly fragment: string }

export type EffectLayer = {
  readonly container: Container
  readonly meshes: Mesh<Geometry, Shader>[]
  readonly sources: BufferImageSource[]
  readonly clocks: UniformGroup[]
}

const SHADERS = new Map<string, ShaderSource>([
  ['ring-burst', { vertex: RING_BURST_VERTEX, fragment: RING_BURST_FRAGMENT }],
  ['aura', { vertex: AURA_VERTEX, fragment: RING_BURST_FRAGMENT }],
])

const QUAD = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5])
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3])

const uniformName = (param: string): string => `u${param[0]!.toUpperCase()}${param.slice(1)}`

const paramUniform = (value: number | readonly number[]): UniformData =>
  Array.isArray(value)
    ? { value: new Float32Array(value), type: 'vec4<f32>' }
    : { value, type: 'f32' }

const paramUniforms = (definition: EffectDefinition) =>
  Object.fromEntries(
    Object.entries(definition.params).map(([param, value]) => [
      uniformName(param),
      paramUniform(value),
    ]),
  )

const createEffectMesh = (
  definition: EffectDefinition,
  source: BufferImageSource,
  clock: UniformGroup,
): Mesh<Geometry, Shader> => {
  const shaderSource = SHADERS.get(definition.shader)

  if (shaderSource === undefined) {
    throw new Error(`effect "${definition.name}" names an unknown shader "${definition.shader}"`)
  }

  const geometry = new Geometry({
    attributes: { aPosition: { buffer: QUAD, format: 'float32x2' } },
    indexBuffer: QUAD_INDICES,
    instanceCount: 1,
  })
  const shader = Shader.from({
    gl: shaderSource,
    resources: {
      uEmitters: source,
      clock,
      params: new UniformGroup(paramUniforms(definition)),
    },
  })
  const mesh = new Mesh({ geometry, shader })
  mesh.blendMode = definition.blend === 'add' ? 'add' : 'normal'
  mesh.visible = false

  return mesh
}

export const createEffectLayer = (
  sim: Sim,
  definitions: readonly EffectDefinition[],
): EffectLayer => {
  const container = new Container({ label: 'effects' })
  const meshes: Mesh<Geometry, Shader>[] = []
  const sources: BufferImageSource[] = []
  const clocks: UniformGroup[] = []

  for (const [index, definition] of definitions.entries()) {
    const kind = sim.effects[index]!
    const source = new BufferImageSource({
      resource: kind.data,
      width: kind.data.length / 4,
      height: 1,
      format: 'rgba32float',
      scaleMode: 'nearest',
      autoGenerateMipmaps: false,
      alphaMode: 'no-premultiply-alpha',
    })
    const clock = new UniformGroup({
      uTime: { value: 0, type: 'f32' },
      uParticles: { value: definition.particles, type: 'f32' },
      uLifetime: { value: definition.lifetime, type: 'f32' },
    })
    const mesh = createEffectMesh(definition, source, clock)
    container.addChild(mesh)
    meshes.push(mesh)
    sources.push(source)
    clocks.push(clock)
  }

  return { container, meshes, sources, clocks }
}

export const EFFECT_STRIDE_TEXELS = EMITTER_STRIDE / 4

export const syncEffects = (layer: EffectLayer, sim: Sim, now: number): number => {
  let particles = 0

  for (let i = 0; i < layer.meshes.length; i++) {
    const kind = sim.effects[i]!
    const mesh = layer.meshes[i]!
    mesh.visible = kind.highWater > 0
    mesh.geometry.instanceCount = Math.max(1, kind.highWater * kind.particles)
    layer.clocks[i]!.uniforms['uTime'] = effectClock(sim, now)

    if (kind.dirty) {
      layer.sources[i]!.update()
      kind.dirty = false
    }

    particles += mesh.visible ? kind.highWater * kind.particles : 0
  }

  return particles
}
