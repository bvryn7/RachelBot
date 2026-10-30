/**
 * Retry with exponential backoff for calls to outside services (Graph, Azure,
 * JobBoss2). Transient failures — network errors, 429, 502/503/504 — are
 * retried; anything else is thrown at once. Only idempotent requests may be
 * retried: a JobBoss2 order POST never goes through here.
 */
const TEST = Boolean(process.env.VITEST)

export interface RetryOptions {
  tries?: number
  baseMs?: number
  label?: string
}

export class RetryableResponseError extends Error {
  constructor(public readonly response: Response, public readonly retryAfterMs: number | null) {
    super(`HTTP ${response.status}`)
  }
}

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504])

const retryAfter = (response: Response): number | null => {
  const header = Number(response.headers.get('retry-after'))
  return Number.isFinite(header) && header > 0 ? Math.min(header, 60) * 1000 : null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const tries = opts.tries ?? 4
  const baseMs = TEST ? 1 : (opts.baseMs ?? 500)
  let lastError: unknown
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const transient = error instanceof RetryableResponseError || isNetworkError(error)
      if (!transient || attempt === tries - 1) break
      const wait = (error instanceof RetryableResponseError && error.retryAfterMs) || baseMs * 2 ** attempt
      if (opts.label) console.error(`${opts.label}: ${error instanceof Error ? error.message : error} — retrying in ${wait} ms (${attempt + 1}/${tries - 1})`)
      await sleep(wait)
    }
  }
  if (lastError instanceof RetryableResponseError) return lastError.response as unknown as T
  throw lastError
}

/** fetch() for idempotent requests: transient statuses and network errors are retried with backoff. */
export async function fetchWithRetry(url: string, init: RequestInit | undefined, opts: RetryOptions = {}): Promise<Response> {
  return withRetry(async () => {
    const response = await fetch(url, init)
    if (TRANSIENT_STATUS.has(response.status)) {
      throw new RetryableResponseError(response, retryAfter(response))
    }
    return response
  }, opts)
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code ?? ''
  return error.name === 'TypeError' && /fetch failed/i.test(error.message) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR/i.test(code) ||
    /socket hang up|network timeout/i.test(error.message)
}
