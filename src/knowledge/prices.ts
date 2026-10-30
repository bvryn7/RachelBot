/**
 * Last-sold unit price per sellable part, pulled from JB2 order lines and
 * disk-cached for 7 days (one GET per part, so a refresh takes a few minutes).
 *   npm run knowledge:prices          refresh if older than 7 days
 *   npm run knowledge:prices force    refresh now
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'
import { cached, DAY_MS } from '../cache/diskCache.js'
import { listParts, priceHistory, type SoldPrice } from '../jobboss/prodReadClient.js'
import { SELLABLE_CODES } from './catalogue.js'

export type PriceBook = Record<string, SoldPrice>

export async function loadPrices(): Promise<PriceBook> {
  const text = await readFile(join(config.DATA_DIR, 'reference', 'jb2-prod-prices.json'), 'utf8').catch(() => null)
  return text ? (JSON.parse(text) as { items: PriceBook }).items : {}
}

/** The price a part usually sells at: the most frequent unit price in recent history, newest on ties. */
export function listPrice(history: SoldPrice[]): SoldPrice | null {
  if (!history.length) return null
  const counts = new Map<number, number>()
  for (const h of history) counts.set(h.unitPrice, (counts.get(h.unitPrice) ?? 0) + 1)
  const best = Math.max(...counts.values())
  return history.find((h) => counts.get(h.unitPrice) === best) ?? null
}

export async function refreshPrices(force = false, concurrency = 4): Promise<PriceBook> {
  return cached<PriceBook>('reference', 'jb2-prod-prices', async () => {
    const parts = (await listParts()).filter((p) => SELLABLE_CODES.has(String(p.raw.productCode ?? '')) && p.raw.active !== false)
    const book: PriceBook = {}
    let done = 0
    const queue = [...parts]
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        try {
          const history = await priceHistory(p.partNumber, 12)
          const list = listPrice(history)
          if (list) book[p.partNumber] = list
        } catch (error) {
          console.error('\nprice lookup failed', p.partNumber, error instanceof Error ? error.message : error)
        }
        if (++done % 50 === 0) process.stdout.write(`\r  priced ${done}/${parts.length}`)
      }
    }))
    console.log(`\n${Object.keys(book).length} of ${parts.length} sellable parts have a sold price`)
    return book
  }, { ttlMs: 7 * DAY_MS, force })
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('prices.ts') || entry.endsWith('prices.js')) {
  await refreshPrices(process.argv[2] === 'force')
}
