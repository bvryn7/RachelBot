/**
 * Azure AI Document Intelligence, ported from the order-entry project's PO extraction.
 *
 * Two models:
 *   prebuilt-read     plain text of anything: photos of a unit, screenshots, scanned PDFs.
 *   prebuilt-invoice  structured fields when the attachment is a customer PO (PO number,
 *                     ship-to, required date, line items with qty / unit price).
 *
 * Results are cached on disk by content hash (data/docintel/<model>-<sha>.json) so the corpus
 * backfill and eval never pay for the same attachment twice. The F0 tier rate-limits hard;
 * a 429 means "wait N seconds", not "failed", so Retry-After is honoured.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config, isDocIntelConfigured } from '../config.js'
import { isImage, isPdf, pdfText } from '../util/pdfText.js'
import { mapInvoiceToPo, type AzureAnalyzeResult, type ExtractedPo } from './mapInvoiceToPo.js'

const API_VERSION = '2024-11-30'
const POLL_DELAY_MS = 2000
const MAX_POLLS = 60
const RATE_LIMIT_RETRIES = 8
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type DocModel = 'prebuilt-read' | 'prebuilt-invoice'

function retryAfterMs(response: Response): number {
  const header = Number(response.headers.get('retry-after'))
  const seconds = Number.isFinite(header) && header > 0 ? header : 12
  return Math.min(seconds, 60) * 1000 + 1500
}

const cacheDir = () => join(config.DATA_DIR, 'docintel')
const cacheKey = (model: DocModel, data: Buffer) => `${model}-${createHash('sha256').update(data).digest('hex').slice(0, 32)}`

/** Raw analyze result from Azure for one document (cached by content hash). */
export async function analyzeDocument(data: Buffer, contentType: string, model: DocModel): Promise<AzureAnalyzeResult> {
  if (!isDocIntelConfigured()) throw new Error('Azure Document Intelligence is not configured (AZURE_DOCINTEL_ENDPOINT / AZURE_DOCINTEL_KEY)')
  await mkdir(cacheDir(), { recursive: true })
  const file = join(cacheDir(), `${cacheKey(model, data)}.json`)
  const hit = await readFile(file, 'utf8').catch(() => null)
  if (hit) return JSON.parse(hit) as AzureAnalyzeResult

  const url = `${config.AZURE_DOCINTEL_ENDPOINT}/documentintelligence/documentModels/${model}:analyze?api-version=${API_VERSION}`
  const key = config.AZURE_DOCINTEL_KEY!
  let submit: Response
  for (let attempt = 0; ; attempt++) {
    submit = await fetch(url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': contentType || 'application/octet-stream' },
      body: new Uint8Array(data)
    })
    if (submit.status !== 429 || attempt >= RATE_LIMIT_RETRIES) break
    await delay(retryAfterMs(submit))
  }
  if (submit.status !== 202) throw new Error(`Document analysis submit failed (HTTP ${submit.status}): ${(await submit.text()).slice(0, 300)}`)
  const operation = submit.headers.get('operation-location')
  if (!operation) throw new Error('Document analysis submit returned no operation-location')

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await delay(POLL_DELAY_MS)
    const poll = await fetch(operation, { headers: { 'Ocp-Apim-Subscription-Key': key } })
    if (poll.status === 429) { await delay(retryAfterMs(poll)); continue }
    if (!poll.ok) throw new Error(`Document analysis poll failed (HTTP ${poll.status})`)
    const body = (await poll.json()) as { status: string; analyzeResult?: AzureAnalyzeResult; error?: { message?: string } }
    if (body.status === 'succeeded') {
      const result = body.analyzeResult ?? {}
      await writeFile(file, JSON.stringify(result))
      return result
    }
    if (body.status === 'failed') throw new Error(`Document analysis failed: ${body.error?.message ?? 'unknown error'}`)
  }
  throw new Error(`Document analysis timed out after ${(MAX_POLLS * POLL_DELAY_MS) / 1000}s`)
}

const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

/** Plain text of a photo, screenshot or scanned PDF. '' when unconfigured or unreadable. */
export async function readText(data: Buffer, contentType: string): Promise<string> {
  if (!isDocIntelConfigured()) return ''
  try {
    return tidy((await analyzeDocument(data, contentType, 'prebuilt-read')).content ?? '')
  } catch (error) {
    console.error('docintel read failed:', error instanceof Error ? error.message : error)
    return ''
  }
}

/** Structured PO fields when the document looks like a purchase order; null otherwise. */
export async function readPo(data: Buffer, contentType: string): Promise<{ po: ExtractedPo; text: string } | null> {
  if (!isDocIntelConfigured()) return null
  try {
    const r = await analyzeDocument(data, contentType, 'prebuilt-invoice')
    const po = mapInvoiceToPo(r)
    return po ? { po, text: tidy(r.content ?? '') } : null
  } catch (error) {
    console.error('docintel invoice failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/** Compact, prompt-ready rendering of an extracted PO. */
export function describePo(po: ExtractedPo): string {
  const lines = po.lineItems.map((l) =>
    `  - ${l.partNumber || '(no part no.)'} | ${l.description} | qty ${l.quantity ?? '?'} @ ${l.unitPrice ?? '?'}${l.amount != null ? ` = ${l.amount}` : ''}`)
  return [
    `PURCHASE ORDER as read by Azure Document Intelligence (confidence ${po.overallConfidence})`,
    `PO number: ${po.poNumber || '(not found)'}`,
    `Customer: ${po.customerName || '(not found)'}`,
    `Ship to: ${po.shipTo.replace(/\n/g, ', ') || '(not found)'}`,
    `Required date: ${po.requiredDate || '(none)'}`,
    `Total: ${po.total ?? '(none)'}`,
    'Lines:',
    ...(lines.length ? lines : ['  (none found)'])
  ].join('\n')
}

const PO_HINT = /\b(p\.?o\.?|purchase\s*order|order\s*(no|number|#))\b/i

export const MIME_BY_EXT: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', heic: 'image/heif' }
export const guessMime = (name: string, contentType?: string) =>
  contentType && contentType !== 'application/octet-stream' ? contentType : (MIME_BY_EXT[name.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream')

/**
 * Best text for one attachment: pdf-parse for text PDFs, Azure read for images and scanned
 * PDFs, plus the Azure invoice model when the file looks like a PO. '' when nothing could be
 * read, so callers can say so rather than guess.
 */
/** Outlook inline signature logos (image001.png etc.) and tiny images: not worth an OCR call. */
export const isSignatureImage = (name: string, bytes: number) => /^image\d{3}\.(png|jpe?g|gif)$/i.test(name) || (bytes < 12_000 && /\.(png|jpe?g|gif)$/i.test(name))

export async function attachmentToText(name: string, contentType: string, data: Buffer, subject = ''): Promise<string> {
  if (isSignatureImage(name, data.length)) return ''
  const mime = guessMime(name, contentType)
  const pdf = isPdf(name, mime)
  const image = isImage(name, mime) || /^image\//.test(mime)
  if (!pdf && !image) return ''
  let text = pdf ? await pdfText(data) : ''
  if (!text) text = await readText(data, mime)
  const looksLikePo = PO_HINT.test(name) || PO_HINT.test(subject) || /purchase\s*order|p\.?o\.?\s*(no|number|#)/i.test(text.slice(0, 1500))
  if (text && looksLikePo) {
    const po = await readPo(data, mime)
    if (po && (po.po.poNumber || po.po.lineItems.length)) text = `${describePo(po.po)}\n\n${text}`
  }
  return text
}
