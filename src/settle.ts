export type ReceiptData = {
  paid_by: number
  amount: number
  splits: { owed_by: number; amount: number }[]
}

// a repayment between two people ("Ali paid jinhao 30.00")
export type PaymentData = {
  from_member: number
  to_member: number
  amount: number
  status: string
}

export type Payment = { from: number; to: number; amount: number } // amount in cents

const toCents = (n: number) => Math.round(n * 100)

// net position per member, in cents:
// (what they paid for others - what they owe) + repayments that were APPROVED
export function computeNet(
  receipts: ReceiptData[],
  payments: PaymentData[] = []
): Map<number, number> {
  const net = new Map<number, number>()
  const add = (id: number, cents: number) => net.set(id, (net.get(id) ?? 0) + cents)

  for (const r of receipts) {
    add(r.paid_by, toCents(r.amount))
    for (const s of r.splits) add(s.owed_by, -toCents(s.amount))
  }

  // a repayment lowers what the payer owes and what the receiver is owed
  for (const p of payments) {
    if (p.status !== 'confirmed') continue
    add(p.from_member, toCents(p.amount))
    add(p.to_member, -toCents(p.amount))
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
