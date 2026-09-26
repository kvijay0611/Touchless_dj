/**
 * Jamendo integration.
 *
 * Unlike spotify.ts, this is NOT metadata-only. Jamendo's catalog is
 * Creative Commons licensed and its API returns a direct, streamable audio
 * file URL per track (no DRM, no device/session restrictions). That means a
 * Jamendo track can be handed straight to djEngine.load() and get full
 * EQ / scratch / tempo / crossfader treatment, exactly like a local file.
 *
 * Calls go through our own backend (/api/jamendo/search) instead of
 * api.jamendo.com directly:
 *  - keeps the Jamendo client_id out of the frontend bundle
 *  - gives us one place to add caching/rate-limiting later
 *  - matches the existing pattern for /api/analyze
 */

const API = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:8000'

export interface JamendoTrack {
  id: string
  name: string
  artist_name: string
  album_name: string
  album_image?: string | null
  duration: number
  audio: string
  audiodownload?: string | null
}

export async function searchJamendo(query: string, limit = 30): Promise<JamendoTrack[]> {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (query.trim()) qs.set('query', query.trim())
  const res = await fetch(`${API}/api/jamendo/search?${qs.toString()}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Jamendo search failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const data = await res.json()
  return (data.results || []) as JamendoTrack[]
}
