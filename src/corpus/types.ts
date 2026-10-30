export type Topic =
  | 'quote'          // pricing / quote request
  | 'dimensions'     // size, length, width, capacity questions
  | 'product_info'   // what is it, how does it work, compatibility, replacement parts
  | 'availability'   // stock, lead time, where to buy
  | 'order_status'   // where is my order, tracking, PO follow-up
  | 'invoice'        // billing, payment, remittance
  | 'other'

export interface Exchange {
  /** Graph id of Rachel's sent message. */
  replyId: string
  conversationId: string
  subject: string
  customerEmail: string
  customerDomain: string
  sentAt: string
  /** Customer message Rachel was answering (cleaned), or null when she started the thread. */
  inbound: string | null
  inboundAt: string | null
  /** Rachel's words only: quoted history and signature stripped. */
  reply: string
  /** Every earlier message in the thread, oldest first, cleaned, for context. */
  thread: { from: string; at: string; text: string }[]
  attachments: string[]
  topic: Topic
  /** Part numbers mentioned anywhere in the exchange. */
  partNumbers: string[]
  /** Dollar amounts Rachel quoted. */
  prices: string[]
}
