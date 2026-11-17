import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Trip } from './Trips'
import Receipts from './Receipts'
import Balances from './Balances'

export type Member = { id: number; user_id: string | null; display_name: string }

export default function TripDetail({
  trip,
  userId,
  onBack,
}: {
  trip: Trip
  userId: string
  onBack: () => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [isCreator, setIsCreator] = useState(false)
  const [email, setEmail] = useState('')
  const [guestName, setGuestName] = useState('')
  const [message, setMessage] = useState('')
  const [version, setVersion] = useState(0)

  async function loadMembers() {
    const { data, error } = await supabase
      .from('trip_members')
      .select('id, user_id, display_name')
      .eq('trip_id', trip.id)
      .order('id')
    if (error) setMessage(error.message)
    else setMembers(data)
  }

  useEffect(() => {
    loadMembers()
  }, [trip.id])

  // the trip creator also approves payments made to guests (guests have no account)
  useEffect(() => {
    supabase
      .from('trips')
      .select('created_by')
      .eq('id', trip.id)
      .single()
      .then(({ data }) => setIsCreator(data?.created_by === userId))
  }, [trip.id, userId])

  async function addByEmail() {
    const { error } = await supabase.rpc('add_member_by_email', {
      t: trip.id,
      friend_email: email.trim(),
    })
    setMessage(error ? error.message : 'Friend added!')
    if (!error) {
      setEmail('')
      loadMembers()
    }
  }

  async function addGuest() {
    if (!guestName.trim()) return
    const { error } = await supabase
      .from('trip_members')
      .insert({ trip_id: trip.id, display_name: guestName.trim() })
    setMessage(error ? error.message : 'Guest added!')
    if (!error) {
      setGuestName('')
      loadMembers()
    }
  }

  return (
    <div>
      <button className="ghost" onClick={onBack}>
        ← Dashboard
      </button>
      <span className="eyebrow">Trip</span>
      <h1 className="trip-title">{trip.name}</h1>

      <div className="trip-cols">
        <div>
          <Balances
            tripId={trip.id}
            members={members}
            version={version}
            userId={userId}
            isCreator={isCreator}
          />
          <Receipts
            tripId={trip.id}
            members={members}
            onChange={() => setVersion((v) => v + 1)}
          />
        </div>

        <div>
          <div className="card">
            <h3>Members</h3>
            <ul>
              {members.map((m) => (
                <li key={m.id}>
                  {m.display_name} {m.user_id ? '' : '(guest)'}
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>Add a friend with an account</h3>
            <input
              type="email"
              placeholder="Friend's email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button onClick={addByEmail}>Add friend</button>

            <h3>Add a guest (no account)</h3>
            <input
              placeholder="Guest name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <button onClick={addGuest}>Add guest</button>
          </div>

          {message && <p className="muted">{message}</p>}
        </div>
      </div>
    </div>
  )
}
