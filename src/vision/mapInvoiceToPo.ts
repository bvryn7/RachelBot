/**
 * Azure prebuilt-invoice result -> PO fields. Copied from the order-entry project
 * (src/extraction/mapInvoiceToPo.ts) with the types inlined; keep the two in step.
 */
export interface AzureField {
  type?: string
  content?: string
  valueString?: string
  valueNumber?: number
  valueDate?: string
  valueCurrency?: { amount?: number }
  valueAddress?: Record<string, string>
  valueArray?: Array<{ valueObject?: Record<string, AzureField> }>
  confidence?: number
}

export interface AzureAnalyzeResult {
  content?: string
  documents?: Array<{ fields?: Record<string, AzureField>; confidence?: number }>
}

export interface ExtractedLineItem {
  partNumber: string
  description: string
  quantity: number | null
  unitPrice: number | null
  amount: number | null
}

export interface ExtractedPo {
  customerName: string
  poNumber: string
  shipTo: string
  requiredDate: string
  total: number | null
  lineItems: ExtractedLineItem[]
  overallConfidence: number
}

const text = (field?: AzureField): string => (field?.valueString ?? field?.content ?? '').trim()

const number = (field?: AzureField): number | null => {
  if (field?.valueCurrency?.amount !== undefined) return field.valueCurrency.amount
  if (field?.valueNumber !== undefined) return field.valueNumber
  const parsed = Number.parseFloat((field?.content ?? '').replace(/[$,]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

const address = (field?: AzureField): string => {
  if (field?.valueAddress) {
    const a = field.valueAddress
    const parts = [a.streetAddress, [a.city, a.state, a.postalCode].filter(Boolean).join(', ')].filter(Boolean)
    if (parts.length > 0) return parts.join('\n')
  }
  return text(field)
}

const mapLineItem = (obj: Record<string, AzureField>): ExtractedLineItem => ({
  partNumber: text(obj.ProductCode),
  description: text(obj.Description),
  quantity: number(obj.Quantity),
  unitPrice: number(obj.UnitPrice),
  amount: number(obj.Amount)
})

/** Customer POs share invoice geometry (parties, lines, totals, dates), so the invoice model applies. */
export function mapInvoiceToPo(result: AzureAnalyzeResult): ExtractedPo | null {
  const doc = result.documents?.[0]
  if (!doc?.fields) return null
  const f = doc.fields
  const lineItems = (f.Items?.valueArray ?? [])
    .map((i) => i.valueObject)
    .filter((o): o is Record<string, AzureField> => o !== undefined)
    .map(mapLineItem)
  const confidences = Object.values(f).map((x) => x.confidence).filter((c): c is number => c !== undefined)
  const overall = doc.confidence ?? (confidences.length ? confidences.reduce((s, c) => s + c, 0) / confidences.length : 0)
  return {
    customerName: text(f.CustomerName) || text(f.BillingAddressRecipient) || text(f.VendorName),
    // No InvoiceId fallback: a plausible-but-wrong PO number is worse than a blank.
    poNumber: text(f.PurchaseOrder),
    shipTo: address(f.ShippingAddress) || address(f.CustomerAddress),
    requiredDate: f.DueDate?.valueDate ?? '',
    total: number(f.InvoiceTotal),
    lineItems,
    overallConfidence: Math.round(overall * 100) / 100
  }
}
