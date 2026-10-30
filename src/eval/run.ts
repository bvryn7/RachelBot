/**
 * Hold-out eval: take N real customer questions from the corpus, hide those exact
 * exchanges from the bot, draft a reply, and have Claude grade the draft against
 * what Rachel actually sent. Writes data/eval/<timestamp>.md and prints the mean.
 *
 *   npm run eval -- [n=8] [topics=quote,dimensions,product_info,availability]
 */
import Anthropic from '@anthropic-ai/sdk'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'
import { loadCorpus } from '../corpus/load.js'
import type { Exchange, Topic } from '../corpus/types.js'
import { loadCatalogue } from '../knowledge/catalogue.js'
import { buildKnowledge, draftReply, MODEL } from '../bot/draftReply.js'

const N = Number(process.argv[2] ?? 8)
const TOPICS = new Set((process.argv[3] ?? 'quote,dimensions,product_info,availability').split(',') as Topic[])

const corpus = await loadCorpus()
const catalogue = await loadCatalogue()
const client = new Anthropic()

// Deterministic pick: oldest-first within eligible, spread over topics, so reruns compare like with like.
const eligible = corpus
  .filter((e) => e.inbound && e.inbound.length > 40 && e.reply.length > 40 && TOPICS.has(e.topic))
  .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
const picked: Exchange[] = []
for (let i = 0; picked.length < N && i < eligible.length; i++) {
  const e = eligible[(i * 7) % eligible.length]
  if (!picked.includes(e)) picked.push(e)
}
const held = new Set(picked.map((e) => e.replyId))
const knowledge = await buildKnowledge(corpus.filter((e) => !held.has(e.replyId)), catalogue)

interface Grade { tone: number; facts: number; helpful: number; verdict: string }
async function grade(e: Exchange, draft: string): Promise<Grade> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    output_config: { effort: 'low' },
    system: 'You grade a drafted customer-service email against the reply a human expert actually sent. Return JSON only.',
    messages: [{ role: 'user', content: `Customer wrote:\n${e.inbound}\n\nRachel actually replied:\n${e.reply}\n\nBot draft:\n${draft}\n\nThe bot could read the live ERP (part master, sold prices, orders) and Rachel's past emails, and the text Azure Document Intelligence read off PDF/photo attachments (when present under 'Text of the attachments'); it could not see images directly. Prices and part numbers it quotes from the ERP are not inventions unless they contradict what Rachel said; a clarifying question where Rachel clearly relied on an attachment is reasonable, not a failure.

Score 1-5 each: tone (does it sound like Rachel: brief, warm, plain), facts (nothing contradicts Rachel, no made-up promises, dimensions or product claims), helpful (gives the answer Rachel gave, or the best possible answer from the information it could see). Then a one-sentence verdict.\nJSON: {"tone":n,"facts":n,"helpful":n,"verdict":"..."}` }]
  })
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  const m = text.match(/\{[\s\S]*\}/)
  return m ? (JSON.parse(m[0]) as Grade) : { tone: 0, facts: 0, helpful: 0, verdict: text.slice(0, 200) }
}

const rows: string[] = []
const totals = { tone: 0, facts: 0, helpful: 0 }
for (const [i, e] of picked.entries()) {
  process.stdout.write(`\r  drafting ${i + 1}/${picked.length}`)
  const result = await draftReply({ from: e.customerEmail, subject: e.subject, body: e.inbound!, attachments: e.inboundAttachments ?? [], attachmentText: e.inboundAttachmentText ?? undefined, asOf: e.inboundAt ?? e.sentAt }, client, knowledge)
  const g = await grade(e, result.draft)
  totals.tone += g.tone; totals.facts += g.facts; totals.helpful += g.helpful
  rows.push(`## ${i + 1}. [${e.topic}] ${e.subject}\n**Customer (${e.customerEmail}, ${e.sentAt.slice(0, 10)}):**\n\n${e.inbound}\n\n**Rachel actually sent:**\n\n${e.reply}\n\n**Bot draft:**\n\n${result.draft}\n\n**Bot notes:** ${result.notes || 'none'}\n\n**Tools:** ${result.toolCalls.map((t) => t.name).join(', ') || 'none'}\n\n**Grade:** tone ${g.tone} · facts ${g.facts} · helpful ${g.helpful} — ${g.verdict}\n`)
}
const n = picked.length || 1
const summary = `# Eval ${new Date().toISOString()}\n\nmodel ${MODEL}, ${picked.length} held-out exchanges, corpus ${corpus.length}, catalogue ${catalogue.length}\n\n| tone | facts | helpful |\n|---|---|---|\n| ${(totals.tone / n).toFixed(2)} | ${(totals.facts / n).toFixed(2)} | ${(totals.helpful / n).toFixed(2)} |\n\n`
const dir = join(config.DATA_DIR, 'eval')
await mkdir(dir, { recursive: true })
const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
await writeFile(file, summary + rows.join('\n---\n\n'))
console.log(`\n${summary}-> ${file}`)
