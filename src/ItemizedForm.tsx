import { useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Member } from './TripDetail'
import { fmt, splitItemized, toCents } from './split'
import { scanReceipt } from './scanReceipt'
import StepHead from './Step'

type Row = { key: number; name: string; amount: string; who: number[] }
// rate is a percentage of the subtotal; "manual" is an exact amount typed or scanned from the receipt
type Charge = { on: boolean; rate: string; manual: string | null }

let nextKey = 1
const blank = (): Row => ({ key: nextKey++, name: '', amount: '', who: [] })

export default function ItemizedForm({
  tripId,
  members,
  description,
  paidBy,
  onNeedPayer,
  onSaved,
}: {
  tripId: number
  members: Member[]
  description: string
  paidBy: number | ''
  onNeedPayer: () => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[]>([blank()])
  const [service, setService] = useState<Charge>({ on: false, rate: '10', manual: null })
  const [tax, setTax] = useState<Charge>({ on: false, rate: '6', manual: null })
  const [adjust, setAdjust] = useState('')
  const [printedSub, setPrintedSub] = useState('')
  const [printedTotal, setPrintedTotal] = useState('')
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
    const subCents = rows.reduce((s, r) => s + toCents(r.amount), 0)
    const chargeCents = (c: Charge) =>
      !c.on
        ? 0
        : c.manual !== null
          ? toCents(c.manual)
          : Math.round((subCents * (parseFloat(c.rate) || 0)) / 100)
    const serviceCents = chargeCents(service)
    const taxCents = chargeCents(tax)
    const adjustCents = toCents(adjust)
    const extrasCents = serviceCents + taxCents + adjustCents
    const ready = rows.filter((r) => r.name.trim() && toCents(r.amount) !== 0 && r.who.length > 0)
    const res = splitItemized(
      ready.map((r) => ({ cents: toCents(r.amount), memberIds: r.who })),
      extrasCents,
    )
    return { subCents, serviceCents, taxCents, adjustCents, extrasCents, ready, ...res }
  }, [rows, service, tax, adjust])

  const grand = calc.subCents + calc.extrasCents
  const incomplete = rows.filter(
    (r) =>
      (r.name.trim() || r.amount.trim()) &&
      !(r.name.trim() && toCents(r.amount) !== 0 && r.who.length > 0),
  ).length
  const negative = [...calc.totals.values()].some((c) => c < 0)

  function applyScanCharge(amount: number | null, sub: number, base: Charge): Charge {
    if (amount === null) return { ...base, on: false, manual: null }
    const rate = sub > 0 ? String(Math.round((amount / sub) * 1000) / 10) : base.rate
    return { on: true, rate, manual: amount.toFixed(2) }
  }

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
        const sub = r.items.reduce((s, i) => s + i.amount, 0)
        setRows(
          r.items.map((it) => ({
            key: nextKey++,
            name: it.name,
            amount: it.amount.toFixed(2),
            who: [],
          })),
        )
        setService((c) => applyScanCharge(r.service, sub, c))
        setTax((c) => applyScanCharge(r.tax, sub, c))
        setAdjust(r.adjust ? r.adjust.toFixed(2) : '')
        setPrintedSub(r.subtotal !== null ? r.subtotal.toFixed(2) : '')
        setPrintedTotal(r.total !== null ? r.total.toFixed(2) : '')
        setScanNote(
          `Found ${r.items.length} item${r.items.length > 1 ? 's' : ''}. Compare every line with your receipt, add anything that is missing, then tick who had each item.`,
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
    setMessage('')
    if (paidBy === '') {
      onNeedPayer()
      return setMessage('Please choose who paid the bill (step 2).')
    }
    if (incomplete > 0)
      return setMessage('Some items are missing a name, an amount, or who had it (step 3).')
    if (calc.ready.length === 0) return setMessage('Add at least one item (step 3).')
    if (negative)
      return setMessage('A discount is bigger than what one person ordered. Check step 4.')
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
    setService({ on: false, rate: '10', manual: null })
    setTax({ on: false, rate: '6', manual: null })
    setAdjust('')
    setPrintedSub('')
    setPrintedTotal('')
    setScanNote('')
    setMessage('Receipt added!')
    onSaved()
  }

  // ✓ / ⚠ next to a number copied from the paper receipt
  const check = (printed: string, mine: number, what: string) => {
    if (!printed.trim()) return null
    const diff = toCents(printed) - mine
    return diff === 0 ? (
      <span className="ok-note">✓ matches your receipt</span>
    ) : (
      <span className="bad-note">
        Receipt says {fmt(toCents(printed))} but you have {fmt(mine)} ({what})
      </span>
    )
  }

  function chargeRow(label: string, c: Charge, set: (c: Charge) => void, cents: number) {
    return (
      <div className={`charge ${c.on ? 'on' : ''}`}>
        <button
          type="button"
          className={`pill ${c.on ? 'on' : ''}`}
          onClick={() => set({ ...c, on: !c.on })}
        >
          {c.on ? '✓ ' : '+ '}
          {label}
        </button>
        {c.on && (
          <div className="charge-fields">
            <input
              className="rate"
              type="number"
              inputMode="decimal"
              step="0.1"
              aria-label={`${label} percent`}
              value={c.rate}
              onChange={(e) => set({ ...c, rate: e.target.value, manual: null })}
            />
            <span>%</span>
            <span className="eq">=</span>
            <input
              className="item-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              aria-label={`${label} amount`}
              value={c.manual ?? (cents / 100).toFixed(2)}
              onChange={(e) => set({ ...c, manual: e.target.value })}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="step">
        <StepHead
          n={3}
          title="Items on the receipt"
          hint="Scan the receipt or type each dish and drink, then tap who had it."
          required
        />
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
              <span className="who-label">Who had this?</span>
              <div className="pills small">
                <button
                  type="button"
                  className={`pill ${everyone(r) ? 'on' : ''}`}
                  onClick={() =>
                    update(r.key, { who: everyone(r) ? [] : members.map((m) => m.id) })
                  }
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

        <div className="line subtotal">
          <span>Subtotal</span>
          <span className="amount">{fmt(calc.subCents)}</span>
        </div>
        {check(printedSub, calc.subCents, 'an item may be missing or misread')}
      </div>

      <div className="step">
        <StepHead
          n={4}
          title="Service charge and tax"
          hint="Turn on only the ones printed on your receipt. They are calculated from the subtotal, or type the exact amount."
        />
        {chargeRow('Service charge', service, setService, calc.serviceCents)}
        {chargeRow('Service tax (SST)', tax, setTax, calc.taxCents)}
        <div className="charge on">
          <span className="charge-label">Rounding / discount</span>
          <div className="charge-fields">
            <input
              className="item-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0.00"
              aria-label="Rounding or discount"
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
            />
          </div>
        </div>
        <p className="muted small">
          Use a minus sign for a discount, like -5.00. These are shared in proportion to what each
          person ordered.
        </p>

        <div className="line grand">
          <span>Total</span>
          <span className="amount">{fmt(grand)}</span>
        </div>
        <label className="printed">
          <span>Total printed on the receipt (optional, to double-check)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="e.g. 93.60"
            value={printedTotal}
            onChange={(e) => setPrintedTotal(e.target.value)}
          />
        </label>
        {check(printedTotal, grand, 'check the items and charges above')}
        {printedTotal.trim() &&
          toCents(printedTotal) !== grand &&
          Math.abs(toCents(printedTotal) - grand) <= 100 && (
            <button
              type="button"
              className="ghost"
              onClick={() =>
                setAdjust(((calc.adjustCents + toCents(printedTotal) - grand) / 100).toFixed(2))
              }
            >
              Put the {fmt(Math.abs(toCents(printedTotal) - grand))} difference into rounding
            </button>
          )}
      </div>

      {calc.ready.length > 0 && (
        <div className="summary">
          <StepHead n={5} title="Who pays what" hint="Check this, then save." />
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
      {message && <p className={message === 'Receipt added!' ? 'ok-note' : 'warn'}>{message}</p>}
    </>
  )
}
