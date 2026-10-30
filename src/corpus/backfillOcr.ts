/**
 * Backfill attachment text for exchanges harvested before Azure Document Intelligence was
 * wired in: photos, screenshots and scanned PDFs the customer sent that pdf-parse could not read.
 *
 *   npm run corpus:ocr -- [maxExchanges=400] [concurrency=2]
 *
 * READ ONLY against Graph (re-fetches the inbound message's attachments by conversation),
 * results cached per file under data/docintel so reruns are free. Rewrites rachel.jsonl in place
 * with inboundAttachmentText filled in and records which exchanges were tried in rachel.ocr.json.
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config, isDocIntelConfigured } from '../config.js'
import { getAttachments, getConversation } from '../mailbox/graphClient.js'
import { isImage, isPdf } from '../util/pdfText.js'
import { attachmentToText, guessMime } from '../vision/docIntel.js'
import type { Exchange } from './types.js'

const MAX = Number(process.argv[2] ?? 400)
const CONCURRENCY = Number(process.argv[3] ?? 2)
const DIR = join(config.DATA_DIR, 'corpus')
const FILE = join(DIR, 'rachel.jsonl')
const TRIED = join(DIR, 'rachel.ocr.json')
const INTERNAL = new Set(['bulmanproducts.com', 'viscommproducts.com'])

if (!isDocIntelConfigured()) { console.error('AZURE_DOCINTEL_ENDPOINT / AZURE_DOCINTEL_KEY not set'); process.exit(1) }

const lines = (await readFile(FILE, 'utf8')).split('\n').filter(Boolean)
const corpus = lines.map((l) => JSON.parse(l) as Exchange)
const tried = new Set<string>(JSON.parse(await readFile(TRIED, 'utf8').catch(() => '[]')) as string[])
const readable = (n: string) => isPdf(n, guessMime(n)) || isImage(n, guessMime(n)) || /^image\//.test(guessMime(n))

const todo = corpus
  .filter((e) => e.inbound && e.conversationId && !tried.has(e.replyId))
  .filter((e) => (e.inboundAttachments ?? []).some(readable))
  .filter((e) => !e.inboundAttachmentText || (e.inboundAttachments ?? []).some((n) => !isPdf(n, guessMime(n))))
  .slice(0, MAX)
console.log(`${todo.length} exchanges with unread PDF/image attachments (of ${corpus.length}); ${tried.size} already tried`)

let filled = 0, done = 0, failed = 0
const queue = [...todo]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let e = queue.shift(); e; e = queue.shift()) {
    try {
      const thread = await getConversation(e.conversationId, config.RACHEL_MAILBOX)
      const inbound = thread.find((m) => m.receivedDateTime === e.inboundAt && !INTERNAL.has((m.from?.emailAddress?.address ?? '').split('@')[1] ?? ''))
        ?? [...thread].reverse().find((m) => (m.receivedDateTime ?? '') < e.sentAt && m.hasAttachments && !INTERNAL.has((m.from?.emailAddress?.address ?? '').split('@')[1] ?? ''))
      if (!inbound) { tried.add(e.replyId); continue }
      const atts = await getAttachments(inbound.id, config.RACHEL_MAILBOX)
      const texts: string[] = []
      for (const a of atts) {
        if (!a.contentBytes) continue
        const t = await attachmentToText(a.name, a.contentType, Buffer.from(a.contentBytes, 'base64'), e.subject)
        if (t) texts.push(`--- ${a.name}\n${t.slice(0, 4000)}`)
      }
      if (texts.length) { e.inboundAttachmentText = texts.join('\n\n'); filled++ }
      tried.add(e.replyId)
    } catch (error) {
      failed++
      console.error('\nfailed', e.replyId.slice(0, 12), error instanceof Error ? error.message : error)
    }
    if (++done % 10 === 0) process.stdout.write(`\r  ${done}/${todo.length} filled=${filled} failed=${failed}`)
  }
}))

const tmp = `${FILE}.tmp`
await writeFile(tmp, corpus.map((e) => JSON.stringify(e)).join('\n') + '\n')
await rename(tmp, FILE)
await writeFile(TRIED, JSON.stringify([...tried]))
console.log(`\nfilled=${filled} failed=${failed} -> ${FILE}`)
