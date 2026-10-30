import { describe, expect, it } from 'vitest'
import { cleanInbound, cleanReply } from './cleanBody.js'
import { classifyTopic, extractPartNumbers, extractPrices } from '../corpus/classify.js'

const rachel = `Hello- thank you for the order- The A500-24 is priced at $32.23 each- but our prices are increasing Jan 1, 2027
Thanks! Have a great day!
Rachel Bowman 💙
Office Manager
Bulman Products
1650 McReynolds Ave NW
From: DSC Accounting <accounting@dealersupply.com<mailto:accounting@dealersupply.com>>
Sent: Tuesday, September 22, 2026 2:51 PM
To: Bulman
Subject: Purchase Order PO-26-1904`

describe('cleanReply', () => {
  it('keeps only Rachel\'s words', () => {
    const out = cleanReply(rachel)
    expect(out).toContain('A500-24 is priced at $32.23')
    expect(out).not.toContain('Office Manager')
    expect(out).not.toContain('From: DSC')
    expect(out).not.toContain('mailto:')
  })
})

describe('cleanReply attachment-only', () => {
  it('drops placeholder bodies', () => { expect(cleanReply('This message has 1 attachment.')).toBe('') })
})

describe('cleanInbound', () => {
  it('drops quoted thread and safelinks', () => {
    const out = cleanInbound(`Hi Rachel, PO 8891344 is what I have on file. <https://nam02.safelinks.protection.outlook.com/?url=x>\nOn Thu, Sep 24, 2026 at 12:56 PM Bulman wrote:\nold stuff`)
    expect(out).toBe('Hi Rachel, PO 8891344 is what I have on file.')
  })
})

describe('classify', () => {
  it('topics', () => {
    expect(classifyTopic('Can you quote 10 of the A500-24?')).toBe('quote')
    expect(classifyTopic('How wide is the T344R-27?')).toBe('dimensions')
    expect(classifyTopic('Where is my order, any tracking?')).toBe('order_status')
  })
  it('parts and prices', () => {
    expect(extractPartNumbers('New prices: 2332424- $27.65, A-500-06- $34.26, T344R-27- $265.23 M761R')).toEqual(
      expect.arrayContaining(['2332424', 'A-500-06', 'T344R-27', 'M761R'])
    )
    expect(extractPrices('$27.65 and $ 1,200')).toEqual(['$27.65', '$1,200'])
  })
})
