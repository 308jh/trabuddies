import { useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Member } from './TripDetail'
import { fmt, splitItemized, toCents } from './split'
import { scanReceipt } from './scanReceipt'

type Row = { key: number; name: string; amount: string; who: number[] }

let nextKey = 1
const blank = (): Row => ({ key: nextKey++, name: '', amount: '', who: [] })

export default function ItemizedForm({
  tripId,
  members,
  description,
  paidBy,
  onSaved,
}: {
  tripId: number
  members: Member[]
  description: string
  paidBy: number | ''
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[]>([blank()])
  const [extras, setExtras] = useState('')
  const [message, setMessage] = useState('')
  const [scanning, setScanning] = useState<{ text: string; fraction: number } | null>(null)
  const [scanNote, setScanNote] = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const nameOf = (id: number) => members.find((m) => m.id === id)?.display_name ?? '?'

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  function toggle(key: number, id: number) {
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? { ...r, who: r.who.includes(id) ? r.who.filter((x) => x !== id) : [...r.who, id] }
          : r,
      ),
    )
  }
  const everyone = (r: Row) => members.length > 0 && r.who.length === members.length

  // ----- live result -----
  const calc = useMemo(() => {
    const ready = rows.filter((r) => r.name.trim() && toCents(r.amount) !== 0 && r.who.length > 0)
    const extrasCents = toCents(extras)
    const res = splitItemized(
      ready.map((r) => ({ cents: toCents(r.amount), memberIds: r.who })),
      extrasCents,
    )
    return { ready, extrasCents, ...res }
  }, [rows, extras])

  const incomplete = rows.filter(
    (r) =>
      (r.name.trim() || r.amount.trim()) &&
      !(r.name.trim() && toCents(r.amount) !== 0 && r.who.length > 0),
  ).length
  const negative = [...calc.totals.values()].some((c) => c < 0)

  async function onFile(file: File | undefined) {
    if (!file) return
    setMessage('')
    setScanNote('')
    setScanning({ text: 'Preparing the photo…', fraction: 0.02 })
    try {
      const r = await scanReceipt(file, (text, fraction) => setScanning({ text, fraction }))
      if (r.items.length === 0) {
        setScanNote('Could not find any items. Try a flatter, brighter photo, or type them in.')
      } else {
        setRows(
          r.items.map((it) => ({
            key: nextKey++,
            name: it.name,
            amount: it.amount.toFixed(2),
            who: [],
          })),
        )
        setExtras(r.extras ? r.extras.toFixed(2) : '')
        setScanNote(
          `Found ${r.items.length} items${r.total !== null ? ` and a total of ${r.total.toFixed(2)}` : ''}. ` +
            (r.mismatch
              ? 'The numbers do not quite add up to the printed total, so something was misread. Please check every line. '
              : 'Please check every line against your receipt. ') +
            'Then tick who had each item.',
        )
      }
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : 'Could not read that photo.')
    } finally {
      setScanning(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    if (paidBy === '') return setMessage('Choose who paid.')
    if (incomplete > 0)
      return setMessage('Some items are missing a name, an amount, or who had it.')
    if (calc.ready.length === 0) return setMessage('Add at least one item.')
    if (negative)
      return setMessage('A discount is bigger than what one person ordered. Change the charges.')
    if (calc.total <= 0) return setMessage('The total must be more than 0.')

    setSaving(true)
    const { error } = await supabase.rpc('add_itemized_receipt', {
      t: tripId,
      paid: paidBy,
      descr: description.trim() || null,
      extra: calc.extrasCents / 100,
      items: calc.ready.map((r) => ({
        name: r.name.trim(),
        amount: toCents(r.amount) / 100,
        member_ids: r.who,
      })),
      shares: [...calc.totals.entries()].map(([member_id, c]) => ({ member_id, amount: c / 100 })),
    })
    setSaving(false)
    if (error) return setMessage(error.message)

    setRows([blank()])
    setExtras('')
    setScanNote('')
    setMessage('Receipt added!')
    onSaved()
  }

  return (
    <>
      <div className="scan-box">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          className="scan-btn"
          disabled={!!scanning}
          onClick={() => fileRef.current?.click()}
        >
          {scanning ? 'Scanning…' : 'Scan a receipt'}
        </button>
        <span className="muted">
          Take a photo or choose one. It is read on your device and never uploaded.
        </span>
        {scanning && (
          <div className="progress">
            <div className="bar" style={{ width: `${Math.round(scanning.fraction * 100)}%` }} />
            <span>{scanning.text}</span>
          </div>
        )}
        {scanNote && <p className="warn">{scanNote}</p>}
      </div>

      <span className="field-label">Items</span>
      <ul className="item-rows">
        {rows.map((r) => (
          <li key={r.key} className="item-row">
            <div className="item-top">
              <input
                placeholder="Item (e.g. Chicken chop)"
                value={r.name}
                onChange={(e) => update(r.key, { name: e.target.value })}
              />
              <input
                className="item-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                value={r.amount}
                onChange={(e) => update(r.key, { amount: e.target.value })}
              />
              <button
                type="button"
                className="item-x"
                aria-label="Remove item"
                onClick={() =>
                  setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))
                }
              >
                ×
              </button>
            </div>
            <div className="pills small">
              <button
                type="button"
                className={`pill ${everyone(r) ? 'on' : ''}`}
                onClick={() => update(r.key, { who: everyone(r) ? [] : members.map((m) => m.id) })}
              >
                All
              </button>
              {members.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`pill ${r.who.includes(m.id) ? 'on' : ''}`}
                  onClick={() => toggle(r.key, m.id)}
                >
                  {m.display_name}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="ghost" onClick={() => setRows((rs) => [...rs, blank()])}>
        + Add item
      </button>

      <span className="field-label">Service charge, tax, rounding</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder="Total of all extra charges (negative for a discount)"
        value={extras}
        onChange={(e) => setExtras(e.target.value)}
      />
      <p className="muted small">Shared in proportion to what each person ordered.</p>

      {calc.ready.length > 0 && (
        <div className="summary">
          <span className="field-label">Who pays what</span>
          {[...calc.totals.entries()].map(([id, c]) => {
            const sub = calc.subtotals.get(id) ?? 0
            return (
              <div key={id} className="line">
                <span>
                  {nameOf(id)}
                  {c !== sub && <span className="eyebrow"> items {fmt(sub)}</span>}
                </span>
                <span className="amount">{fmt(c)}</span>
              </div>
            )
          })}
          <div className="line total">
            <span>Total</span>
            <span className="amount">{fmt(calc.total)}</span>
          </div>
        </div>
      )}

      {incomplete > 0 && (
        <p className="warn">
          {incomplete} item{incomplete > 1 ? 's' : ''} still need a name, an amount and at least one
          person.
        </p>
      )}
      <button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save receipt'}
      </button>
      {message && <p className="muted">{message}</p>}
    </>
  )
}
