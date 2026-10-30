import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// pdf-parse 1.x is CommonJS; its index.js runs a debug self-test when loaded as the main module,
// so load the library file directly.
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (data: Buffer, opts?: { max?: number }) => Promise<{ text: string }>

/** Plain text of the first few pages of a PDF, or '' when it cannot be parsed (scanned image, encrypted). */
export async function pdfText(data: Buffer, maxPages = 4): Promise<string> {
  try {
    const out = await pdfParse(data, { max: maxPages })
    return out.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  } catch {
    return ''
  }
}

export const isPdf = (name: string, contentType: string) =>
  contentType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')

export const isImage = (name: string, contentType: string) =>
  /^image\/(png|jpe?g|gif|webp)$/.test(contentType) || /\.(png|jpe?g|gif|webp)$/i.test(name)
