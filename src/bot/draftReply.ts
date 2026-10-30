/**
 * Draft a reply in Rachel's voice. System prompt (style guide + catalogue digest)
 * is frozen per process and cached with a 1-hour TTL; only the customer email varies.
 */
import Anthropic from '@anthropic-ai/sdk'
import { loadCorpus } from '../corpus/load.js'
import { catalogueDigest, loadCatalogue, type CatalogueItem } from '../knowledge/catalogue.js'
import type { Exchange } from '../corpus/types.js'
import { buildStyleGuide, NOTES_SEPARATOR } from './styleGuide.js'
import { makeTools } from './tools.js'

export const MODEL = 'claude-opus-5-5'

export interface DraftInput {
  from: string
  subject: string
  body: string
  /** Earlier messages in the thread, oldest first, if the caller has them. */
  thread?: { from: string; text: string }[]
  /** Attachment file names on the customer's email, if any. */
  attachments?: string[]
  /** Text extracted from the customer's attachments (PDF item lists, drawings). */
  attachmentText?: string
  /** Image attachments (photos of a unit, screenshots of a price list) for Claude to look at. */
  images?: { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string }[]
  /** ISO date to treat as "today" (defaults to now). The eval replays old mail with its original date. */
  asOf?: string
}

export interface DraftResult {
  draft: string
  /** What the bot wants Rachel to check before sending. */
  notes: string
  toolCalls: { name: string; input: unknown }[]
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  stopReason: string | null
}

let knowledge: Promise<{ corpus: Exchange[]; catalogue: CatalogueItem[]; system: Anthropic.Beta.BetaTextBlockParam[] }> | null = null

/** Build knowledge from an explicit corpus (used by the eval to hold examples out). */
export async function buildKnowledge(corpus: Exchange[], catalogue: CatalogueItem[]) {
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: buildStyleGuide(corpus) },
    { type: 'text', text: `## Digital catalogue (part | name | dimensions | last sold price)\n${catalogueDigest(catalogue)}`, cache_control: { type: 'ephemeral', ttl: '1h' } }
  ]
  return { corpus, catalogue, system }
}

export function loadKnowledge(force = false) {
  if (force || !knowledge) {
    knowledge = (async () => {
      const [corpus, catalogue] = await Promise.all([loadCorpus(), loadCatalogue()])
      return buildKnowledge(corpus, catalogue)
    })()
  }
  return knowledge
}

export async function draftReply(input: DraftInput, client = new Anthropic(), knowledgeOverride?: Awaited<ReturnType<typeof loadKnowledge>>): Promise<DraftResult> {
  const { corpus, catalogue, system } = knowledgeOverride ?? await loadKnowledge()
  const tools = makeTools(catalogue, corpus, input.from)
  const thread = input.thread?.length
    ? `\n\nEarlier in this thread (oldest first):\n${input.thread.map((m) => `--- ${m.from}\n${m.text}`).join('\n')}`
    : ''
  const today = new Date(input.asOf ?? Date.now()).toDateString()
  const attachments = input.attachments?.length
    ? `\nAttachments on this email: ${input.attachments.join(', ')}${input.attachmentText || input.images?.length ? '' : ' (contents not available to you)'}`
    : '\nAttachments: none'
  const attachmentText = input.attachmentText ? `\n\nText of the attachments:\n${input.attachmentText.slice(0, 12000)}` : ''
  const user = `Today is ${today}.\nFrom: ${input.from}\nSubject: ${input.subject}${attachments}\n\n${input.body}${thread}${attachmentText}\n\nDraft Rachel's reply.`
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(input.images ?? []).slice(0, 4).map((img): Anthropic.Beta.BetaImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text: user }
  ]

  const toolCalls: { name: string; input: unknown }[] = []
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    tools,
    messages: [{ role: 'user', content }],
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
  const [body, ...rest] = draft.split(NOTES_SEPARATOR)
  return { draft: body.trim(), notes: rest.join(NOTES_SEPARATOR).trim(), toolCalls, usage, stopReason }
}
