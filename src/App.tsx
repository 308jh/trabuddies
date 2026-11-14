import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import AuthForm from './AuthForm'
import Dashboard from './Dashboard'
import TripDetail from './TripDetail'
import type { Trip } from './Trips'

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

  // the CSS uses this class to widen the page and calm the map once you are logged in
  useEffect(() => {
    document.documentElement.classList.toggle('in-app', !!session)
  }, [session])

  if (loading) return <p className="muted">Loading...</p>
  if (!session) return <AuthForm />

  return (
    <div>
      <header className="app-header">
        <div className="brand">
          <img src="/logo.svg" alt="" width={36} height={36} />
          <span>TraBuddies</span>
        </div>
        <div className="header-right">
          <span className="user-chip">{session.user.email}</span>
          <button
            className="ghost"
            onClick={() => {
              setSelectedTrip(null)
              supabase.auth.signOut()
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {selectedTrip ? (
        <TripDetail trip={selectedTrip} onBack={() => setSelectedTrip(null)} />
      ) : (
        <Dashboard session={session} onOpen={setSelectedTrip} />
      )}
    </div>
  )
}
