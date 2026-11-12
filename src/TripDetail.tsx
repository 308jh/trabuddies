import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Trip } from './Trips'

type Member = { id: number; user_id: string | null; display_name: string }

export default function TripDetail({ trip, onBack }: { trip: Trip; onBack: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [guestName, setGuestName] = useState('')
  const [message, setMessage] = useState('')

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
      <button onClick={onBack}>← Back to trips</button>
      <h2>{trip.name}</h2>

      <h3>Members</h3>
      <ul>
        {members.map((m) => (
          <li key={m.id}>
            {m.display_name} {m.user_id ? '' : '(guest)'}
          </li>
        ))}
      </ul>

      <h3>Add a friend with an account</h3>
      <input
        type="email"
        placeholder="Friend's email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button onClick={addByEmail}>Add</button>

      <h3>Add a guest (no account)</h3>
      <input
        placeholder="Guest name"
        value={guestName}
        onChange={(e) => setGuestName(e.target.value)}
      />
      <button onClick={addGuest}>Add guest</button>

      {message && <p>{message}</p>}
    </div>
  )
}