import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function AuthForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  async function signUp() {
    const { error } = await supabase.auth.signUp({ email, password })
    setMessage(error ? error.message : 'Signed up!')
  }

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
  }

return (
    <div className="card auth">
      <img src="/logo.svg" alt="TraBuddies" width={56} height={56} />
      <span className="eyebrow">TraBuddies — travel bills, split</span>
      <h1>SPLIT<br />THE TRIP</h1>
      <p className="muted">Sign in to continue</p>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button onClick={signIn}>Sign in</button>
      <button className="ghost" onClick={signUp}>Create account</button>
      <p className="muted">{message}</p>
    </div>
  )
}