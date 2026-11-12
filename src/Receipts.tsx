import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Member } from './TripDetail'

type Receipt = {
  id: number
  paid_by: number
  amount: number
  description: string | null
  splits: { owed_by: number; amount: number }[]
}

// Split in cents so the shares always add up to the exact total
function splitEqually(total: number, ids: number[]) {
  const cents = Math.round(total * 100)
  const base = Math.floor(cents / ids.length)
  const extra = cents - base * ids.length
  return ids.map((id, i) => ({
    owed_by: id,
    amount: (base + (i < extra ? 1 : 0)) / 100,
  }))
}

export default function Receipts({
  tripId,
  members,
  onChange,
}: {
  tripId: number
  members: Member[]
  onChange: () => void
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState<number | ''>('')
  const [sharedBy, setSharedBy] = useState<number[]>([])
  const [message, setMessage] = useState('')

  const nameOf = (id: number) =>
    members.find((m) => m.id === id)?.display_name ?? 'Unknown'

  async function loadReceipts() {
    const { data, error } = await supabase
      .from('receipts')
      .select('id, paid_by, amount, description, splits(owed_by, amount)')
      .eq('trip_id', tripId)
      .order('id', { ascending: false })
    if (error) setMessage(error.message)
    else setReceipts(data as Receipt[])
  }

  useEffect(() => {
    loadReceipts()
  }, [tripId])

  function toggle(id: number) {
    setSharedBy((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function addReceipt() {
    const total = parseFloat(amount)
    if (!total || total <= 0 || paidBy === '' || sharedBy.length === 0) {
      setMessage('Fill in the amount, who paid, and who shared it.')
      return
    }

    const { data: receipt, error } = await supabase
      .from('receipts')
      .insert({
        trip_id: tripId,
        paid_by: paidBy,
        amount: total,
        description: description.trim() || null,
      })
      .select('id')
      .single()

    if (error || !receipt) {
      setMessage(error?.message ?? 'Could not save the receipt.')
      return
    }

    const rows = splitEqually(total, sharedBy).map((s) => ({
      receipt_id: receipt.id,
      ...s,
    }))
    const { error: splitError } = await supabase.from('splits').insert(rows)

    if (splitError) {
      // undo the receipt so we never keep one without its splits
      await supabase.from('receipts').delete().eq('id', receipt.id)
      setMessage(splitError.message)
      return
    }

    setDescription('')
    setAmount('')
    setPaidBy('')
    setSharedBy([])
    setMessage('Receipt added!')
    loadReceipts()
    onChange()
  }

  async function deleteReceipt(id: number) {
    const { error } = await supabase.from('receipts').delete().eq('id', id)
    if (error) setMessage(error.message)
    else {
        loadReceipts() 
        onChange()
    }
  }

  return (
    <div>
      <h3>Add a receipt</h3>
      <input
        placeholder="What was it for? (e.g. Dinner)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <input
        type="number"
        step="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <div>
        <label>Paid by: </label>
        <select
          value={paidBy}
          onChange={(e) =>
            setPaidBy(e.target.value === '' ? '' : Number(e.target.value))
          }
        >
          <option value="">Choose...</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Shared by: </label>
        <button onClick={() => setSharedBy(members.map((m) => m.id))}>
          Everyone
        </button>
        {members.map((m) => (
          <label key={m.id} style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={sharedBy.includes(m.id)}
              onChange={() => toggle(m.id)}
            />
            {m.display_name}
          </label>
        ))}
      </div>

      <button onClick={addReceipt}>Save receipt</button>
      {message && <p>{message}</p>}

      <h3>Receipts</h3>
      <ul>
        {receipts.map((r) => (
          <li key={r.id}>
            {r.description ?? 'Receipt'}: {r.amount.toFixed(2)} paid by{' '}
            {nameOf(r.paid_by)}, shared by{' '}
            {r.splits.map((s) => `${nameOf(s.owed_by)} (${s.amount.toFixed(2)})`).join(', ')}{' '}
            <button onClick={() => deleteReceipt(r.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}