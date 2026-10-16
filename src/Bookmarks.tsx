import { useCallback, useEffect, useRef, useState } from 'react'
import { authFetch } from './auth'

const API_URL = import.meta.env.VITE_API_URL

type Bookmark = {
  id: string
  text: string
  category: string
  reason: string
}

type Category = {
  name: string
  count: number
  tweet_ids: string[]
}

type BookmarksResponse = {
  categories: Category[]
  bookmarks: Bookmark[]
}

// Status of the background sort while the API returns 202.
type JobStatus = 'starting' | 'queued' | 'processing'

type LoadState =
  | { status: 'loading'; job: JobStatus }
  | { status: 'error'; error: string }
  | { status: 'loaded'; data: BookmarksResponse }

const POLL_INTERVAL_MS = 3000
// Covers a sort that needs all its retries; the server gives up before this.
const POLL_TIMEOUT_MS = 6 * 60 * 1000

const JOB_MESSAGES: Record<JobStatus, string> = {
  starting: 'Fetching your bookmarks…',
  queued: 'Waiting to sort your bookmarks…',
  processing: 'Sorting your bookmarks… this can take a little while.',
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The first request starts a background sort; later ones report its status
// (202) until the result is ready (200).
async function fetchBookmarks(
  onStatus: (job: JobStatus) => void,
): Promise<BookmarksResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const res = await authFetch(`${API_URL}/bookmarks`)
    const body = await res.json().catch(() => null)
    if (res.status === 202) {
      onStatus(body?.status === 'processing' ? 'processing' : 'queued')
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    if (!res.ok) {
      throw new Error(body?.error ?? `Could not load bookmarks (${res.status})`)
    }
    return body as BookmarksResponse
  }
  throw new Error('Sorting is taking longer than expected. Try again.')
}

function Bookmarks() {
  const [load, setLoad] = useState<LoadState>({
    status: 'loading',
    job: 'starting',
  })
  const [selected, setSelected] = useState<string | null>(null)

  const loadBookmarks = useCallback(() => {
    setLoad({ status: 'loading', job: 'starting' })
    fetchBookmarks((job) => setLoad({ status: 'loading', job }))
      .then((data) => setLoad({ status: 'loaded', data }))
      .catch((err: Error) => setLoad({ status: 'error', error: err.message }))
  }, [])

  // StrictMode runs effects twice in dev; avoid starting two polling loops.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    loadBookmarks()
  }, [loadBookmarks])

  if (load.status === 'loading') {
    return <p>{JOB_MESSAGES[load.job]}</p>
  }
  if (load.status === 'error') {
    return (
      <>
        <p>{load.error}</p>
        <button type="button" className="button" onClick={loadBookmarks}>
          Try again
        </button>
      </>
    )
  }

  const { categories, bookmarks } = load.data
  if (bookmarks.length === 0) {
    return <p>You don't have any bookmarks yet.</p>
  }

  const byId = new Map(bookmarks.map((b) => [b.id, b]))
  const shown = categories
    .filter((c) => selected === null || c.name === selected)
    .sort((a, b) => b.count - a.count)

  return (
    <div className="bookmarks">
      <nav className="category-filter" aria-label="Filter by category">
        <button
          type="button"
          className="chip"
          aria-pressed={selected === null}
          onClick={() => setSelected(null)}
        >
          All <span className="count">{bookmarks.length}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.name}
            type="button"
            className="chip"
            aria-pressed={selected === c.name}
            onClick={() => setSelected(c.name)}
          >
            {c.name} <span className="count">{c.count}</span>
          </button>
        ))}
      </nav>

      {shown.map((c) => (
        <section key={c.name} className="category">
          <h2>
            {c.name} <span className="count">{c.count}</span>
          </h2>
          <ul>
            {c.tweet_ids.map((id) => {
              const b = byId.get(id)
              if (!b) return null
              return (
                <li key={id} className="bookmark">
                  <p className="bookmark-text">{b.text}</p>
                  <p className="bookmark-reason">{b.reason}</p>
                  <a
                    href={`https://x.com/i/web/status/${id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on X
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default Bookmarks
