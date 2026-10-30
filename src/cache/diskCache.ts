/**
 * Cache layer borrowed from Ai-Enabled-Order-Entry-Automation-true
 * (src/jobboss/prodReadClient.ts `cachedList`) and generalised.
 *
 * Two tiers:
 *   - tokenCache(): in-memory OAuth token with a 5-minute safety margin.
 *   - cached():     JSON on disk under DATA_DIR/<bucket>/<name>.json with a TTL,
 *                   so reference lists (parts, customers, catalogue) are fetched
 *                   once a day and every CLI / server run after that is free.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'

export const DAY_MS = 24 * 60 * 60 * 1000

export interface CachedEnvelope<T> { fetchedAt: number; items: T }

export async function cached<T>(
  bucket: string,
  name: string,
  fetchAll: () => Promise<T>,
  opts: { ttlMs?: number; force?: boolean } = {}
): Promise<T> {
  const ttl = opts.ttlMs ?? DAY_MS
  const dir = join(config.DATA_DIR, bucket)
  const file = join(dir, `${name}.json`)
  if (!opts.force) {
    const hit = await readCached<T>(file)
    if (hit && Date.now() - hit.fetchedAt < ttl) return hit.items
  }
  let items: T
  try {
    items = await fetchAll()
  } catch (error) {
    // API down: serve whatever is on disk, however old, rather than failing the bot.
    const stale = await readCached<T>(file)
    if (stale) { console.error(`${bucket}/${name}: refresh failed, serving stale cache`, error instanceof Error ? error.message : error); return stale.items }
    throw error
  }
  await mkdir(dir, { recursive: true })
  await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), items } satisfies CachedEnvelope<T>))
  return items
}

export async function readCached<T>(file: string): Promise<CachedEnvelope<T> | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as CachedEnvelope<T> } catch { return null }
}

export function tokenCache(fetchToken: () => Promise<{ access_token: string; expires_in: number }>) {
  let entry: { token: string; expiresAt: number } | null = null
  return async (): Promise<string> => {
    if (entry && Date.now() < entry.expiresAt) return entry.token
    const body = await fetchToken()
    entry = { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 300) * 1000 }
    return entry.token
  }
}
