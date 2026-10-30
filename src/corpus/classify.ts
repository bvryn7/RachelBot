import type { Topic } from './types.js'

const RULES: [Topic, RegExp][] = [
  ['order_ack', /\border received\b/i],
  ['order_status', /\b(tracking|shipped|ship date|when will|eta|status of|where is (my|our) order|backorder|back order|delivery)\b/i],
  ['invoice', /\b(invoice|remit|payment|past due|statement|credit card|w-?9|tax exempt|resale cert)/i],
  ['quote', /\b(quote|quotation|pricing|price list|how much|cost|price for|price on|each|per unit|discount|net \d+)\b/i],
  ['dimensions', /\b(dimensions?|width|wide|length|how long|height|tall|depth|deep|diameter|inch(?:es)?|\d+\s?(?:"|”|in\.)|roll size|core size|hole (?:pattern|spacing)|footprint|weigh[st]?|capacity)\b/i],
  ['availability', /\b(in stock|stock|lead time|available|availability|distributor|where can i buy|carry)\b/i],
  ['product_info', /\b(replacement|replace|blade|part number|model|which (one|unit|model)|difference between|compatible|work with|spec|specification|catalog|catalogue|brochure|manual|instructions)\b/i]
]

export function classifyTopic(text: string): Topic {
  for (const [topic, re] of RULES) if (re.test(text)) return topic
  return 'other'
}

/** Bulman-style part numbers: A500-24, M761R, T344R-27, R997-27, 2332424, SC-1H etc. */
const PART_RE = /\b(?:[A-Z]{1,3}-?\d{2,4}[A-Z]?(?:-\d{1,3}[A-Z]?)?|\d{7})\b/g

export function extractPartNumbers(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.toUpperCase().matchAll(PART_RE)) {
    const s = m[0]
    if (/^(PO|RE|FW|AM|PM|EST|EDT|CST|USA)\d*$/.test(s)) continue
    if (/^\d{7}$/.test(s) && !/^2\d{6}$/.test(s)) continue // McMaster numbers start with 2
    found.add(s)
  }
  return [...found]
}

export function extractPrices(text: string): string[] {
  return [...new Set([...text.matchAll(/\$\s?\d[\d,]*(?:\.\d{2})?/g)].map((m) => m[0].replace(/\s/g, '')))]
}
