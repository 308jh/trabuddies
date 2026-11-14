import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export type Trip = { id: number; name: string; created_at: string }

export default function Trips({ onSelect }: { onSelect: (t: Trip) => void }) {
  const [trips, setTrips] = useState<Trip[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function loadTrips() {
    const { data, error } = await supabase
      .from('trips')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setTrips(data)
  }

  useEffect(() => {
    loadTrips()
  }, [])

  async function createTrip() {
    if (!name.trim()) return
    const { error } = await supabase.from('trips').insert({ name: name.trim() })
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    setError('')
    loadTrips()
  }

  return (
    <div className="card">
      <h2>My trips</h2>
      <input
        placeholder="New trip name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button onClick={createTrip}>Create trip</button>
      {error && <p>{error}</p>}
      <ul>
        {trips.map((t) => (
          <li key={t.id}>
            <button onClick={() => onSelect(t)}>{t.name}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}