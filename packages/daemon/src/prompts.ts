import {
  MAX_PROMPT,
  type Prompt,
  type PromptOutcome,
  type PromptResult,
} from '@tokenfall/protocol/terminal'
import { sendPrompt, type HerdrMessage } from './adapters/herdr/client.ts'
import type { World } from './world.ts'

export type PromptSender = (pane: string, text: string) => Promise<HerdrMessage>

export type PromptPeer = { readonly send: (text: string) => number }

export type Prompts = { readonly submit: (socket: PromptPeer, prompt: Prompt) => void }

const OUTCOME_OF_ERROR = new Map<string, PromptOutcome>([
  ['agent_blocked', 'blocked'],
  ['agent_not_found', 'gone'],
  ['agent_not_ready', 'blocked'],
])

const outcomeOf = (reply: HerdrMessage): PromptOutcome =>
  reply.error === undefined ? 'sent' : (OUTCOME_OF_ERROR.get(reply.error.code ?? '') ?? 'error')

const reply = (socket: PromptPeer, id: number, outcome: PromptOutcome): void => {
  const result: PromptResult = { kind: 'prompt.result', id, outcome }
  socket.send(JSON.stringify(result))
}

const refusal = (world: World, prompt: Prompt): PromptOutcome | undefined => {
  const record = world.live.get(prompt.hero)

  if (prompt.text.trim() === '' || prompt.text.length > MAX_PROMPT) {
    return 'refused'
  }

  if (record === undefined || record.pane === '') {
    return 'gone'
  }

  return record.status === 'blocked' ? 'blocked' : undefined
}

const deliver = async (
  sender: PromptSender,
  socket: PromptPeer,
  pane: string,
  prompt: Prompt,
): Promise<void> => {
  const outcome = await sender(pane, prompt.text).then(outcomeOf, (): PromptOutcome => 'error')
  reply(socket, prompt.id, outcome)
}

export const createPrompts = (world: World, sender: PromptSender = sendPrompt): Prompts => ({
  submit: (socket, prompt) => {
    const refused = refusal(world, prompt)

    if (refused !== undefined) {
      reply(socket, prompt.id, refused)

      return
    }

    void deliver(sender, socket, world.live.get(prompt.hero)!.pane, prompt)
  },
})
