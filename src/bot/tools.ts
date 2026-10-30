import * as z from 'zod/v4'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { findOrdersByPoNumber, getOrder, listCustomers, priceHistory, recentOrdersForCustomer } from '../jobboss/prodReadClient.js'
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
    description: 'Find the customer in JobBoss2 by company name and list their recent orders (what they usually buy, last prices paid).',
    inputSchema: z.object({ companyName: z.string() }),
    run: async ({ companyName }) => {
      if (!isJb2Configured()) return asJson({ unavailable: 'JobBoss2 not configured' })
      const customers = await listCustomers()
      const needle = companyName.toLowerCase()
      const hits = customers.filter((c) => c.customerName.toLowerCase().includes(needle)).slice(0, 3)
      const orders = await Promise.all(hits.map(async (c) => ({ customer: c, orders: await recentOrdersForCustomer(c.customerCode, 8) })))
      return asJson(orders)
    }
  })

  const pastReplies = betaZodTool({
    name: 'past_replies',
    description: 'What Rachel told this same customer before (by email domain) and how she answered similar questions from anyone. Use it to stay consistent on prices and promises.',
    inputSchema: z.object({ question: z.string().describe('The customer question, used to find similar past exchanges') }),
    run: async ({ question }) => asJson({
      thisCustomer: historyFor(corpus, customerEmail, 5).map((e) => ({ when: e.sentAt, subject: e.subject, theyAsked: e.inbound, rachelSaid: e.reply })),
      similar: similarExchanges(corpus, question, 5).map((e) => ({ when: e.sentAt, subject: e.subject, theyAsked: e.inbound, rachelSaid: e.reply }))
    })
  })

  return [lookupPart, searchProducts, priceTool, orderStatus, customerOrders, pastReplies]
}
