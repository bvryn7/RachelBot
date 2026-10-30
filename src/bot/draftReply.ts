/**
 * Draft a reply in Rachel's voice. System prompt (style guide + catalogue digest)
 * is frozen per process and cached with a 1-hour TTL; only the customer email varies.
 */
import Anthropic from '@anthropic-ai/sdk'
import { loadCorpus } from '../corpus/load.js'
import { catalogueDigest, loadCatalogue, type CatalogueItem } from '../knowledge/catalogue.js'
import type { Exchange } from '../corpus/types.js'
import { buildStyleGuide } from './styleGuide.js'
import { makeTools } from './tools.js'

export const MODEL = 'claude-opus-5-5'

export interface DraftInput {
  from: string
  subject: string
  body: string
  /** Earlier messages in the thread, oldest first, if the caller has them. */
  thread?: { from: string; text: string }[]
}

export interface DraftResult {
  draft: string
  toolCalls: { name: string; input: unknown }[]
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  stopReason: string | null
}

let knowledge: Promise<{ corpus: Exchange[]; catalogue: CatalogueItem[]; system: Anthropic.Beta.BetaTextBlockParam[] }> | null = null

export function loadKnowledge(force = false) {
  if (force || !knowledge) {
    knowledge = (async () => {
      const [corpus, catalogue] = await Promise.all([loadCorpus(), loadCatalogue()])
      const system: Anthropic.Beta.BetaTextBlockParam[] = [
        { type: 'text', text: buildStyleGuide(corpus) },
        { type: 'text', text: `## Digital catalogue (part | name | dimensions | list price)\n${catalogueDigest(catalogue)}`, cache_control: { type: 'ephemeral', ttl: '1h' } }
      ]
      return { corpus, catalogue, system }
    })()
  }
  return knowledge
}

export async function draftReply(input: DraftInput, client = new Anthropic()): Promise<DraftResult> {
  const { corpus, catalogue, system } = await loadKnowledge()
  const tools = makeTools(catalogue, corpus, input.from)
  const thread = input.thread?.length
    ? `\n\nEarlier in this thread (oldest first):\n${input.thread.map((m) => `--- ${m.from}\n${m.text}`).join('\n')}`
    : ''
  const user = `From: ${input.from}\nSubject: ${input.subject}\n\n${input.body}${thread}\n\nDraft Rachel's reply.`

  const toolCalls: { name: string; input: unknown }[] = []
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    tools,
    messages: [{ role: 'user', content: user }],
    stream: false
  })

  let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let stopReason: string | null = null
  let draft = ''
  for await (const message of runner) {
    usage = {
      input: usage.input + message.usage.input_tokens,
      output: usage.output + message.usage.output_tokens,
      cacheRead: usage.cacheRead + (message.usage.cache_read_input_tokens ?? 0),
      cacheWrite: usage.cacheWrite + (message.usage.cache_creation_input_tokens ?? 0)
    }
    stopReason = message.stop_reason
    for (const block of message.content) {
      if (block.type === 'tool_use') toolCalls.push({ name: block.name, input: block.input })
    }
    if (message.stop_reason !== 'tool_use') {
      draft = message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()
    }
  }
  if (stopReason === 'refusal') draft = ''
  return { draft, toolCalls, usage, stopReason }
}
