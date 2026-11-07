import world from '@tokenfall/data/world.json'

const { fonts } = world

export const loadFonts = async (): Promise<void> => {
  await Promise.all([
    document.fonts.load(`${fonts.pixelSize}px "${fonts.pixel}"`),
    document.fonts.load(`bold ${fonts.pixelSize}px "${fonts.pixel}"`),
    document.fonts.load(`${world.bubbles.fontSize}px ${fonts.read}`),
    document.fonts.load(`italic ${world.bubbles.fontSize}px ${fonts.read}`),
  ])
}
