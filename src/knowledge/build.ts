/**
 * Build data/knowledge/catalogue.json = JobBoss2 part master (cached) + overrides.
 * Also mines dimensions out of part descriptions (e.g. `24" x 36"`, `30 in`).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'
import { listParts } from '../jobboss/prodReadClient.js'
import { loadOverrides, SELLABLE_CODES, type CatalogueItem } from './catalogue.js'
import { loadPrices } from './prices.js'

const DIM_RE = /(\d+(?:[.\/]\d+)?\s?(?:"|”|in\b|inch(?:es)?)?\s?[xX×]\s?\d+(?:[.\/]\d+)?\s?(?:"|”|in\b|inch(?:es)?)?(?:\s?[xX×]\s?\d+(?:[.\/]\d+)?\s?(?:"|”|in\b|inch(?:es)?)?)?)|(\d+(?:[.\/]\d+)?\s?(?:"|”|-?\s?inch(?:es)?|\bin\b)\s?(?:wide|long|deep|tall|high|diameter|dia\.?|core))/i

const family = (partNumber: string, description: string): string => {
  const d = description.toLowerCase()
  if (/cutter|blade/.test(d)) return 'Cutters & blades'
  if (/dispenser/.test(d)) return 'Dispensers'
  if (/rack|stand|cabinet/.test(d)) return 'Racks & stands'
  if (/ribbon/.test(d)) return 'Ribbon'
  if (/paper|roll/.test(d)) return 'Paper & rolls'
  const prefix = partNumber.match(/^[A-Z]+/)?.[0]
  return prefix ? `${prefix}-series` : 'Other'
}

const parts = await listParts()
const overrides = await loadOverrides()
const prices = await loadPrices()

const items: CatalogueItem[] = parts.map((p) => {
  const o = overrides[p.partNumber] ?? {}
  const raw = p.raw
  const desc = p.description
  const mined = DIM_RE.exec(`${desc} ${String(raw.notes ?? raw.comments ?? '')}`)?.[0]?.trim() ?? ''
  const code = String(raw.productCode ?? '')
  const sold = prices[p.partNumber]
  return {
    partNumber: p.partNumber,
    productCode: code,
    sellable: SELLABLE_CODES.has(code),
    name: o.name ?? desc.split(/[,(-]/)[0].trim(),
    family: o.family ?? family(p.partNumber, desc),
    description: o.description ?? desc,
    dimensions: o.dimensions ?? mined,
    price: o.price ?? sold?.unitPrice ?? null,
    priceDate: sold?.date ?? null,
    unit: o.unit ?? p.unit,
    alternatePartNumbers: o.alternatePartNumbers ?? (p.alternatePartNumber ? [p.alternatePartNumber] : []),
    notes: o.notes ?? '',
    active: o.active ?? (raw.active !== false && raw.obsolete !== true)
  }
})

// Overrides for parts JB2 does not know (catalogue-only products).
for (const [partNumber, o] of Object.entries(overrides)) {
  if (!items.some((i) => i.partNumber === partNumber)) {
    items.push({
      partNumber, productCode: 'OVERRIDE', sellable: true, name: o.name ?? '', family: o.family ?? 'Other', description: o.description ?? '', dimensions: o.dimensions ?? '',
      price: o.price ?? null, priceDate: null, unit: o.unit ?? 'EA', alternatePartNumbers: o.alternatePartNumbers ?? [], notes: o.notes ?? '', active: o.active ?? true
    })
  }
}

const dir = join(config.DATA_DIR, 'knowledge')
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'catalogue.json'), JSON.stringify(items, null, 1))
console.log(`catalogue: ${items.length} items, ${items.filter((i) => i.sellable).length} sellable, ${items.filter((i) => i.dimensions).length} with dimensions, ${items.filter((i) => i.price != null).length} with price -> ${join(dir, 'catalogue.json')}`)
