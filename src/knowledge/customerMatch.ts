/**
 * Who is this email from, in JobBoss2 terms? Exact contact email first, then any
 * contact at the same domain, then a customer whose website is that domain.
 * Free-mail domains (gmail etc.) only match on the exact address.
 */
import type { Jb2Contact, Jb2Customer } from '../jobboss/prodReadClient.js'

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'comcast.net', 'me.com', 'live.com', 'msn.com'])

export interface CustomerMatch { customer: Jb2Customer; via: 'contact-email' | 'contact-domain' | 'website' }

const host = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

export function resolveCustomer(email: string, customers: Jb2Customer[], contacts: Jb2Contact[]): CustomerMatch[] {
  const e = email.toLowerCase()
  const dom = e.split('@')[1] ?? ''
  const byCode = new Map(customers.map((c) => [c.customerCode, c]))
  const out = new Map<string, CustomerMatch>()
  const add = (code: string, via: CustomerMatch['via']) => {
    const c = byCode.get(code)
    if (c && !out.has(code)) out.set(code, { customer: c, via })
  }
  for (const k of contacts) if (k.email.toLowerCase() === e) add(k.contactCode, 'contact-email')
  if (dom && !FREE_MAIL.has(dom)) {
    for (const k of contacts) if ((k.email.split('@')[1] ?? '').toLowerCase() === dom) add(k.contactCode, 'contact-domain')
    for (const c of customers) if (c.website && host(c.website) === dom) add(c.customerCode, 'website')
  }
  // Active accounts first.
  return [...out.values()].sort((a, b) => Number(b.customer.active) - Number(a.customer.active)).slice(0, 4)
}
