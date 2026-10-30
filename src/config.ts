import 'dotenv/config'
import { z } from 'zod'

const blankAsUndefined = (v: unknown) => (v === '' ? undefined : v)
const optional = <T extends z.ZodTypeAny>(inner: T) => z.preprocess(blankAsUndefined, inner.optional())

const schema = z.object({
  PORT: z.coerce.number().int().default(3100),
  DATA_DIR: z.string().default('./data'),

  ANTHROPIC_API_KEY: optional(z.string().min(1)),

  GRAPH_TENANT_ID: optional(z.string().min(1)),
  GRAPH_CLIENT_ID: optional(z.string().min(1)),
  GRAPH_CLIENT_SECRET: optional(z.string().min(1)),
  GRAPH_MAILBOX: optional(z.string().email()),
  // Rachel's own mailbox. Replies she sends from the shared bulman@ box are saved in HER Sent Items
  // (the shared mailbox's Sent Items is empty), so the corpus is harvested from here.
  RACHEL_MAILBOX: z.string().email().default('rbowman@bulmanproducts.com'),
  // HARD RULE (Ben, 2026-10-21/22, inherited from order entry): mail received within the
  // last N days is never fetched. This project never PATCHes mail at all.
  GRAPH_MIN_AGE_DAYS: z.coerce.number().int().min(25).default(25),

  JB2_AUTH_HOST: z.string().url().default('https://api-user.integrations.ecimanufacturing.com'),
  JB2_API_HOST: z.string().url().default('https://api-jb2.integrations.ecimanufacturing.com'),
  JB2_API_KEY: optional(z.string().min(1)),
  JB2_PROD_CLIENT_ID: optional(z.string().min(1)),
  JB2_PROD_CLIENT_SECRET: optional(z.string().min(1)),

  // Azure AI Document Intelligence (same resource as the order-entry project): reads photos,
  // screenshots and scanned PDFs the customer attaches, and pulls PO fields off purchase orders.
  AZURE_DOCINTEL_ENDPOINT: optional(z.string().url()),
  AZURE_DOCINTEL_KEY: optional(z.string().min(1))
})

export type Config = z.infer<typeof schema>
export const config: Config = schema.parse(process.env)

export const isClaudeConfigured = (): boolean => Boolean(config.ANTHROPIC_API_KEY)
export const isGraphConfigured = (): boolean =>
  Boolean(config.GRAPH_TENANT_ID && config.GRAPH_CLIENT_ID && config.GRAPH_CLIENT_SECRET && config.GRAPH_MAILBOX)
export const isJb2Configured = (): boolean => Boolean(config.JB2_PROD_CLIENT_ID && config.JB2_PROD_CLIENT_SECRET)
export const isDocIntelConfigured = (): boolean => Boolean(config.AZURE_DOCINTEL_ENDPOINT && config.AZURE_DOCINTEL_KEY)
