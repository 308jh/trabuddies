import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Member } from './TripDetail'
import ItemizedForm from './ItemizedForm'

type Receipt = {
  id: number
  paid_by: number
  amount: number
  extras: number | null
  description: string | null
  splits: { owed_by: number; amount: number }[]
  receipt_items: {
    id: number
    name: string
    amount: number
    item_shares: { member_id: number }[]
  }[]
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
  const [mode, setMode] = useState<'equal' | 'items'>('equal')
  const [message, setMessage] = useState('')

  const nameOf = (id: number) => members.find((m) => m.id === id)?.display_name ?? 'Unknown'

  async function loadReceipts() {
    const { data, error } = await supabase
      .from('receipts')
      .select(
        'id, paid_by, amount, extras, description, splits(owed_by, amount), receipt_items(id, name, amount, item_shares(member_id))',
      )
      .eq('trip_id', tripId)
      .order('id', { ascending: false })
    if (error) setMessage(error.message)
    else setReceipts(data as Receipt[])
  }

  useEffect(() => {
    loadReceipts()
  }, [tripId])

  function toggle(id: number) {
    setSharedBy((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const everyone = members.length > 0 && sharedBy.length === members.length
  function toggleEveryone() {
    setSharedBy(everyone ? [] : members.map((m) => m.id))
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
    // receipts are the history: only delete one that was entered by mistake
    if (!window.confirm('Delete this receipt? Everyone’s balances will change.')) return
    const { error } = await supabase.from('receipts').delete().eq('id', id)
    if (error) setMessage(error.message)
    else {
      loadReceipts()
      onChange()
    }
  }

  return (
    <div className="card">
      <h3>Add a receipt</h3>
      <input
        placeholder="What was it for? (e.g. Dinner)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="seg">
        <button
          type="button"
          className={mode === 'equal' ? 'on' : ''}
          onClick={() => setMode('equal')}
        >
          Split equally
        </button>
        <button
          type="button"
          className={mode === 'items' ? 'on' : ''}
          onClick={() => setMode('items')}
        >
          Itemized
        </button>
      </div>
      {mode === 'equal' ? (
        <p className="muted small">
          Everyone who shares it pays the same. Good for tickets, hotels, buffets.
        </p>
      ) : (
        <p className="muted small">
          Add each dish or drink and tick who had it. Good for restaurants.
        </p>
      )}
      {mode === 'equal' && (
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      )}

      <span className="field-label">Paid by</span>
      <div className="pills">
        {members.map((m) => (
          <button
            type="button"
            key={m.id}
            className={`pill ${paidBy === m.id ? 'on' : ''}`}
            onClick={() => setPaidBy(m.id)}
          >
            {m.display_name}
          </button>
        ))}
      </div>

      {mode === 'equal' ? (
        <>
          <span className="field-label">Shared by</span>
          <div className="pills">
            <button
              type="button"
              className={`pill ${everyone ? 'on' : ''}`}
              onClick={toggleEveryone}
            >
              Everyone
            </button>
            {members.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`pill ${sharedBy.includes(m.id) ? 'on' : ''}`}
                onClick={() => toggle(m.id)}
              >
                {m.display_name}
              </button>
            ))}
          </div>
          <button onClick={addReceipt}>Save receipt</button>
        </>
      ) : (
        <ItemizedForm
          tripId={tripId}
          members={members}
          description={description}
          paidBy={paidBy}
          onSaved={() => {
            setDescription('')
            setPaidBy('')
            setMessage('')
            loadReceipts()
            onChange()
          }}
        />
      )}
      {message && <p className="muted">{message}</p>}

      <h3>Receipts</h3>
      {receipts.length === 0 ? (
        <p className="muted">No receipts yet.</p>
      ) : (
        <ul>
          {receipts.map((r) => (
            <li key={r.id} className="receipt">
              <div className="line">
                <div>
                  <strong>{r.description ?? 'Receipt'}</strong>
                  <span className="eyebrow">paid by {nameOf(r.paid_by)}</span>
                </div>
                <span className="amount">{r.amount.toFixed(2)}</span>
              </div>
              {r.receipt_items?.length > 0 && (
                <details className="items">
                  <summary>
                    {r.receipt_items.length} item{r.receipt_items.length > 1 ? 's' : ''}
                  </summary>
                  <ul>
                    {r.receipt_items.map((it) => (
                      <li key={it.id}>
                        <span>
                          {it.name}
                          <span className="eyebrow">
                            {it.item_shares.map((x) => nameOf(x.member_id)).join(', ')}
                          </span>
                        </span>
                        <span className="amount">{it.amount.toFixed(2)}</span>
                      </li>
                    ))}
                    {Number(r.extras) !== 0 && (
                      <li>
                        <span>
                          {Number(r.extras) > 0 ? 'Service charge, tax' : 'Discount, rounding'}
                          <span className="eyebrow">shared by order</span>
                        </span>
                        <span className="amount">{Number(r.extras).toFixed(2)}</span>
                      </li>
                    )}
                  </ul>
                </details>
              )}
              <div className="chips">
                {r.splits.map((s, i) => (
                  <span key={i} className="chip">
                    {nameOf(s.owed_by)} {s.amount.toFixed(2)}
                  </span>
                ))}
              </div>
              <div className="line-actions">
                <button className="act no" onClick={() => deleteReceipt(r.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
