import text from '@tokenfall/data/menu.json'
import { threadUrl } from '@tokenfall/protocol/inbox'
import { Show } from 'solid-js'
import { NOBODY, type Bridge } from '../../ui/bridge.ts'
import type { InboxModel } from '../ravens/model.ts'
import type { Roster } from '../roster/model.ts'
import type { MenuActions, MenuModel } from './menu.ts'

type HeroMenuProps = {
  readonly bridge: Bridge
  readonly roster: Roster
  readonly inbox: InboxModel
  readonly menu: MenuModel
  readonly actions: MenuActions
}

type ButtonProps = {
  readonly icon: string
  readonly label: string
  readonly active?: boolean
  readonly onClick: () => void
}

const MenuButton = (props: ButtonProps) => (
  <button
    type="button"
    class="menu-button"
    classList={{ active: props.active === true }}
    title={props.label}
    aria-label={props.label}
    data-label={props.label}
    onClick={props.onClick}
  >
    {props.icon}
  </button>
)

export const HeroMenu = (props: HeroMenuProps) => {
  const eid = () => props.bridge.selected()
  const row = () => (eid() === NOBODY ? undefined : props.roster.rows[eid()])

  const inboxHref = (): string | undefined => {
    const { url } = props.inbox.state()
    const thread = row()?.ravenThread ?? ''

    return url === null || thread === '' ? undefined : threadUrl(url, thread)
  }

  const following = () => props.menu.following() === eid()

  return (
    <div
      class="hero-menu"
      style={{ visibility: 'hidden' }}
      ref={(element) => {
        props.menu.element = element
      }}
    >
      <Show when={row()}>
        <MenuButton
          icon={text.sheet.icon}
          label={text.sheet.label}
          onClick={() => {
            props.actions.sheet(eid())
          }}
        />
        <Show when={inboxHref()}>
          {(href) => (
            <a
              class="menu-button"
              href={href()}
              target="_blank"
              rel="noopener"
              title={text.inbox.label}
              aria-label={text.inbox.label}
              data-label={text.inbox.label}
            >
              {text.inbox.icon}
            </a>
          )}
        </Show>
        <MenuButton
          icon={following() ? text.unfollow.icon : text.follow.icon}
          label={following() ? text.unfollow.label : text.follow.label}
          active={following()}
          onClick={() => {
            props.actions.follow(following() ? NOBODY : eid())
          }}
        />
        <Show when={props.menu.delving()}>
          <MenuButton
            icon={text.dungeon.icon}
            label={text.dungeon.label}
            onClick={() => {
              props.actions.dungeon(eid())
            }}
          />
        </Show>
      </Show>
    </div>
  )
}

export const FollowChip = (props: { readonly roster: Roster; readonly menu: MenuModel }) => {
  const name = () => {
    const eid = props.menu.following()

    return eid === NOBODY ? undefined : props.roster.rows[eid]?.fullName
  }

  return (
    <Show when={name()}>
      {(who) => (
        <div class="follow-chip panel plain">{text.following.replace('{name}', who())}</div>
      )}
    </Show>
  )
}
