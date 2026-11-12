export type ReceiptData = {
  paid_by: number
  amount: number
  splits: { owed_by: number; amount: number }[]
}

export type Payment = { from: number; to: number; amount: number } // amount in cents

const toCents = (n: number) => Math.round(n * 100)

// net position per member, in cents: paid minus owed
export function computeNet(receipts: ReceiptData[]): Map<number, number> {
  const net = new Map<number, number>()
  const add = (id: number, cents: number) => net.set(id, (net.get(id) ?? 0) + cents)

  for (const r of receipts) {
    add(r.paid_by, toCents(r.amount))
    for (const s of r.splits) add(s.owed_by, -toCents(s.amount))
  }
  return net
}

// match the biggest debtor with the biggest creditor until everyone is square
export function settleUp(net: Map<number, number>): Payment[] {
  const creditors = [...net]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }))
    .sort((a, b) => b.v - a.v)
  const debtors = [...net]
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }))
    .sort((a, b) => b.v - a.v)

  const payments: Payment[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].v, creditors[j].v)
    payments.push({ from: debtors[i].id, to: creditors[j].id, amount })
    debtors[i].v -= amount
    creditors[j].v -= amount
    if (debtors[i].v === 0) i++
    if (creditors[j].v === 0) j++
  }
  return payments
}