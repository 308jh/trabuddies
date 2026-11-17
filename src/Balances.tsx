import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Member } from './TripDetail'
import { computeNet, settleUp, type PaymentData, type ReceiptData } from './settle'

type PaymentRow = PaymentData & { id: number; created_by: string }

const money = (cents: number) => (cents / 100).toFixed(2)
const cents = (n: number) => Math.round(n * 100)

export default function Balances({
  tripId,
  members,
  version,
  userId,
  isCreator,
}: {
  tripId: number
  members: Member[]
  version: number
  userId: string
  isCreator: boolean
}) {
  const [receipts, setReceipts] = useState<ReceiptData[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [rec, pay] = await Promise.all([
      supabase
        .from('receipts')
        .select('paid_by, amount, splits(owed_by, amount)')
        .eq('trip_id', tripId),
      supabase
        .from('payments')
        .select('id, from_member, to_member, amount, status, created_by')
        .eq('trip_id', tripId)
        .in('status', ['pending', 'confirmed'])
        .order('id', { ascending: false }),
    ])
    if (rec.error) setError(rec.error.message)
    else if (pay.error) setError(pay.error.message)
    else {
      setReceipts(rec.data as ReceiptData[])
      setPayments(pay.data as PaymentRow[])
      setError('')
    }
  }, [tripId])

  useEffect(() => {
    load()
  }, [load, version])

  // the database decides who is allowed to do what; these are just the buttons
  async function call(fn: 'record_payment' | 'decide_payment' | 'remove_payment', args: object) {
    const { error } = await supabase.rpc(fn, args)
    if (error) setError(error.message)
    else {
      setError('')
      await load()
    }
  }

  const seat = (id: number) => members.find((m) => m.id === id)
  const nameOf = (id: number) => seat(id)?.display_name ?? 'Unknown'
  // you can approve a payment to yourself; for a guest (no account) the trip creator approves
  const canApprove = (toId: number) => {
    const s = seat(toId)
    return !!s && (s.user_id === userId || (s.user_id === null && isCreator))
  }

  const net = computeNet(receipts, payments)
  const suggestions = settleUp(net)
  const pending = payments.filter((p) => p.status === 'pending')
  const confirmed = payments.filter((p) => p.status === 'confirmed')

  return (
    <div className="card">
      <h3>Balances</h3>
      {error && <p className="muted">{error}</p>}
      <ul>
        {members.map((m) => {
          const v = net.get(m.id) ?? 0
          return (
            <li key={m.id} className={v > 0 ? 'pos' : v < 0 ? 'neg' : ''}>
              <div className="line">
                <span>{m.display_name}</span>
                <span className="amount">
                  {v > 0 ? `gets back ${money(v)}` : v < 0 ? `owes ${money(-v)}` : 'settled'}
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      <h3>Who pays whom</h3>
      {suggestions.length === 0 ? (
        <p className="muted">Everyone is square. Nothing to pay.</p>
      ) : (
        <ul>
          {suggestions.map((s, i) => {
            const waiting = pending.some(
              (p) => p.from_member === s.from && p.to_member === s.to
            )
            let action = null
            if (waiting) {
              action = <span className="chip">waiting for approval</span>
            } else if (canApprove(s.to)) {
              action = (
                <button
                  className="act ok"
                  onClick={() =>
                    call('record_payment', {
                      t: tripId,
                      from_m: s.from,
                      to_m: s.to,
                      amt: s.amount / 100,
                    })
                  }
                >
                  Mark received
                </button>
              )
            } else if (seat(s.from)?.user_id === userId) {
              action = (
                <button
                  className="act"
                  onClick={() =>
                    call('record_payment', {
                      t: tripId,
                      from_m: s.from,
                      to_m: s.to,
                      amt: s.amount / 100,
                    })
                  }
                >
                  I paid
                </button>
              )
            }
            return (
              <li key={i}>
                <div className="line">
                  <span>
                    {nameOf(s.from)} pays {nameOf(s.to)}
                  </span>
                  <span className="amount">{money(s.amount)}</span>
                </div>
                {action && <div className="line-actions">{action}</div>}
              </li>
            )
          })}
        </ul>
      )}

      {pending.length > 0 && (
        <>
          <h3>Waiting for approval</h3>
          <ul>
            {pending.map((p) => (
              <li key={p.id}>
                <div className="line">
                  <span>
                    {nameOf(p.from_member)} says they paid {nameOf(p.to_member)}
                  </span>
                  <span className="amount">{money(cents(p.amount))}</span>
                </div>
                <div className="line-actions">
                  {canApprove(p.to_member) ? (
                    <>
                      <button
                        className="act ok"
                        onClick={() => call('decide_payment', { p: p.id, approve: true })}
                      >
                        Approve
                      </button>
                      <button
                        className="act no"
                        onClick={() => call('decide_payment', { p: p.id, approve: false })}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="chip">waiting for {nameOf(p.to_member)}</span>
                      {p.created_by === userId && (
                        <button
                          className="act no"
                          onClick={() => call('remove_payment', { p: p.id })}
                        >
                          Cancel
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {confirmed.length > 0 && (
        <>
          <h3>Paid back</h3>
          <ul>
            {confirmed.map((p) => (
              <li key={p.id}>
                <div className="line">
                  <span>
                    {nameOf(p.from_member)} paid {nameOf(p.to_member)}
                  </span>
                  <span className="amount">{money(cents(p.amount))}</span>
                </div>
                {canApprove(p.to_member) && (
                  <div className="line-actions">
                    <button
                      className="act no"
                      onClick={() => {
                        if (window.confirm('Undo this payment? That money will count as unpaid again.')) {
                          call('remove_payment', { p: p.id })
                        }
                      }}
                    >
                      Undo
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
