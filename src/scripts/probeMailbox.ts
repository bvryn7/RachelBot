import { graphGet } from '../mailbox/graphClient.js'
const who = process.argv[2]
try {
  const f = await graphGet<{ value: { displayName: string; totalItemCount: number }[] }>(`/users/${encodeURIComponent(who)}/mailFolders?$top=50&$select=displayName,totalItemCount`)
  console.log(who, '->', f.value.map((x) => `${x.displayName}=${x.totalItemCount}`).join(' '))
} catch (e) { console.log(who, '->', (e as Error).message.slice(0, 160)) }
