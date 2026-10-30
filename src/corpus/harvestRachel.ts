/**
 * Harvest Rachel's reply history, READ ONLY, into data/corpus/rachel.jsonl.
 *
 *   npm run corpus:harvest -- [maxReplies=1500] [maxAgeDays=730]
 *
 * Source: Sent Items of RACHEL_MAILBOX (rbowman@). Rachel answers customers from
 * the shared bulman@ mailbox but Outlook files the sent copy in her own Sent Items
 * (bulman@ Sent Items is empty). For each sent message we pull the conversation so
 * the bot learns question -> answer pairs, plus the thread for context.
 * Hard rule inherited from order entry: nothing newer than GRAPH_MIN_AGE_DAYS,
 * and this project has no code path that writes to the mailbox.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'
import { getConversation, listAttachmentNames, listMessages, type GraphMessage } from '../mailbox/graphClient.js'
import { cleanInbound, cleanReply } from '../mailbox/cleanBody.js'
import { classifyTopic, extractPartNumbers, extractPrices } from './classify.js'
import type { Exchange } from './types.js'

const MAX = Number(process.argv[2] ?? 1500)
const MAX_AGE_DAYS = Number(process.argv[3] ?? 730)
const OUT_DIR = join(config.DATA_DIR, 'corpus')
const OUT = join(OUT_DIR, 'rachel.jsonl')
const SEEN = join(OUT_DIR, 'rachel.seen.json')

const INTERNAL = new Set(['bulmanproducts.com'])
const addr = (m?: GraphMessage) => m?.from?.emailAddress?.address?.toLowerCase() ?? ''
const domain = (a: string) => a.split('@')[1] ?? ''

await mkdir(OUT_DIR, { recursive: true })
const seen = new Set<string>(JSON.parse(await readFile(SEEN, 'utf8').catch(() => '[]')) as string[])

const MAILBOX = config.RACHEL_MAILBOX
console.log(`Listing Sent Items of ${MAILBOX} (older than ${config.GRAPH_MIN_AGE_DAYS} d, newer than ${MAX_AGE_DAYS} d, up to ${MAX})`)
const sent = await listMessages({ mailbox: MAILBOX, folder: 'SentItems', newerThanDays: MAX_AGE_DAYS, max: MAX, onPage: (n) => process.stdout.write(`\r  listed ${n}`) })
console.log(`\n${sent.length} sent messages`)

let written = 0, skipped = 0, failed = 0
const convCache = new Map<string, GraphMessage[]>()

for (const msg of sent) {
  if (seen.has(msg.id)) { skipped++; continue }
  const to = msg.toRecipients?.map((r) => r.emailAddress?.address?.toLowerCase() ?? '').filter(Boolean) ?? []
  const customer = to.find((a) => !INTERNAL.has(domain(a)))
  if (!customer) { skipped++; seen.add(msg.id); continue } // internal-only mail
  const reply = cleanReply(msg.body?.content ?? '')
  if (reply.length < 15) { skipped++; seen.add(msg.id); continue } // "Thanks!" only

  try {
    let thread: GraphMessage[] = []
    if (msg.conversationId) {
      thread = convCache.get(msg.conversationId) ?? await getConversation(msg.conversationId, MAILBOX)
      convCache.set(msg.conversationId, thread)
    }
    const sentAt = msg.sentDateTime ?? msg.receivedDateTime ?? ''
    const earlier = thread.filter((m) => m.id !== msg.id && (m.receivedDateTime ?? '') < sentAt)
    const inboundMsg = [...earlier].reverse().find((m) => !INTERNAL.has(domain(addr(m))))
    const attachments = msg.hasAttachments ? (await listAttachmentNames(msg.id, MAILBOX)).map((a) => a.name) : []
    const inbound = inboundMsg ? cleanInbound(inboundMsg.body?.content ?? '') : null
    const all = `${msg.subject ?? ''}\n${inbound ?? ''}\n${reply}`

    const exchange: Exchange = {
      replyId: msg.id,
      conversationId: msg.conversationId ?? '',
      subject: msg.subject ?? '',
      customerEmail: customer,
      customerDomain: domain(customer),
      sentAt,
      inbound,
      inboundAt: inboundMsg?.receivedDateTime ?? null,
      reply,
      thread: earlier.map((m) => ({
        from: addr(m),
        at: m.receivedDateTime ?? '',
        text: (INTERNAL.has(domain(addr(m))) ? cleanReply : cleanInbound)(m.body?.content ?? '').slice(0, 2000)
      })),
      attachments,
      topic: classifyTopic(all),
      partNumbers: extractPartNumbers(all),
      prices: extractPrices(reply)
    }
    await appendFile(OUT, JSON.stringify(exchange) + '\n')
    seen.add(msg.id)
    written++
    if (written % 25 === 0) { process.stdout.write(`\r  written ${written}`); await writeFile(SEEN, JSON.stringify([...seen])) }
  } catch (error) {
    failed++
    console.error('\nfailed', msg.id, error instanceof Error ? error.message : error)
  }
}
await writeFile(SEEN, JSON.stringify([...seen]))
console.log(`\nwritten=${written} skipped=${skipped} failed=${failed} -> ${OUT}`)
