/**
 * npm run draft -- "<from>" "<subject>" "<body>" [attachment paths...]
 * or pipe the body on stdin:  echo "..." | npm run draft -- from@x.com "Subject" -
 * Attachments (PDF, photos) are read with pdf-parse / Azure Document Intelligence.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { filesToDraftInput } from '../vision/attachments.js'
import { draftReply } from './draftReply.js'

const [from, subject, bodyArgRaw, ...paths] = process.argv.slice(2)
const bodyArg = bodyArgRaw === '-' ? '' : bodyArgRaw
if (!from || !subject) {
  console.error('usage: npm run draft -- <from> <subject> [body]   (body may come from stdin)')
  process.exit(1)
}
let body = bodyArg ?? ''
if (!body) {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  body = Buffer.concat(chunks).toString('utf8')
}
const files = await Promise.all(paths.map(async (p) => ({ name: basename(p), data: (await readFile(p)).toString('base64') })))
const input = files.length ? await filesToDraftInput({ from, subject, body }, files) : { from, subject, body }
const result = await draftReply(input)
console.log(result.draft || `(no draft: stop_reason=${result.stopReason})`)
if (result.notes) console.log(`\n[notes for Rachel] ${result.notes}`)
console.error(`\n-- tools: ${result.toolCalls.map((t) => t.name).join(', ') || 'none'} | in=${result.usage.input} out=${result.usage.output} cacheRead=${result.usage.cacheRead} cacheWrite=${result.usage.cacheWrite}`)
