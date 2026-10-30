import * as z from 'zod/v4'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { findOrdersByPoNumber, getOrder, listContacts, listCustomers, priceHistory, recentOrdersForCustomer, type Jb2Customer } from '../jobboss/prodReadClient.js'
import { resolveCustomer } from '../knowledge/customerMatch.js'
import { isJb2Configured } from '../config.js'
import { findPart, searchCatalogue, type CatalogueItem } from '../knowledge/catalogue.js'
import { historyFor, similarExchanges } from '../corpus/load.js'
import type { Exchange } from '../corpus/types.js'

const asJson = (v: unknown) => JSON.stringify(v, null, 1)

export function makeTools(catalogue: CatalogueItem[], corpus: Exchange[], customerEmail: string) {
  const lookupPart = betaZodTool({
    name: 'lookup_part',
    description: 'Exact lookup of one Bulman part number (or a customer alternate number) in the digital catalogue: name, description, dimensions, list price, active flag.',
    inputSchema: z.object({ partNumber: z.string().describe('Part number as written by the customer, e.g. A500-24') }),
    run: async ({ partNumber }) => asJson(findPart(catalogue, partNumber) ?? { notFound: partNumber })
  })

  const searchProducts = betaZodTool({
    name: 'search_catalogue',
    description: 'Keyword search of the catalogue when the customer describes a product instead of naming a part number (e.g. "24 inch paper cutter", "ribbon dispenser"). Returns up to 8 candidates with dimensions and prices.',
    inputSchema: z.object({ query: z.string() }),
    run: async ({ query }) => asJson(searchCatalogue(catalogue, query))
  })

  const priceTool = betaZodTool({
    name: 'price_history',
    description: 'Prices a part has actually sold at recently (JobBoss2 order lines, newest first): unit price, quantity, date, order number. Use the newest price as the current price; mention quantity breaks only if the history shows them.',
    inputSchema: z.object({ partNumber: z.string() }),
    run: async ({ partNumber }) => {
      if (!isJb2Configured()) return asJson({ unavailable: 'JobBoss2 not configured' })
      return asJson(await priceHistory(partNumber, 15))
    }
  })

  const orderStatus = betaZodTool({
    name: 'order_status',
    description: 'Look up a customer PO number or a Bulman order number in JobBoss2 (production, read only). Returns order header and line items with due dates and ship status.',
    inputSchema: z.object({
      poNumber: z.string().optional().describe('Customer PO number'),
      orderNumber: z.string().optional().describe('Bulman sales order number')
    }),
    run: async ({ poNumber, orderNumber }) => {
      if (!isJb2Configured()) return asJson({ unavailable: 'JobBoss2 not configured' })
      if (orderNumber) return asJson(await getOrder(orderNumber))
      if (poNumber) {
        const orders = await findOrdersByPoNumber(poNumber)
        const detailed = await Promise.all(orders.slice(0, 3).map((o) => (o.orderNumber ? getOrder(o.orderNumber) : o)))
        return asJson(detailed)
      }
      return asJson({ error: 'give poNumber or orderNumber' })
    }
  })

  const customerOrders = betaZodTool({
    name: 'customer_recent_orders',
    description: 'Who this sender is in JobBoss2 (matched by their email address, or by company name if you give one), their payment terms, and what they bought recently with the unit prices they paid. Use it to quote the price this account normally gets and to know if they are an existing account or a new contact.',
    inputSchema: z.object({ companyName: z.string().optional().describe('Only when the sender email does not identify the company') }),
    run: async ({ companyName }) => {
      if (!isJb2Configured()) return asJson({ unavailable: 'JobBoss2 not configured' })
      const [customers, contacts] = await Promise.all([listCustomers(), listContacts()])
      let hits: { customer: Jb2Customer; via: string }[] = resolveCustomer(customerEmail, customers, contacts)
      if (companyName) {
        const needle = companyName.toLowerCase()
        for (const c of customers.filter((c) => c.customerName.toLowerCase().includes(needle)).slice(0, 3)) {
          if (!hits.some((h) => h.customer.customerCode === c.customerCode)) hits.push({ customer: c, via: 'name' })
        }
      }
      if (!hits.length) return asJson({ match: 'none', note: 'No JobBoss2 account or contact matches this sender; treat as a new contact.' })
      const result = await Promise.all(hits.slice(0, 3).map(async ({ customer, via }) => {
        const orders = await recentOrdersForCustomer(customer.customerCode, 6)
        const detailed = await Promise.all(orders.slice(0, 3).map(async (o) => {
          const full = o.orderNumber ? await getOrder(o.orderNumber).catch(() => null) : null
          const lines = ((full?.lineItems as Record<string, unknown>[] | undefined) ?? []).map((l) => ({
            part: l.partNumber, qty: l.quantityOrdered, unitPrice: l.unitPrice, due: l.dueDate, status: l.status
          }))
          return { orderNumber: o.orderNumber, po: o.PONumber, date: full?.dateEntered ?? full?.orderDate, lines }
        }))
        return { matchedVia: via, customer: { code: customer.customerCode, name: customer.customerName, active: customer.active, terms: customer.termsCode }, recentOrders: detailed }
      }))
      return asJson(result)
    }
  })

  const pastReplies = betaZodTool({
    name: 'past_replies',
    description: 'What Rachel told this same customer before (by email domain) and how she answered similar questions from anyone. Use it to stay consistent on prices and promises.',
    inputSchema: z.object({ question: z.string().describe('The customer question, used to find similar past exchanges') }),
    run: async ({ question }) => asJson({
      thisCustomer: historyFor(corpus, customerEmail, 5).map((e) => ({ when: e.sentAt.slice(0, 10), subject: e.subject, theyAsked: e.inbound, theirAttachment: e.inboundAttachmentText?.slice(0, 600) ?? undefined, rachelSaid: e.reply })),
      similar: similarExchanges(corpus, question, 5).map((e) => ({ when: e.sentAt.slice(0, 10), subject: e.subject, theyAsked: e.inbound, rachelSaid: e.reply }))
    })
  })

  return [lookupPart, searchProducts, priceTool, orderStatus, customerOrders, pastReplies]
}
