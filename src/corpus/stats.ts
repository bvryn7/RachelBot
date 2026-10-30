import { loadCorpus } from './load.js'

const corpus = await loadCorpus()
const by = <K extends string>(key: (e: (typeof corpus)[number]) => K) => {
  const m = new Map<K, number>()
  for (const e of corpus) m.set(key(e), (m.get(key(e)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
console.log(`exchanges: ${corpus.length}`)
console.log(`with inbound question: ${corpus.filter((e) => e.inbound).length}`)
console.log('by topic:', Object.fromEntries(by((e) => e.topic)))
console.log('top customers:', by((e) => e.customerDomain).slice(0, 15).map(([d, n]) => `${d}=${n}`).join(' '))
const parts = new Map<string, number>()
for (const e of corpus) for (const p of e.partNumbers) parts.set(p, (parts.get(p) ?? 0) + 1)
console.log('top parts:', [...parts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([p, n]) => `${p}=${n}`).join(' '))
const replyLens = corpus.map((e) => e.reply.length).sort((a, b) => a - b)
console.log(`reply length median=${replyLens[Math.floor(replyLens.length / 2)] ?? 0} p90=${replyLens[Math.floor(replyLens.length * 0.9)] ?? 0}`)
