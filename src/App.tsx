import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export default function App() {
  const [status, setStatus] = useState('Checking connection...')

  useEffect(() => {
    supabase.from('trips').select('*').then(({ error }) => {
      setStatus(error ? `Error: ${error.message}` : 'Connected to Supabase ✅')
    })
  }, [])

  return <h1>TraBuddies: {status}</h1>
}