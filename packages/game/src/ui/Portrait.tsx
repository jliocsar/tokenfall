import portraits from '@tokenfall/data/portraits.json'
import type { PortraitAtlas } from './bridge.ts'

type PortraitProps = {
  readonly atlas: PortraitAtlas
  readonly sheet: number
  readonly size: 'small' | 'large' | 'sheet'
  readonly status?: string
}

export const Portrait = (props: PortraitProps) => {
  const spec = () => portraits[props.size]

  const style = () => {
    const [cropX, cropY, width, height] = spec().crop
    const { scale } = spec()
    const origin = props.atlas.origins[props.sheet] ?? [0, 0]

    return {
      width: `${width! * scale}px`,
      height: `${height! * scale}px`,
      'background-image': `url(${props.atlas.url})`,
      'background-size': `${props.atlas.width * scale}px ${props.atlas.height * scale}px`,
      'background-position': `-${(origin[0]! + cropX!) * scale}px -${(origin[1]! + cropY!) * scale}px`,
    }
  }

  return <div class={`portrait status-${props.status ?? 'none'}`} style={style()} />
}
