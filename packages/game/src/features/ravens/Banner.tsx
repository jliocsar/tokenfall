import ravens from '@tokenfall/data/ravens.json'
import { Show } from 'solid-js'
import type { InboxModel } from './model.ts'

type BannerProps = { readonly inbox: InboxModel }

export const Banner = (props: BannerProps) => (
  <Show when={props.inbox.live() && !props.inbox.state().up}>
    <div class="banner panel">{ravens.unavailable}</div>
  </Show>
)
