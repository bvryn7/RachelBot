/**
 * Digital catalogue: one record per sellable product with dimensions, description
 * and list price. Built by `npm run knowledge:build` from the JobBoss2 part master
 * plus the hand-maintained overrides in data/knowledge/catalogue.overrides.json
 * (dimensions, families, notes the ERP does not hold). The merged result is
 * written to data/knowledge/catalogue.json and loaded through the disk cache.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'

/** JB2 product codes that are things we sell (not cartons, tubing, steel, paint). */
export const SELLABLE_CODES = new Set(['CUTTER', 'RACKS', 'SLIDECUTTER', 'DRYING RACKS', 'TABLES', 'GIFT WRAP', 'MISC SOLD', 'SPECIALTY', 'FOOD', 'CUSTOM'])

export interface CatalogueItem {
  partNumber: string
  productCode: string
  sellable: boolean
  name: string
  family: string
  description: string
  /** Free text like `24" wide x 36" deep, holds 9" core` so Claude can quote dimensions verbatim. */
  dimensions: string
  /** Most recent unit price actually sold at (from JB2 order lines), with its date. */
  price: number | null
  priceDate: string | null
  unit: string
  alternatePartNumbers: string[]
  notes: string
  active: boolean
}

export type Overrides = Record<string, Partial<Omit<CatalogueItem, 'partNumber'>>>

export async function loadCatalogue(): Promise<CatalogueItem[]> {
  const text = await readFile(join(config.DATA_DIR, 'knowledge', 'catalogue.json'), 'utf8').catch(() => '[]')
  return JSON.parse(text) as CatalogueItem[]
}

export async function loadOverrides(): Promise<Overrides> {
  const text = await readFile(join(config.DATA_DIR, 'knowledge', 'catalogue.overrides.json'), 'utf8').catch(() => '{}')
  return JSON.parse(text) as Overrides
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export function findPart(catalogue: CatalogueItem[], partNumber: string): CatalogueItem | undefined {
  const key = norm(partNumber)
  return catalogue.find((c) => norm(c.partNumber) === key || c.alternatePartNumbers.some((a) => norm(a) === key))
}

export function searchCatalogue(catalogue: CatalogueItem[], query: string, limit = 8): CatalogueItem[] {
  const words = (query.toLowerCase().match(/[a-z0-9][a-z0-9"-]{1,}/g) ?? []).filter((w) => w.length > 2)
  const exact = findPart(catalogue, query)
  const scored = catalogue
    .map((c) => {
      const hay = `${c.partNumber} ${c.name} ${c.family} ${c.description} ${c.dimensions} ${c.notes}`.toLowerCase()
      let score = 0
      for (const w of words) if (hay.includes(w)) score += w.length > 5 ? 3 : 1
      if (!c.active) score -= 2
      if (!c.sellable) score -= 1
      return { c, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c)
  return exact ? [exact, ...scored.filter((c) => c.partNumber !== exact.partNumber)] : scored
}

/** Compact one-line-per-item digest for the cached system prompt. */
export function catalogueDigest(catalogue: CatalogueItem[], maxItems = 1500): string {
  return catalogue
    .filter((c) => c.active && c.sellable)
    .slice(0, maxItems)
    .map((c) => [c.partNumber, c.name || c.description, c.dimensions, c.price != null ? `$${c.price.toFixed(2)}/${c.unit}` : ''].filter(Boolean).join(' | '))
    .join('\n')
}
