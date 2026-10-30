import { listContacts, listCustomers } from '../jobboss/prodReadClient.js'
import { resolveCustomer } from '../knowledge/customerMatch.js'
const [customers, contacts] = await Promise.all([listCustomers(), listContacts()])
for (const e of process.argv.slice(2)) console.log(e, '->', resolveCustomer(e, customers, contacts).map((m) => `${m.customer.customerCode} (${m.via}, ${m.customer.active ? 'active' : 'inactive'})`).join('; ') || 'no match')
