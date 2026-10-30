import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'
import type { Exchange, Topic } from './types.js'

export async function loadCorpus(): Promise<Exchange[]> {
  const file = join(config.DATA_DIR, 'corpus', 'rachel.jsonl')
  const text = await readFile(file, 'utf8').catch(() => '')
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Exchange)
}

/** Pick few-shot examples: most recent, with an inbound question, spread across topics. */
export function pickExamples(corpus: Exchange[], perTopic: Record<Topic, number>): Exchange[] {
  const byTopic = new Map<Topic, Exchange[]>()
  for (const e of [...corpus].sort((a, b) => b.sentAt.localeCompare(a.sentAt))) {
    if (!e.inbound || e.inbound.length < 20 || e.reply.length < 30 || e.reply.length > 1500) continue
    const list = byTopic.get(e.topic) ?? []
    if (list.length < (perTopic[e.topic] ?? 0)) { list.push(e); byTopic.set(e.topic, list) }
  }
  return [...byTopic.values()].flat()
}

/** Exchanges with the same customer domain, newest first, for "what did we tell them before". */
export function historyFor(corpus: Exchange[], customerEmail: string, limit = 5): Exchange[] {
  const dom = customerEmail.split('@')[1]?.toLowerCase()
  return corpus
    .filter((e) => e.customerDomain === dom)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .slice(0, limit)
}

/** Crude keyword search over the corpus for similar past questions. */
export function similarExchanges(corpus: Exchange[], query: string, limit = 5): Exchange[] {
  const words = new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])
  if (!words.size) return []
  return corpus
    .map((e) => {
      const hay = `${e.subject} ${e.inbound ?? ''} ${e.reply}`.toLowerCase()
      let score = 0
      for (const w of words) if (hay.includes(w)) score += w.length > 5 ? 2 : 1
      for (const p of e.partNumbers) if (query.toUpperCase().includes(p)) score += 10
      return { e, score }
    })
    .filter((x) => x.score > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e)
}
