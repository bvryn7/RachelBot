/**
 * READ-ONLY JobBoss2 production client, ported from
 * Ai-Enabled-Order-Entry-Automation-true/src/jobboss/prodReadClient.ts.
 * `prodFetch` is hard-wired to GET so this project can never write to JB2.
 */
import { config, isJb2Configured } from '../config.js'
import { cached, tokenCache } from '../cache/diskCache.js'
import { fetchWithRetry } from '../util/retry.js'

const getToken = tokenCache(async () => {
  if (!isJb2Configured()) throw new Error('JobBoss2 not configured (JB2_PROD_CLIENT_ID / JB2_PROD_CLIENT_SECRET)')
  const response = await fetchWithRetry(`${config.JB2_AUTH_HOST}/oauth2/api-user/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.JB2_PROD_CLIENT_ID!,
      client_secret: config.JB2_PROD_CLIENT_SECRET!,
      scope: 'openid',
      grant_type: 'client_credentials'
    })
  })
  if (!response.ok) throw new Error(`JobBoss2 auth failed (HTTP ${response.status})`)
  return (await response.json()) as { access_token: string; expires_in: number }
})

async function prodFetch(path: string): Promise<Response> {
  const token = await getToken()
  return fetchWithRetry(`${config.JB2_API_HOST}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(config.JB2_API_KEY ? { 'x-api-key': config.JB2_API_KEY } : {}),
      Accept: 'application/json'
    }
  }, { label: `JB2 ${path.split('?')[0]}` })
}

async function getJson<T>(path: string, what: string): Promise<T> {
  const response = await prodFetch(path)
  if (!response.ok) throw new Error(`JobBoss2 ${what} failed (HTTP ${response.status})`)
  return (await response.json()) as T
}

async function pageAll<T>(path: string, limit: number, pick: (row: Record<string, unknown>) => T | null): Promise<T[]> {
  const all: T[] = []
  const pageSize = 200
  for (let skip = 0; skip < limit; skip += pageSize) {
    const sep = path.includes('?') ? '&' : '?'
    const page = (await getJson<{ Data?: Record<string, unknown>[] }>(`${path}${sep}take=${pageSize}&skip=${skip}`, `list ${path}`)).Data ?? []
    for (const row of page) { const item = pick(row); if (item) all.push(item) }
    if (page.length < pageSize) break
  }
  return all
}

export interface Jb2Part {
  partNumber: string
  description: string
  alternatePartNumber: string
  /** Unit price from the estimate record when the API returns one. */
  price: number | null
  unit: string
  /** Everything else JB2 sent, kept so the knowledge builder can mine dimensions and weights. */
  raw: Record<string, unknown>
}
export interface Jb2Customer { customerCode: string; customerName: string; active: boolean }
export interface Jb2Order { orderNumber?: number; PONumber?: string; customerCode?: string; [key: string]: unknown }

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Full part master (JB2 "estimates"), disk-cached 24 h. */
export const listParts = (force = false) =>
  cached<Jb2Part[]>('reference', 'jb2-prod-parts', () => pageAll('/api/v1/estimates', 50000, (r) =>
    r.partNumber ? {
      partNumber: String(r.partNumber),
      description: String(r.description ?? r.partDescription ?? ''),
      alternatePartNumber: String(r.alternatePartNumber ?? ''),
      price: num(r.price ?? r.unitPrice ?? r.lastPrice),
      unit: String(r.pricingUnit ?? r.unit ?? 'EA'),
      raw: r
    } : null), { force })

/** Customer list, disk-cached 24 h. */
export const listCustomers = (force = false) =>
  cached<Jb2Customer[]>('reference', 'jb2-prod-customers', () => pageAll('/api/v1/customers', 10000, (r) =>
    r.customerCode ? { customerCode: String(r.customerCode), customerName: String(r.customerName ?? ''), active: r.active !== false } : null), { force })

/** Orders carrying a customer PO number (live, not cached: order status changes). */
export async function findOrdersByPoNumber(poNumber: string): Promise<Jb2Order[]> {
  return (await getJson<{ Data?: Jb2Order[] }>(`/api/v1/orders?PONumber=${encodeURIComponent(poNumber)}`, 'order lookup')).Data ?? []
}

export async function getOrder(orderNumber: number | string): Promise<Jb2Order | null> {
  const response = await prodFetch(`/api/v1/orders/${encodeURIComponent(String(orderNumber))}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`JobBoss2 order read failed (HTTP ${response.status})`)
  const body = (await response.json()) as { Data?: Jb2Order } | Jb2Order
  const order = (body as { Data?: Jb2Order }).Data ?? (body as Jb2Order)
  order.lineItems = (await getJson<{ Data?: unknown[] }>(`/api/v1/order-line-items?orderNumber=${encodeURIComponent(String(orderNumber))}&take=200`, 'line items')).Data ?? []
  return order
}

export interface SoldPrice { unitPrice: number; quantity: number; date: string; orderNumber: string; status: string }

/** Price history for a part from order line items, newest first (live). This is where JB2 keeps prices; the estimate record has none. */
export async function priceHistory(partNumber: string, take = 25): Promise<SoldPrice[]> {
  const rows = (await getJson<{ Data?: Record<string, unknown>[] }>(`/api/v1/order-line-items?partNumber=${encodeURIComponent(partNumber)}&take=${take}`, 'price history')).Data ?? []
  return rows
    .map((r) => ({
      unitPrice: num(r.unitPrice) ?? 0,
      quantity: num(r.quantityOrdered) ?? 0,
      date: String(r.dateFinished ?? r.dueDate ?? ''),
      orderNumber: String(r.orderNumber ?? ''),
      status: String(r.status ?? '')
    }))
    .filter((r) => r.unitPrice > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Recent orders for a customer (live). */
export async function recentOrdersForCustomer(customerCode: string, take = 10): Promise<Jb2Order[]> {
  return (await getJson<{ Data?: Jb2Order[] }>(`/api/v1/orders?customerCode=${encodeURIComponent(customerCode)}&take=${take}`, 'customer orders')).Data ?? []
}
