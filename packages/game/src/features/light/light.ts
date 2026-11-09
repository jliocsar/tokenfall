import {
  Container,
  Particle,
  ParticleContainer,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer,
} from 'pixi.js'
import budgets from '@tokenfall/data/budgets.json'
import light from '@tokenfall/data/light.json'
import { screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import type { System } from '../../core/system.ts'
import type { HeroLayer, View } from '../../render/heroes.ts'

export type StaticLight = {
  readonly x: number
  readonly y: number
  readonly kind: 'fire' | 'lantern'
}

export type LightLayer = {
  readonly target: RenderTexture
  readonly overlay: Sprite
  readonly scene: Container
  readonly fixed: ParticleContainer
  readonly heroes: ParticleContainer
  readonly heroParticles: (Particle | undefined)[]
  readonly glow: Texture
  readonly lit: Uint8Array
  grid: Float32Array
  gridX: number
  gridY: number
  gridWidth: number
  gridHeight: number
  fires: Particle[]
  ambient: string
  ambientLuminance: number
}

const TILE_PIXELS = 128
const LIGHT_ANCHOR = 0.5

export const TOWN_AMBIENT = { color: light.ambient, luminance: light.ambientLuminance } as const

const radialTexture = (size: number): Texture => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  return Texture.from(canvas)
}

const glowScale = (radius: number): number => (radius * TILE_PIXELS * 2) / light.textureSize

export const createLightLayer = (sim: Sim, width: number, height: number): LightLayer => {
  const target = RenderTexture.create({
    width: Math.ceil(width * light.resolution),
    height: Math.ceil(height * light.resolution),
  })
  const overlay = new Sprite(target)
  overlay.blendMode = 'multiply'
  overlay.scale.set(1 / light.resolution)
  const glow = radialTexture(light.textureSize)
  const fixed = new ParticleContainer({ texture: glow, dynamicProperties: { vertex: true } })
  const heroes = new ParticleContainer({
    texture: glow,
    dynamicProperties: { position: true },
  })
  fixed.blendMode = 'add'
  heroes.blendMode = 'add'
  const scene = new Container({ label: 'light-scene' })
  scene.addChild(fixed, heroes)

  return {
    target,
    overlay,
    scene,
    fixed,
    heroes,
    heroParticles: Array.from<Particle | undefined>({ length: sim.config.budgets.entities }),
    glow,
    lit: new Uint8Array(sim.config.budgets.entities),
    grid: new Float32Array(0),
    gridX: 0,
    gridY: 0,
    gridWidth: 0,
    gridHeight: 0,
    fires: [],
    ambient: light.ambient,
    ambientLuminance: light.ambientLuminance,
  }
}

const settingsOf = (kind: StaticLight['kind']) => (kind === 'fire' ? light.fire : light.lantern)

const bake = (layer: LightLayer, lights: readonly StaticLight[]): void => {
  const reach = light.fire.radius
  const xs = lights.map((source) => source.x)
  const ys = lights.map((source) => source.y)
  layer.gridX = Math.floor(Math.min(0, ...xs) - reach)
  layer.gridY = Math.floor(Math.min(0, ...ys) - reach)
  layer.gridWidth = Math.ceil(Math.max(0, ...xs) + reach) - layer.gridX
  layer.gridHeight = Math.ceil(Math.max(0, ...ys) + reach) - layer.gridY
  layer.grid = new Float32Array(layer.gridWidth * layer.gridHeight).fill(layer.ambientLuminance)

  for (const source of lights) {
    const { radius, alpha } = settingsOf(source.kind)

    for (let gy = Math.floor(source.y - radius); gy <= source.y + radius; gy++) {
      for (let gx = Math.floor(source.x - radius); gx <= source.x + radius; gx++) {
        const falloff = 1 - Math.hypot(gx - source.x, gy - source.y) / radius
        const cell = (gy - layer.gridY) * layer.gridWidth + (gx - layer.gridX)

        if (falloff > 0 && cell >= 0 && cell < layer.grid.length) {
          layer.grid[cell] = layer.grid[cell]! + alpha * falloff ** light.grid.falloffPower
        }
      }
    }
  }
}

