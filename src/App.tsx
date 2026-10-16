import { useEffect, useRef, useState } from 'react'
import {
  exchangeCodeForToken,
  getAccessToken,
  redirectToTwitterAuth,
  refreshAccessToken,
} from './auth'
import Bookmarks from './Bookmarks'
import './App.css'

type AuthState =
  | { status: 'exchanging'; code: string; state: string | null }
  | { status: 'refreshing' }
  | { status: 'redirecting' }
  | { status: 'authenticated' }
  | { status: 'error'; error: string }

function getInitialAuthState(): AuthState {
  const params = new URLSearchParams(window.location.search)
  const authError = params.get('error')
  const code = params.get('code')

  if (authError) {
    return { status: 'error', error: `Twitter authorization failed: ${authError}` }
  }
  if (code) {
    return { status: 'exchanging', code, state: params.get('state') }
  }
  if (getAccessToken()) {
    return { status: 'authenticated' }
  }
  // No token in this tab, but a stored refresh token may still be valid.
  return { status: 'refreshing' }
}

function App() {
  const [auth, setAuth] = useState(getInitialAuthState)
  // StrictMode runs effects twice in dev; an auth code can only be used once.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    // Drop ?code=/?error= from the URL so a refresh doesn't reuse them.
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname)
    }

    if (auth.status === 'exchanging') {
      exchangeCodeForToken(auth.code, auth.state)
        .then(() => setAuth({ status: 'authenticated' }))
        .catch((err: Error) => setAuth({ status: 'error', error: err.message }))
    } else if (auth.status === 'refreshing') {
      refreshAccessToken()
        .then(() => setAuth({ status: 'authenticated' }))
        .catch(() => {
          setAuth({ status: 'redirecting' })
          redirectToTwitterAuth()
        })
    }
  }, [auth])

  return (
    <section id="center">
      <h1>bkmrkr</h1>
      {(auth.status === 'exchanging' || auth.status === 'refreshing') && (
        <p>Signing you in…</p>
      )}
      {auth.status === 'redirecting' && <p>Redirecting to Twitter…</p>}
      {auth.status === 'authenticated' && <Bookmarks />}
      {auth.status === 'error' && (
        <>
          <p>{auth.error}</p>
          <button
            type="button"
            className="button"
            onClick={() => redirectToTwitterAuth()}
          >
            Try again
          </button>
        </>
      )}
    </section>
  )
}

export default App
