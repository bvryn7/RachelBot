/**
 * Microsoft Graph mail connection, ported from
 * Ai-Enabled-Order-Entry-Automation-true/src/mailbox/graphMailbox.ts.
 *
 * READ ONLY. There is no PATCH/POST/DELETE path in this file on purpose: the
 * order-entry project marks mail read; this one only studies history.
 */
import { config, isGraphConfigured } from '../config.js'
import { tokenCache } from '../cache/diskCache.js'
import { fetchWithRetry } from '../util/retry.js'

const getGraphToken = tokenCache(async () => {
  if (!isGraphConfigured()) throw new Error('Microsoft Graph not configured (GRAPH_TENANT_ID / CLIENT_ID / CLIENT_SECRET / MAILBOX)')
  const response = await fetchWithRetry(`https://login.microsoftonline.com/${config.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.GRAPH_CLIENT_ID!,
      client_secret: config.GRAPH_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  })
  if (!response.ok) throw new Error(`Microsoft Graph auth failed (HTTP ${response.status})`)
  return (await response.json()) as { access_token: string; expires_in: number }
})

export async function graphGet<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
  const token = await getGraphToken()
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers }
  }, { label: `Graph ${path.split('?')[0].slice(0, 60)}` })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new Error(`Graph GET failed (HTTP ${response.status}) ${detail}`)
  }
  return (await response.json()) as T
}

export interface GraphMessage {
  id: string
  conversationId?: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  toRecipients?: { emailAddress?: { address?: string; name?: string } }[]
  receivedDateTime?: string
  sentDateTime?: string
  hasAttachments?: boolean
  body?: { contentType?: string; content?: string }
  bodyPreview?: string
  isRead?: boolean
}

const SELECT = 'id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,hasAttachments,body,isRead'
const TEXT_BODY = { Prefer: 'outlook.body-content-type="text"' }
const DAY = 24 * 60 * 60 * 1000

export interface ListOptions {
  /** Mailbox to read; defaults to GRAPH_MAILBOX. */
  mailbox?: string
  folder: string
  /** Skip anything received within the last N days. Floored at GRAPH_MIN_AGE_DAYS. */
  olderThanDays?: number
  newerThanDays?: number
  max?: number
  onPage?: (count: number) => void
}

/**
 * List messages in a folder of GRAPH_MAILBOX, newest first, following
 * @odata.nextLink until `max`. Honors the hard rule: nothing newer than
 * GRAPH_MIN_AGE_DAYS is ever returned.
 */
export async function listMessages(opts: ListOptions): Promise<GraphMessage[]> {
  const mailbox = encodeURIComponent(opts.mailbox ?? config.GRAPH_MAILBOX!)
  const folder = encodeURIComponent(opts.folder)
  const minAge = Math.max(config.GRAPH_MIN_AGE_DAYS, opts.olderThanDays ?? 0)
  const cutoff = new Date(Date.now() - minAge * DAY)
  const floor = opts.newerThanDays === undefined ? null : new Date(Date.now() - opts.newerThanDays * DAY)
  const filters = [
    `receivedDateTime le ${cutoff.toISOString()}`,
    floor ? `receivedDateTime ge ${floor.toISOString()}` : null
  ].filter(Boolean)
  const max = opts.max ?? 500
  let next: string | null = `/users/${mailbox}/mailFolders/${folder}/messages?$filter=${filters.join(' and ')}&$top=${Math.min(100, max)}&$select=${SELECT}`
  const out: GraphMessage[] = []
  while (next && out.length < max) {
    const page: { value: GraphMessage[]; '@odata.nextLink'?: string } = await graphGet(next, TEXT_BODY)
    for (const m of page.value) {
      // Client-side re-check so a loosened server filter can never leak recent mail.
      const received = m.receivedDateTime ? new Date(m.receivedDateTime) : null
      if (!received || received > cutoff) continue
      if (floor && received < floor) continue
      out.push(m)
    }
    opts.onPage?.(out.length)
    next = page['@odata.nextLink'] ?? null
  }
  return out.slice(0, max)
}

/** Every message in a conversation, oldest first, from any folder of the mailbox. */
export async function getConversation(conversationId: string, mailboxAddress = config.GRAPH_MAILBOX!): Promise<GraphMessage[]> {
  const mailbox = encodeURIComponent(mailboxAddress)
  const page: { value: GraphMessage[] } = await graphGet(
    `/users/${mailbox}/messages?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'&$top=50&$select=${SELECT}`,
    TEXT_BODY
  )
  return page.value
    .filter((m) => !m.receivedDateTime || new Date(m.receivedDateTime) <= new Date(Date.now() - config.GRAPH_MIN_AGE_DAYS * DAY))
    .sort((a, b) => (a.receivedDateTime ?? '').localeCompare(b.receivedDateTime ?? ''))
}

export interface GraphAttachmentMeta { name: string; contentType: string; size: number }
export interface GraphAttachment extends GraphAttachmentMeta { '@odata.type': string; contentBytes?: string }

/** File attachments with content (base64) for files up to `maxBytes`; larger ones come back without bytes. */
export async function getAttachments(messageId: string, mailboxAddress = config.GRAPH_MAILBOX!, maxBytes = 3_000_000): Promise<GraphAttachment[]> {
  const mailbox = encodeURIComponent(mailboxAddress)
  const page: { value: GraphAttachment[] } = await graphGet(`/users/${mailbox}/messages/${messageId}/attachments`)
  return page.value
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment')
    .map((a) => (a.size > maxBytes ? { ...a, contentBytes: undefined } : a))
}

export async function listAttachmentNames(messageId: string, mailboxAddress = config.GRAPH_MAILBOX!): Promise<GraphAttachmentMeta[]> {
  const mailbox = encodeURIComponent(mailboxAddress)
  const page: { value: GraphAttachmentMeta[] } = await graphGet(`/users/${mailbox}/messages/${messageId}/attachments?$select=name,contentType,size`)
  return page.value
}
