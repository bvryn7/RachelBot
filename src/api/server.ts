import express from 'express'
import { z } from 'zod'
import { config, isClaudeConfigured, isGraphConfigured, isJb2Configured } from '../config.js'
import { draftReply, loadKnowledge } from '../bot/draftReply.js'

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/health', async (_req, res) => {
  const k = await loadKnowledge()
  res.json({
    ok: true,
    claude: isClaudeConfigured(), graph: isGraphConfigured(), jobboss: isJb2Configured(),
    corpusExchanges: k.corpus.length, catalogueItems: k.catalogue.length
  })
})

const DraftBody = z.object({
  from: z.string().email(),
  subject: z.string().default(''),
  body: z.string().min(1),
  thread: z.array(z.object({ from: z.string(), text: z.string() })).optional(),
  attachments: z.array(z.string()).optional(),
  attachmentText: z.string().optional(),
  images: z.array(z.object({ mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']), data: z.string() })).optional()
})

app.post('/draft', async (req, res) => {
  const parsed = DraftBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  try {
    res.json(await draftReply(parsed.data))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/reload', async (_req, res) => {
  const k = await loadKnowledge(true)
  res.json({ corpusExchanges: k.corpus.length, catalogueItems: k.catalogue.length })
})

app.listen(config.PORT, () => console.log(`Bulman CS bot on http://localhost:${config.PORT}`))
