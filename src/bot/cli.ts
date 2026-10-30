/**
 * npm run draft -- "<from>" "<subject>" "<body>"
 * or pipe the body on stdin:  echo "..." | npm run draft -- from@x.com "Subject"
 */
import { draftReply } from './draftReply.js'

const [from, subject, bodyArg] = process.argv.slice(2)
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
const result = await draftReply({ from, subject, body })
console.log(result.draft || `(no draft: stop_reason=${result.stopReason})`)
console.error(`\n-- tools: ${result.toolCalls.map((t) => t.name).join(', ') || 'none'} | in=${result.usage.input} out=${result.usage.output} cacheRead=${result.usage.cacheRead} cacheWrite=${result.usage.cacheWrite}`)
