// Turns the text of a receipt (from OCR) into draft items and charges. It is a
// best guess: the app always shows the result for the user to check and fix.

export type ParsedReceipt = {
  items: { name: string; amount: number }[]
  subtotal: number | null // "Subtotal" printed on the receipt
  service: number | null // service charge / fee
  tax: number | null // service tax / SST / GST
  adjust: number // rounding and discounts (a discount is negative)
  total: number | null // the final total printed on the receipt
}

const PRICE = /(-?\(?\d{1,3}(?:,\d{3})+[.,]\s?\d{2}\)?|-?\d+[.,]\s?\d{2}\)?)(?!\d)/g

// OCR often drops or swaps a letter, so these are deliberately forgiving
const TOTAL_START = /^\W*(grand\s*|net+\s*)?\w{0,2}[o0]t[a4][l1i]\b/i
const SUBTOTAL = /sub\s*-?\s*t[o0]t|\bsubt/i
const TAX = /\b(sst|gst|vat|cukai|s?\.?tax|tax)\b|ser\w{0,3}\s*tax/i
const SERVICE =
  /\bs[ec][a-z1]{0,2}[iv1l]{1,2}[ce]{1,2}\b|\bsvc\b|\bs\.?\s?charge\b|\bservice\b|\bfee\b/i
const ROUNDING = /round|\badj/i
const DISCOUNT = /\b(discount|disc|promo|voucher|rebate|coupon)\b/i
const IGNORE =
  /\b(cash|change|tender\w*|paid|payment|visa|master\w*|card|qr|wallet|tng|grabpay|invoice|receipt|bill|table|tel|phone|date|time|cashier|server|pax|guest|reg|thank|id|order|status|customer|dine\s*in|take\s*away|lot|level|jalan|jln|lorong|sdn|bhd|kuala|bandar|pos)\b/i

const num = (s: string) => {
  let t = s.trim()
  const neg = t.startsWith('-') || (t.startsWith('(') && t.endsWith(')'))
  t = t.replace(/[()\-\s]/g, '')
  if (/,\d{2}$/.test(t) && !/\./.test(t)) t = t.replace(',', '.') // 12,50
  t = t.replace(/,(?=\d{3})/g, '')
  const v = parseFloat(t)
  return neg ? -v : v
}

const clean = (s: string) =>
  s
    .replace(/[|_~`]+/g, ' ')
    .replace(/^[\s.\-*#:=@]+|[\s.\-*#:=@]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

const r2 = (n: number) => Math.round(n * 100) / 100

export function parseReceipt(text: string): ParsedReceipt {
  const items: ParsedReceipt['items'] = []
  let subtotal: number | null = null
  let service: number | null = null
  let tax: number | null = null
  let adjust = 0
  let total: number | null = null
  let last = -1 // index of the item just read, so a wrapped name can be joined

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const prices = [...line.matchAll(PRICE)]

    if (prices.length === 0) {
      // "CHICKEN" on its own line right under "2 STD NASI LEMAK-CURRY 47.80"
      if (
        last >= 0 &&
        /^[A-Za-z][A-Za-z '&()/-]{1,30}$/.test(line) &&
        !IGNORE.test(line) &&
        !TOTAL_START.test(line)
      ) {
        items[last].name += ' ' + clean(line)
      } else if (!/[A-Za-z]/.test(line)) last = -1 // a dashed line ends the item list
      continue
    }

    const m = prices[prices.length - 1]
    const amount = num(m[0])
    if (!Number.isFinite(amount)) continue
    // an amount sits at the END of its line (not in the middle of an address)
    if (line.length - (m.index! + m[0].length) > 3) continue
    const label = clean(line.slice(0, prices[0].index))

    if (SUBTOTAL.test(label)) {
      subtotal = amount
      last = -1
      continue
    }
    if (TOTAL_START.test(label)) {
      total = amount
      last = -1
      continue
    }
    if (TAX.test(label)) {
      tax = r2((tax ?? 0) + amount)
      last = -1
      continue
    }
    if (SERVICE.test(label) && label.length < 30) {
      service = r2((service ?? 0) + amount)
      last = -1
      continue
    }
    if (ROUNDING.test(label)) {
      adjust = r2(adjust + amount)
      last = -1
      continue
    }
    if (DISCOUNT.test(label) && !/^\d/.test(label)) {
      adjust = r2(adjust - Math.abs(amount))
      last = -1
      continue
    }
    if (total !== null) continue // payment lines after the total are not items
    if (IGNORE.test(label) || amount === 0) {
      last = -1
      continue
    }

    // "2 STD NASI LEMAK 47.80" -> name "STD NASI LEMAK x2", line total 47.80
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
    last = items.length - 1
  }

  return { items, subtotal, service, tax, adjust, total }
}
