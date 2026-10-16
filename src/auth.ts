const TWITTER_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
const SCOPES = ['tweet.read', 'users.read', 'bookmark.read', 'offline.access']

const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const CODE_VERIFIER_KEY = 'pkce_code_verifier'
const OAUTH_STATE_KEY = 'oauth_state'

const CLIENT_ID = import.meta.env.VITE_TWITTER_CLIENT_ID
const API_URL = import.meta.env.VITE_API_URL
const REDIRECT_URI =
  import.meta.env.VITE_TWITTER_REDIRECT_URI ?? window.location.origin

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setAccessToken(token: string) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token)
}

// Kept in localStorage so a new tab or reload can get a fresh access token
// without signing in again.
function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

type TokenResponse = { access_token: string; refresh_token?: string }

function storeTokens({ access_token, refresh_token }: TokenResponse) {
  setAccessToken(access_token)
  if (refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token)
  }
}

export function clearTokens() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomString(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return base64UrlEncode(new Uint8Array(digest))
}

export async function redirectToTwitterAuth() {
  const verifier = randomString()
  const state = randomString(16)
  sessionStorage.setItem(CODE_VERIFIER_KEY, verifier)
  sessionStorage.setItem(OAUTH_STATE_KEY, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
    code_challenge: await codeChallengeFor(verifier),
    code_challenge_method: 'S256',
  })
  window.location.assign(`${TWITTER_AUTHORIZE_URL}?${params}`)
}

// Sends the authorization code to the backend, which exchanges it for access
// and refresh tokens with Twitter and returns them.
export async function exchangeCodeForToken(
  code: string,
  state: string | null,
): Promise<string> {
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY)
  const codeVerifier = sessionStorage.getItem(CODE_VERIFIER_KEY)
  sessionStorage.removeItem(OAUTH_STATE_KEY)
  sessionStorage.removeItem(CODE_VERIFIER_KEY)

  if (!state || state !== expectedState) {
    throw new Error('OAuth state mismatch')
  }
  if (!codeVerifier) {
    throw new Error('Missing PKCE code verifier')
  }

  const res = await fetch(`${API_URL}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status})`)
  }

  const tokens = (await res.json()) as TokenResponse
  storeTokens(tokens)
  return tokens.access_token
}

let refreshing: Promise<string> | null = null

// Asks the backend for a new access token using the stored refresh token, and
// stores the rotated refresh token it returns. Shared so concurrent callers
// trigger only one refresh, since Twitter refresh tokens are single-use.
export function refreshAccessToken(): Promise<string> {
  refreshing ??= (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      throw new Error('No refresh token')
    }
    const res = await fetch(`${API_URL}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      throw new Error(`Token refresh failed (${res.status})`)
    }
    const tokens = (await res.json()) as TokenResponse
    storeTokens(tokens)
    return tokens.access_token
  })()
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

// fetch with the access token attached. On a 401 it refreshes the token and
// retries once; if the refresh fails, it sends the user to sign in again.
export async function authFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const withToken = (token: string | null) =>
    fetch(input, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    })

  let res = await withToken(getAccessToken())
  if (res.status === 401) {
    try {
      res = await withToken(await refreshAccessToken())
    } catch {
      clearTokens()
      await redirectToTwitterAuth()
    }
  }
  return res
}
