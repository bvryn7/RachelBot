/**
 * Turn raw attachments (name + base64) into what draftReply wants: extracted text for
 * every readable file, plus the images themselves so Claude can also look at them.
 */
import type { DraftInput } from '../bot/draftReply.js'
import { attachmentToText, guessMime } from './docIntel.js'

export interface RawFile { name: string; contentType?: string; data: string }

const CLAUDE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_BYTES = 4_500_000

export async function filesToDraftInput(base: Omit<DraftInput, 'attachments' | 'attachmentText' | 'images'> & Partial<DraftInput>, files: RawFile[]): Promise<DraftInput> {
  const texts: string[] = []
  const images: NonNullable<DraftInput['images']> = [...(base.images ?? [])]
  for (const f of files) {
    const mime = guessMime(f.name, f.contentType)
    const buf = Buffer.from(f.data, 'base64')
    const text = await attachmentToText(f.name, mime, buf, base.subject)
    if (text) texts.push(`--- ${f.name}\n${text.slice(0, 6000)}`)
    if (CLAUDE_IMAGE.has(mime) && buf.length <= MAX_IMAGE_BYTES) images.push({ mediaType: mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: f.data })
  }
  return {
    ...base,
    attachments: [...(base.attachments ?? []), ...files.map((f) => f.name)],
    attachmentText: [base.attachmentText, ...texts].filter(Boolean).join('\n\n') || undefined,
    images: images.length ? images.slice(0, 4) : undefined
  }
}
