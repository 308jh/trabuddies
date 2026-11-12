import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Member } from './TripDetail'
import { computeNet, settleUp, type ReceiptData } from './settle'

const money = (cents: number) => (cents / 100).toFixed(2)

export default function Balances({
  tripId,
  members,
  version,
}: {
  tripId: number
  members: Member[]
  version: number
}) {
  const [net, setNet] = useState<Map<number, number>>(new Map())
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('receipts')
      .select('paid_by, amount, splits(owed_by, amount)')
      .eq('trip_id', tripId)
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setNet(computeNet(data as ReceiptData[]))
      })
  }, [tripId, version])

  const nameOf = (id: number) =>
    members.find((m) => m.id === id)?.display_name ?? 'Unknown'
  const payments = settleUp(net)

  return (
    <div>
      <h3>Balances</h3>
      {error && <p>{error}</p>}
      <ul>
        {members.map((m) => {
          const v = net.get(m.id) ?? 0
          return (
            <li key={m.id}>
              {m.display_name}:{' '}
              {v > 0 ? `gets back ${money(v)}` : v < 0 ? `owes ${money(-v)}` : 'all settled'}
            </li>
          )
        })}
      </ul>

      <h3>Who pays whom</h3>
      {payments.length === 0 ? (
        <p>Nobody owes anything.</p>
      ) : (
        <ul>
          {payments.map((p, i) => (
            <li key={i}>
              {nameOf(p.from)} pays {nameOf(p.to)} {money(p.amount)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}