import { useCallback, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import type { Trip } from './Trips'
import { computeNet, settleUp } from './settle'

type Member = { id: number; user_id: string | null; display_name: string }
type ReceiptRow = {
  id: number
  paid_by: number
  amount: number
  description: string | null
  splits: { owed_by: number; amount: number }[]
}
type TripRow = {
  id: number
  name: string
  created_at: string
  trip_members: Member[]
  receipts: ReceiptRow[]
}

const toCents = (n: number) => Math.round(n * 100)
const money = (cents: number) => (cents / 100).toFixed(2)

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="card stat">
      <span className="eyebrow">{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  )
}

export default function Dashboard({
  session,
  onOpen,
}: {
  session: Session
  onOpen: (t: Trip) => void
}) {
  const [rows, setRows] = useState<TripRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const myId = session.user.id
  const firstName = (session.user.email ?? 'you').split('@')[0]

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('trips')
      .select(
        'id, name, created_at, trip_members(id, user_id, display_name), receipts(id, paid_by, amount, description, splits(owed_by, amount))'
      )
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setRows((data ?? []) as unknown as TripRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // everything below is calculated from the trips, in cents
  const view = useMemo(() => {
    let spent = 0
    let owed = 0
    let owe = 0
    const payments: { key: string; text: string; amount: number; trip: string; get: boolean }[] = []
    const recent: { id: number; trip: string; title: string; who: string; amount: number }[] = []

    const cards = rows.map((t) => {
      const me = t.trip_members.find((m) => m.user_id === myId)
      const nameOf = (id: number) =>
        t.trip_members.find((m) => m.id === id)?.display_name ?? 'Unknown'

      const total = t.receipts.reduce((s, r) => s + toCents(r.amount), 0)
      const net = computeNet(t.receipts)
      const mine = me ? (net.get(me.id) ?? 0) : 0

      spent += total
      if (mine > 0) owed += mine
      if (mine < 0) owe += -mine

      if (me) {
        settleUp(net).forEach((p, i) => {
          if (p.from === me.id) {
            payments.push({
              key: `${t.id}-${i}`,
              text: `You pay ${nameOf(p.to)}`,
              amount: p.amount,
              trip: t.name,
              get: false,
            })
          } else if (p.to === me.id) {
            payments.push({
              key: `${t.id}-${i}`,
              text: `${nameOf(p.from)} pays you`,
              amount: p.amount,
              trip: t.name,
              get: true,
            })
          }
        })
      }

      for (const r of t.receipts) {
        recent.push({
          id: r.id,
          trip: t.name,
          title: r.description ?? 'Receipt',
          who: nameOf(r.paid_by),
          amount: toCents(r.amount),
        })
      }

      return { trip: t, members: t.trip_members.length, receipts: t.receipts.length, total, mine }
    })

    recent.sort((a, b) => b.id - a.id)
    return { cards, spent, owed, owe, payments, recent: recent.slice(0, 6) }
  }, [rows, myId])

  async function createTrip() {
    if (!name.trim()) return
    const { error } = await supabase.from('trips').insert({ name: name.trim() })
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    setError('')
    load()
  }

  function open(t: TripRow) {
    onOpen({ id: t.id, name: t.name, created_at: t.created_at })
  }
  function onKey(e: KeyboardEvent, t: TripRow) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open(t)
    }
  }

  return (
    <div className="dash">
      <section className="hero">
        <span className="eyebrow">Dashboard — {firstName}</span>
        <h1>
          YOUR
          <br />
          TRIPS
        </h1>
      </section>

      <section className="stats">
        <Stat label="Trips" value={String(rows.length)} />
        <Stat label="Total spent" value={money(view.spent)} />
        <Stat label="You are owed" value={money(view.owed)} tone="pos" />
        <Stat label="You owe" value={money(view.owe)} tone="neg" />
      </section>

      {error && <p className="muted">{error}</p>}

      <div className="dash-grid">
        <div>
          <h3>Your trips</h3>
          {loading ? (
            <p className="muted">Loading trips...</p>
          ) : (
            <div className="trip-grid">
              {view.cards.map((c) => (
                <div
                  key={c.trip.id}
                  className="card trip-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => open(c.trip)}
                  onKeyDown={(e) => onKey(e, c.trip)}
                >
                  <span className="go">→</span>
                  <span className="eyebrow">
                    {c.members} {c.members === 1 ? 'member' : 'members'} · {c.receipts}{' '}
                    {c.receipts === 1 ? 'receipt' : 'receipts'}
                  </span>
                  <h2>{c.trip.name}</h2>
                  <div className="trip-meta">
                    <span className="muted">{money(c.total)} spent</span>
                    <span className={`chip ${c.mine > 0 ? 'pos' : c.mine < 0 ? 'neg' : ''}`}>
                      {c.mine > 0
                        ? `gets back ${money(c.mine)}`
                        : c.mine < 0
                          ? `owes ${money(-c.mine)}`
                          : c.total === 0
                            ? 'no receipts'
                            : 'settled'}
                    </span>
                  </div>
                </div>
              ))}

              <div className="card new-trip">
                <span className="eyebrow">New trip</span>
                <input
                  placeholder="Where are you going?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createTrip()}
                />
                <button onClick={createTrip}>Create trip</button>
              </div>
            </div>
          )}
        </div>

        <aside className="dash-side">
          <div className="card">
            <h3>To settle</h3>
            {view.payments.length === 0 ? (
              <p className="muted">Nothing to settle. Everyone is square.</p>
            ) : (
              <ul>
                {view.payments.map((p) => (
                  <li key={p.key}>
                    <div className="row-line">
                      <span>{p.text}</span>
                      <span className={p.get ? 'pos-text' : 'neg-text'}>{money(p.amount)}</span>
                    </div>
                    <span className="eyebrow">{p.trip}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h3>Recent receipts</h3>
            {view.recent.length === 0 ? (
              <p className="muted">No receipts yet. Open a trip to add one.</p>
            ) : (
              <ul>
                {view.recent.map((r) => (
                  <li key={r.id}>
                    <div className="row-line">
                      <span>{r.title}</span>
                      <span>{money(r.amount)}</span>
                    </div>
                    <span className="eyebrow">
                      {r.trip} · paid by {r.who}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
