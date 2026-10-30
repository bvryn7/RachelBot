import { config } from '../config.js'
import { fetchWithRetry } from '../util/retry.js'
import { tokenCache } from '../cache/diskCache.js'
const getToken = tokenCache(async () => {
  const r = await fetchWithRetry(`${config.JB2_AUTH_HOST}/oauth2/api-user/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.JB2_PROD_CLIENT_ID!, client_secret: config.JB2_PROD_CLIENT_SECRET!, scope: 'openid', grant_type: 'client_credentials' }) })
  return r.json() as Promise<{ access_token: string; expires_in: number }>
})
for (const path of process.argv.slice(2)) {
  const r = await fetch(`${config.JB2_API_HOST}${path}`, { headers: { Authorization: `Bearer ${await getToken()}`, 'x-api-key': config.JB2_API_KEY ?? '', Accept: 'application/json' } })
  const text = await r.text()
  console.log('###', path, r.status, text.slice(0, 1200), '\n')
}
