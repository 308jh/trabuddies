
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
    <h1>TraBuddies</h1>
    <p>Logged in as {session.user.email}</p>
    <button onClick={() => supabase.auth.signOut()}>Sign out</button>
    {selectedTrip ? (
      <TripDetail trip={selectedTrip} onBack={() => setSelectedTrip(null)} />
    ) : (
      <Trips onSelect={setSelectedTrip} />
    )}
  </div>
  )
}