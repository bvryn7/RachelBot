/**
 * Harvest Rachel's reply history, READ ONLY, into data/corpus/rachel.jsonl.
 *
 *   npm run corpus:harvest -- [maxReplies=20000] [maxAgeDays=3650] [concurrency=4]
 *
 * Source: Sent Items of RACHEL_MAILBOX (rbowman@). Rachel answers customers from
 * the shared bulman@ mailbox but Outlook files the sent copy in her own Sent Items
 * (bulman@ Sent Items is empty). For each sent message we pull the conversation so
 * the bot learns question -> answer pairs, the thread for context, and the text of
 * any PDF the customer attached (item lists, drawings, POs).
 *
 * Incremental: message ids already in rachel.seen.json are skipped, so reruns only
 * add new mail. Hard rule inherited from order entry: nothing newer than
 * GRAPH_MIN_AGE_DAYS, and this project has no code path that writes to the mailbox.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'
import { getAttachments, getConversation, listMessages, type GraphMessage } from '../mailbox/graphClient.js'
import { cleanInbound, cleanReply } from '../mailbox/cleanBody.js'
import { isPdf, pdfText } from '../util/pdfText.js'
import { classifyTopic, extractPartNumbers, extractPrices } from './classify.js'
import type { Exchange } from './types.js'

const MAX = Number(process.argv[2] ?? 20000)
const MAX_AGE_DAYS = Number(process.argv[3] ?? 3650)
const CONCURRENCY = Number(process.argv[4] ?? 4)
const OUT_DIR = join(config.DATA_DIR, 'corpus')
const OUT = join(OUT_DIR, 'rachel.jsonl')
const SEEN = join(OUT_DIR, 'rachel.seen.json')
const MAILBOX = config.RACHEL_MAILBOX

// Bulman plus affiliated companies and vendors Rachel deals with as a colleague, not a customer.
const INTERNAL = new Set(['bulmanproducts.com', 'viscommproducts.com'])
const SKIP_SUBJECT = /\b(payroll|insurance|benefit|401k|employee navigator|w-?2|time ?off|pto)\b/i
const addr = (m?: GraphMessage) => m?.from?.emailAddress?.address?.toLowerCase() ?? ''
const domain = (a: string) => a.split('@')[1] ?? ''

await mkdir(OUT_DIR, { recursive: true })
const seen = new Set<string>(JSON.parse(await readFile(SEEN, 'utf8').catch(() => '[]')) as string[])
const saveSeen = () => writeFile(SEEN, JSON.stringify([...seen]))

console.log(`Listing Sent Items of ${MAILBOX} (older than ${config.GRAPH_MIN_AGE_DAYS} d, newer than ${MAX_AGE_DAYS} d, up to ${MAX}, ${seen.size} already harvested)`)
const sent = await listMessages({ mailbox: MAILBOX, folder: 'SentItems', newerThanDays: MAX_AGE_DAYS, max: MAX, onPage: (n) => process.stdout.write(`\r  listed ${n}`) })
console.log(`\n${sent.length} sent messages`)

let written = 0, skipped = 0, failed = 0, done = 0
const convCache = new Map<string, Promise<GraphMessage[]>>()
const conversation = (id: string) => {
  let p = convCache.get(id)
  if (!p) { p = getConversation(id, MAILBOX); convCache.set(id, p) }
  return p
}

async function attachmentInfo(m: GraphMessage): Promise<{ names: string[]; text: string }> {
  if (!m.hasAttachments) return { names: [], text: '' }
  const atts = await getAttachments(m.id, MAILBOX)
  const texts: string[] = []
  for (const a of atts) {
    if (a.contentBytes && isPdf(a.name, a.contentType)) {
      const t = await pdfText(Buffer.from(a.contentBytes, 'base64'))
      if (t) texts.push(`--- ${a.name}\n${t.slice(0, 4000)}`)
    }
  }
  return { names: atts.map((a) => a.name), text: texts.join('\n\n') }
}

async function handle(msg: GraphMessage): Promise<void> {
  if (seen.has(msg.id)) { skipped++; return }
  const to = msg.toRecipients?.map((r) => r.emailAddress?.address?.toLowerCase() ?? '').filter(Boolean) ?? []
  const customer = to.find((a) => !INTERNAL.has(domain(a)))
  if (!customer || SKIP_SUBJECT.test(msg.subject ?? '')) { skipped++; seen.add(msg.id); return }
  const reply = cleanReply(msg.body?.content ?? '')
  if (reply.length < 15) { skipped++; seen.add(msg.id); return }

  try {
    const thread = msg.conversationId ? await conversation(msg.conversationId) : []
    const sentAt = msg.sentDateTime ?? msg.receivedDateTime ?? ''
    const earlier = thread.filter((m) => m.id !== msg.id && (m.receivedDateTime ?? '') < sentAt)
    const inboundMsg = [...earlier].reverse().find((m) => !INTERNAL.has(domain(addr(m))))
    const [mine, theirs] = await Promise.all([attachmentInfo(msg), inboundMsg ? attachmentInfo(inboundMsg) : { names: [], text: '' }])
    const inbound = inboundMsg ? cleanInbound(inboundMsg.body?.content ?? '') : null
    const all = `${msg.subject ?? ''}\n${inbound ?? ''}\n${theirs.text}\n${reply}`

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
      attachments: mine.names,
      inboundAttachments: theirs.names,
      inboundAttachmentText: theirs.text || null,
      topic: classifyTopic(all),
      partNumbers: extractPartNumbers(all),
      prices: extractPrices(reply)
    }
    await appendFile(OUT, JSON.stringify(exchange) + '\n')
    seen.add(msg.id)
    written++
  } catch (error) {
    failed++
    console.error('\nfailed', msg.id, error instanceof Error ? error.message : error)
  }
}

const queue = [...sent]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let m = queue.shift(); m; m = queue.shift()) {
    await handle(m)
    if (++done % 25 === 0) { process.stdout.write(`\r  ${done}/${sent.length} written=${written} skipped=${skipped} failed=${failed}`); await saveSeen() }
  }
}))
await saveSeen()
console.log(`\nwritten=${written} skipped=${skipped} failed=${failed} -> ${OUT}`)