export const setStaticLights = (layer: LightLayer, lights: readonly StaticLight[]): void => {
  layer.fixed.particleChildren.length = 0
  layer.fires = []

  for (const source of lights) {
    const settings = settingsOf(source.kind)
    const particle = new Particle({
      texture: layer.glow,
      x: screenX(source.x, source.y),
      y: screenY(source.x, source.y),
      anchorX: LIGHT_ANCHOR,
      anchorY: LIGHT_ANCHOR,
      scaleX: glowScale(settings.radius),
      scaleY: glowScale(settings.radius) / 2,
      tint: settings.color,
      alpha: settings.alpha,
    })
    layer.fixed.particleChildren.push(particle)

    if (source.kind === 'fire') {
      layer.fires.push(particle)
    }
  }

  layer.fixed.update()
  bake(layer, lights)
}

export const setAmbient = (layer: LightLayer, color: string, luminance: number): void => {
  layer.ambient = color
  layer.ambientLuminance = luminance
  layer.lit.fill(0)
}

const brightness = (layer: LightLayer, x: number, y: number): number => {
  const gx = Math.floor(x) - layer.gridX
  const gy = Math.floor(y) - layer.gridY

  if (gx < 0 || gy < 0 || gx >= layer.gridWidth || gy >= layer.gridHeight) {
    return layer.ambientLuminance
  }

  return layer.grid[gy * layer.gridWidth + gx]!
}

const heroParticle = (layer: LightLayer, eid: number): Particle => {
  const known = layer.heroParticles[eid]

  if (known !== undefined) {
    return known
  }

  const particle = new Particle({
    texture: layer.glow,
    anchorX: LIGHT_ANCHOR,
    anchorY: LIGHT_ANCHOR,
    scaleX: glowScale(light.hero.radius),
    scaleY: glowScale(light.hero.radius) / 2,
    tint: light.hero.color,
    alpha: light.hero.alpha,
  })
  layer.heroParticles[eid] = particle

  return particle
}

const outside = (view: View, sx: number, sy: number, margin: number): boolean =>
  sx < view.left - margin ||
  sx > view.right + margin ||
  sy < view.top - margin ||
  sy > view.bottom + margin

export const lightSystem = (layer: LightLayer, heroes: HeroLayer): System => ({
  name: 'hero-light',
  complexity: 'O(heroes) for the switch with hysteresis, lights capped by budgets.heroLights',
  run: (sim) => {
    const { x, y } = sim.stores.position

    for (let i = 0; i < heroes.count; i++) {
      const eid = heroes.order[i]!
      const level = brightness(layer, x[eid]!, y[eid]!)

      if (layer.lit[eid] === 1 && level > light.hero.off) {
        layer.lit[eid] = 0
      } else if (layer.lit[eid] === 0 && level < light.hero.on) {
        layer.lit[eid] = 1
      }
    }
  },
})

export const renderLight = (
  layer: LightLayer,
  sim: Sim,
  heroes: HeroLayer,
  renderer: Renderer,
  world: Container,
  view: View,
  now: number,
): number => {
  const { x, y } = sim.stores.position
  const children = layer.heroes.particleChildren
  const margin = light.hero.radius * TILE_PIXELS
  let count = 0

  for (let i = 0; i < heroes.count && count < budgets.heroLights; i++) {
    const eid = heroes.order[i]!

    if (layer.lit[eid] === 0 || heroes.hidden[sim.stores.behavior.state[eid]!] === 1) {
      continue
    }

    const sx = screenX(x[eid]!, y[eid]!)
    const sy = screenY(x[eid]!, y[eid]!)

    if (outside(view, sx, sy, margin)) {
      continue
    }

    const particle = heroParticle(layer, eid)
    particle.x = sx
    particle.y = sy - 30
    children[count] = particle
    count += 1
  }

  children.length = count
  const flicker =
    1 + Math.sin((now / 1000) * Math.PI * 2 * light.fire.flickerHz) * light.fire.flicker

  for (const fire of layer.fires) {
    fire.scaleX = glowScale(light.fire.radius) * flicker
    fire.scaleY = (glowScale(light.fire.radius) / 2) * flicker
  }

  layer.scene.position.set(world.position.x * light.resolution, world.position.y * light.resolution)
  layer.scene.scale.set(world.scale.x * light.resolution)
  renderer.render({
    container: layer.scene,
    target: layer.target,
    clear: true,
    clearColor: layer.ambient,
  })

  return count
}

export const resizeLight = (layer: LightLayer, width: number, height: number): void => {
  layer.target.resize(Math.ceil(width * light.resolution), Math.ceil(height * light.resolution))
}
