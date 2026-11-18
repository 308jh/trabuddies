// Money maths for itemized receipts. Everything is in integer cents so the
// shares always add up to the exact total.

export type SplitItem = { cents: number; memberIds: number[] }

// Share `total` cents across weights, biggest remainders get the spare cents.
// Handles negative totals (discounts) by allocating the absolute value.
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const sign = total < 0 ? -1 : 1
  const t = Math.abs(total)
  const w = weights.map((x) => Math.max(0, x))
  let sum = w.reduce((a, b) => a + b, 0)
  const ws = sum > 0 ? w : w.map(() => 1)
  if (sum <= 0) sum = n
  const raw = ws.map((x) => (t * x) / sum)
  const out = raw.map(Math.floor)
  let left = t - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i] += 1
  return out.map((x) => sign * x)
}

// Who owes what: each item is divided between the people who shared it, then the
// extras (service charge, tax, rounding, discount) are shared in proportion to
// what each person ordered.
export function splitItemized(
  items: SplitItem[],
  extrasCents: number,
): { subtotals: Map<number, number>; totals: Map<number, number>; total: number } {
  const subtotals = new Map<number, number>()
  for (const it of items) {
    const ids = [...new Set(it.memberIds)]
    allocate(
      it.cents,
      ids.map(() => 1),
    ).forEach((c, i) => subtotals.set(ids[i], (subtotals.get(ids[i]) ?? 0) + c))
  }
  const people = [...subtotals.keys()]
  const extraShares = allocate(
    extrasCents,
    people.map((p) => subtotals.get(p) ?? 0),
  )
  const totals = new Map<number, number>()
  people.forEach((p, i) => totals.set(p, (subtotals.get(p) ?? 0) + extraShares[i]))
  const total = [...totals.values()].reduce((a, b) => a + b, 0)
  return { subtotals, totals, total }
}

export const toCents = (s: string | number) => {
  const n = typeof s === 'number' ? s : parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
export const fmt = (cents: number) => (cents / 100).toFixed(2)
