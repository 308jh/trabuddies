
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import AuthForm from './AuthForm'
import Trips, { type Trip } from './Trips'
import TripDetail from './TripDetail'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) return <p>Loading...</p>
  if (!session) return <AuthForm />

  return (
    <div>
      <header className="app-header">
        <div className="brand">
          <img src="/logo.svg" alt="" width={36} height={36} />
          <span>TraBuddies</span>
        </div>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <p className="muted">{session.user.email}</p>
      {selectedTrip ? (
        <TripDetail trip={selectedTrip} onBack={() => setSelectedTrip(null)} />
      ) : (
        <Trips onSelect={setSelectedTrip} />
      )}
    </div>
  )
}