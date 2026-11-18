// Turns the text of a receipt (from OCR) into draft items. It is a best guess:
// the app always shows the result for the user to check and fix.

export type ParsedReceipt = {
  items: { name: string; amount: number }[]
  extras: number // service charge + tax + rounding - discount
  total: number | null // the total printed on the receipt, if found
  mismatch: boolean // items + charges do not match the printed total: something was misread
}

const PRICE = /(-?\(?\d{1,3}(?:,\d{3})+[.,]\s?\d{2}\)?|-?\d+[.,]\s?\d{2}\)?)(?!\d)/g

const TOTAL =
  /\b(grand\s*t\w{2,5}|t[o0]t[a-z]{1,3}\s*(due|amount|payable|rm|myr)?|amount\s*(due|payable)|net\s*t\w{2,5}|balance\s*due|jumlah)\b/i
const SUBTOTAL = /\b(sub\s*-?\s*total|subtotal)\b/i
const CHARGE =
  /\b(service\s*(charge|tax)?|svc|s\.?\s?charge|sc|sst|gst|vat|tax|cukai|rounding|round(ed)?\s*(adj|adjustment)?|adj(ustment)?|tips?|packaging|delivery)\b/i
const DISCOUNT = /\b(discount|disc|promo|voucher|rebate|coupon|off)\b/i
const IGNORE =
  /\b(cash|change|tender|tendered|paid|payment|visa|master(card)?|card|qr|e-?wallet|tng|grabpay|invoice|receipt|bill\s*no|table|tel|phone|date|time|cashier|server|pax|guest|reg(istration)?|thank|gst\s*id|sst\s*id|tax\s*id|order\s*no|check\s*no)\b/i

const num = (s: string) => {
  let t = s.trim()
  const neg = t.startsWith('-') || (t.startsWith('(') && t.endsWith(')'))
  t = t.replace(/[()\-\s]/g, '')
  // "1,234.50" -> 1234.50 ; "12,50" -> 12.50
  if (/,\d{2}$/.test(t) && !/\./.test(t)) t = t.replace(',', '.')
  t = t.replace(/,(?=\d{3})/g, '')
  const v = parseFloat(t)
  return neg ? -v : v
}

const clean = (s: string) =>
  s
    .replace(/[|_~`]+/g, ' ')
    .replace(/^[\s.\-*#:=]+|[\s.\-*#:=]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

export function parseReceipt(text: string): ParsedReceipt {
  const items: ParsedReceipt['items'] = []
  let chargeSum = 0
  let total: number | null = null
  

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const prices = [...line.matchAll(PRICE)]
    if (prices.length === 0) continue
    const last = prices[prices.length - 1]
    const amount = num(last[0])
    if (!Number.isFinite(amount)) continue
    const label = clean(line.slice(0, prices[0].index))

    if (SUBTOTAL.test(line)) continue
    
    if (TOTAL.test(line) && !CHARGE.test(label.replace(TOTAL, ''))) {
      total = amount // the last "total" line is the final one (after discounts)
      continue
    }
    if (DISCOUNT.test(label) && !/^\d/.test(label)) {
      chargeSum -= Math.abs(amount)
      continue
    }
    if (CHARGE.test(label) && label.length < 28) {
      chargeSum += amount
      continue
    }
    if (IGNORE.test(line)) continue
    if (amount === 0) continue

    // "2 x Iced Tea 5.00 10.00" -> name "Iced Tea x2", line total 10.00
    let name = label
    let qty = 1
    const q = name.match(/^(\d{1,2})\s*[xX@]?\s+(.*)$/)
    if (q && q[2]) {
      qty = parseInt(q[1], 10)
      name = q[2]
    }
    name = clean(name.replace(/\s+[xX]\s*\d{1,2}$/, ''))
    if (name.length < 2 || !/[A-Za-z一-鿿]/.test(name)) continue
    items.push({ name: qty > 1 ? `${name} x${qty}` : name, amount })
  }

  const r2 = (n: number) => Math.round(n * 100) / 100
  const itemsSum = r2(items.reduce((a, b) => a + b.amount, 0))
  let extras = r2(chargeSum)
  let mismatch = false
  if (total !== null) {
    const implied = r2(total - itemsSum)
    // the printed total is the most reliable source for the extras
    if (Math.abs(implied) <= itemsSum * 0.5) extras = implied
    mismatch = Math.abs(itemsSum + chargeSum - total) > 0.05
  } else if (Math.abs(extras) > itemsSum * 0.5) {
    extras = 0 // a charge that big is an OCR slip, not a real charge
  }
  return { items, extras, total, mismatch }
}
