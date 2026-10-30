import { graphGet } from '../mailbox/graphClient.js'
import { config } from '../config.js'
const mb = encodeURIComponent(config.GRAPH_MAILBOX!)
const f = await graphGet<{ value: { displayName: string; totalItemCount: number }[] }>(`/users/${mb}/mailFolders?$top=50&$select=id,displayName,totalItemCount`)
for (const x of f.value) console.log(x.displayName, x.totalItemCount)
const s = await graphGet<{ value: Record<string, any>[] }>(`/users/${mb}/mailFolders/SentItems/messages?$top=3&$select=id,subject,receivedDateTime,sentDateTime,from`)
console.log(JSON.stringify(s.value.map((m) => [m.subject, m.receivedDateTime, m.sentDateTime, m.from?.emailAddress?.address]), null, 1))
