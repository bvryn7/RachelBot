import { listCustomers, listParts } from './prodReadClient.js'

const parts = await listParts(true)
const customers = await listCustomers(true)
console.log(`parts=${parts.length} customers=${customers.length} -> data/reference/`)
const sample = parts.find((p) => p.price != null) ?? parts[0]
console.log('sample part fields:', sample ? Object.keys(sample.raw).join(', ') : 'none')
