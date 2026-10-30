/**
 * Strip quoted history, signatures and Outlook/safelinks noise from a plain-text
 * email body so the corpus holds only what Rachel (or the customer) actually wrote.
 */

const QUOTE_MARKERS = [
  /^From: .+$/m,
  /^-----Original Message-----$/m,
  /^On .{10,120} wrote:$/m,
  /^Sent from my /m,
  /^_{5,}$/m,
  /^>{1}\s/m
]

const SIGNATURE_MARKERS = [
  /^Thanks!?\s*Have a great day!?\s*$/im,
  /^Rachel( Bowman)?\s*(💙)?\s*$/im,
  /^Office Manager\s*$/im,
  /^Bulman Products\s*$/im,
  /^1650 McReynolds/im,
  /^You don't often get email from/im,
  /^\*\*\d{1,2}\/\d{1,2}\/\d{2,4} NEW:/im
]

export function stripQuoted(text: string): string {
  let cut = text.length
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text)
    if (m && m.index > 0 && m.index < cut) cut = m.index
  }
  return text.slice(0, cut)
}

export function stripSignature(text: string): { body: string; signoff: string | null } {
  let cut = text.length
  for (const re of SIGNATURE_MARKERS) {
    const m = re.exec(text)
    if (m && m.index > 0 && m.index < cut) cut = m.index
  }
  const body = text.slice(0, cut)
  const signoff = cut < text.length ? text.slice(cut).trim().split('\n').slice(0, 3).join(' ').slice(0, 120) : null
  return { body, signoff }
}

export function stripLinkNoise(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/^This message has \d+ attachments?\.?\s*$/gim, '')
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/<mailto:[^>]+>/g, '')
    .replace(/\[cid:[^\]]+\]/g, '')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/https:\/\/nam\d+\.safelinks\.protection\.outlook\.com\/\S+/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Outlook's text rendering of an attachment-only mail; carries no words of Rachel's. */
const ATTACHMENT_ONLY = /^This message has \d+ attachments?\.?$/i

/** Rachel's own words from one of her sent messages. */
export function cleanReply(text: string): string {
  const { body } = stripSignature(stripQuoted(stripLinkNoise(text)))
  const out = body.trim()
  return ATTACHMENT_ONLY.test(out) ? '' : out
}

/** The customer's own words from an inbound message. */
export function cleanInbound(text: string): string {
  return stripQuoted(stripLinkNoise(text)).trim()
}
