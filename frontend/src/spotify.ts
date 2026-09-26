const AUTH = 'https://accounts.spotify.com'
const API = 'https://api.spotify.com/v1'

const ACCESS_KEY = 'spotify_access_token'
const EXPIRES_KEY = 'spotify_expires_at'
const REFRESH_KEY = 'spotify_refresh_token'

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challenge(verifier: string) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
}

function randomString(length = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, b => ('0' + b.toString(16)).slice(-2)).join('')
}

export interface SpotifyUser { id: string; display_name?: string | null; images?: { url: string }[] }
export interface SpotifyTrack {
  id: string
  name: string
  duration_ms: number
  external_urls?: { spotify?: string }
  artists: { name: string }[]
  album: { name: string; images?: { url: string }[] }
}
export interface SpotifyPlaylist {
  id: string; name: string; description?: string | null; images?: { url: string }[]
  public?: boolean | null; collaborative?: boolean
  owner?: { id?: string; display_name?: string | null }
  items?: { total?: number }; tracks?: { total?: number }
}
export interface SpotifyDevice {
  id: string | null
  is_active: boolean
  is_restricted: boolean
  name: string
  type: string
  volume_percent: number | null
  supports_volume: boolean
}

function redirectUri() {
  return (import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined) || `${window.location.origin}/callback`
}

/**
 * OAuth scopes now include playback control. Re-login is required after this change
 * because Spotify will not retroactively add scopes to an existing refresh token.
 */
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
  'user-read-email',
  'user-read-private'
].join(' ')

export async function spotifyLogin() {
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
  if (!clientId) throw new Error('Set VITE_SPOTIFY_CLIENT_ID in frontend/.env.local first.')
  spotifyLogout()
  const verifier = randomString()
  const state = randomString(24)
  sessionStorage.setItem('spotify_verifier', verifier)
  sessionStorage.setItem('spotify_state', state)
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    state,
    code_challenge_method: 'S256',
    code_challenge: await challenge(verifier),
    scope: SCOPES
  })
  window.location.assign(`${AUTH}/authorize?${params.toString()}`)
}

export async function handleSpotifyCallback() {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')
  if (error) {
    window.history.replaceState({}, '', '/')
    throw new Error(`Spotify authorization ${error.replace(/_/g, ' ')}`)
  }
  const code = params.get('code')
  if (!code) return false
  const state = params.get('state')
  const expected = sessionStorage.getItem('spotify_state')
  const verifier = sessionStorage.getItem('spotify_verifier')
  if (!state || state !== expected || !verifier) throw new Error('Spotify OAuth state validation failed.')
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
  if (!clientId) throw new Error('Missing VITE_SPOTIFY_CLIENT_ID.')
  const body = new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier })
  const res = await fetch(`${AUTH}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Spotify token exchange failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const token = await res.json()
  sessionStorage.setItem(ACCESS_KEY, token.access_token)
  sessionStorage.setItem(EXPIRES_KEY, String(Date.now() + token.expires_in * 1000))
  if (token.refresh_token) sessionStorage.setItem(REFRESH_KEY, token.refresh_token)
  sessionStorage.removeItem('spotify_verifier')
  sessionStorage.removeItem('spotify_state')
  window.history.replaceState({}, '', '/')
  return true
}

async function refreshAccessToken() {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY)
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
  if (!refreshToken || !clientId) return null
  const body = new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken })
  const res = await fetch(`${AUTH}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!res.ok) return null
  const token = await res.json()
  sessionStorage.setItem(ACCESS_KEY, token.access_token)
  sessionStorage.setItem(EXPIRES_KEY, String(Date.now() + token.expires_in * 1000))
  if (token.refresh_token) sessionStorage.setItem(REFRESH_KEY, token.refresh_token)
  return token.access_token as string
}

export async function getSpotifyAccessToken() {
  const access = sessionStorage.getItem(ACCESS_KEY)
  const expires = Number(sessionStorage.getItem(EXPIRES_KEY) || 0)
  if (access && Date.now() < expires - 60_000) return access
  return refreshAccessToken()
}

export function hasSpotifySession() {
  return Boolean(sessionStorage.getItem(ACCESS_KEY) || sessionStorage.getItem(REFRESH_KEY))
}

export function spotifyLogout() {
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(EXPIRES_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
  sessionStorage.removeItem('spotify_verifier')
  sessionStorage.removeItem('spotify_state')
}



declare global {
  interface Window {
    Spotify?: any
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

let webPlayer: any = null
let webDeviceId: string | null = null
let webPlayerPromise: Promise<any> | null = null
let webSdkPromise: Promise<void> | null = null
let webPlayerError: string | null = null

function loadSpotifyWebPlaybackSDK() {
  if (window.Spotify?.Player) return Promise.resolve()
  if (webSdkPromise) return webSdkPromise

  webSdkPromise = new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      if (window.Spotify?.Player) {
        settled = true
        resolve()
      }
    }
    const fail = (message: string) => {
      if (settled) return
      settled = true
      reject(new Error(message))
    }

    window.onSpotifyWebPlaybackSDKReady = finish

    const existing = document.querySelector('script[data-spotify-web-playback-sdk]') as HTMLScriptElement | null
    if (existing) {
      if (window.Spotify?.Player) finish()
      else window.setTimeout(() => fail('Spotify Web Playback SDK loaded but did not initialize.'), 15000)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    script.dataset.spotifyWebPlaybackSdk = 'true'
    script.onload = () => {
      if (window.Spotify?.Player) finish()
      else window.setTimeout(() => fail('Spotify Web Playback SDK loaded but did not initialize.'), 1000)
    }
    script.onerror = () => fail('Could not load the Spotify Web Playback SDK. Check your internet connection.')
    document.body.appendChild(script)
    window.setTimeout(() => fail('Timed out while loading the Spotify Web Playback SDK.'), 15000)
  })

  return webSdkPromise
}

export async function ensureSpotifyWebPlayer() {
  if (webPlayer?.getCurrentState && webDeviceId) return webPlayer
  if (webPlayerPromise) return webPlayerPromise

  webPlayerPromise = (async () => {
    await loadSpotifyWebPlaybackSDK()
    const access = await getSpotifyAccessToken()
    if (!access) throw new Error('Spotify session expired. Connect Spotify again.')
    if (!window.Spotify?.Player) throw new Error('Spotify Web Playback SDK did not initialize.')

    webPlayerError = null
    webDeviceId = null

    webPlayer = new window.Spotify.Player({
      name: 'NULLDECK Web Player',
      volume: 1,
      getOAuthToken: async (cb: (token: string) => void) => {
        const token = await getSpotifyAccessToken()
        if (token) cb(token)
      },
      enableMediaSession: true
    })

    webPlayer.addListener('ready', ({ device_id }: { device_id: string }) => {
      webDeviceId = device_id
      webPlayerError = null
    })
    webPlayer.addListener('not_ready', ({ device_id }: { device_id: string }) => {
      if (webDeviceId === device_id) webDeviceId = null
    })
    webPlayer.addListener('initialization_error', ({ message }: { message: string }) => {
      webPlayerError = `Spotify player initialization failed: ${message}`
      console.error('[NULLDECK Spotify]', message)
    })
    webPlayer.addListener('authentication_error', ({ message }: { message: string }) => {
      webPlayerError = `Spotify player authentication failed: ${message}`
      console.error('[NULLDECK Spotify]', message)
    })
    webPlayer.addListener('account_error', ({ message }: { message: string }) => {
      webPlayerError = `Spotify Web Playback requires Premium: ${message}`
      console.error('[NULLDECK Spotify]', message)
    })
    webPlayer.addListener('playback_error', ({ message }: { message: string }) => {
      webPlayerError = `Spotify playback failed: ${message}`
      console.error('[NULLDECK Spotify]', message)
    })
    webPlayer.addListener('autoplay_failed', () => {
      webPlayerError = 'Browser blocked autoplay. Click Enable Spotify Player, then play the track again.'
    })

    const connected = await webPlayer.connect()
    if (!connected) throw new Error('Spotify Web Playback SDK could not connect. Make sure you have Spotify Premium.')

    await new Promise<void>((resolve, reject) => {
      const started = performance.now()
      const timer = window.setInterval(() => {
        if (webDeviceId) {
          window.clearInterval(timer)
          resolve()
        } else if (webPlayerError) {
          window.clearInterval(timer)
          reject(new Error(webPlayerError))
        } else if (performance.now() - started > 10000) {
          window.clearInterval(timer)
          reject(new Error('Spotify Web Player connected but did not expose a device ID.'))
        }
      }, 100)
    })

    return webPlayer
  })()

  try {
    return await webPlayerPromise
  } catch (error) {
    webPlayerPromise = null
    throw error
  }
}

/** Call this from a real user click/tap to satisfy browser autoplay rules. */
export async function activateSpotifyPlayer() {
  const player = webPlayer || await ensureSpotifyWebPlayer()
  if (!webDeviceId) throw new Error('Spotify Web Player is not ready yet.')
  try {
    await player.activateElement?.()
  } catch {
    // Some browsers expose this as a void method; playback will report autoplay_failed if blocked.
  }
  return webDeviceId
}

export function isSpotifyWebPlayerReady() {
  return Boolean(webPlayer && webDeviceId)
}

export function getSpotifyWebPlayerDeviceId() {
  return webDeviceId
}

export async function disconnectSpotifyWebPlayer() {
  try { await webPlayer?.disconnect?.() } catch {}
  webPlayer = null
  webDeviceId = null
  webPlayerPromise = null
  webPlayerError = null
}

async function spotifyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let access = await getSpotifyAccessToken()
  if (!access) throw new Error('Spotify session expired. Connect Spotify again.')
  const make = (token: string) => fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` }
  })
  let res = await make(access)
  if (res.status === 401) {
    access = await refreshAccessToken()
    if (access) res = await make(access)
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 403) throw new Error(`Spotify denied playback control (403). Make sure the account is Premium and reconnect Spotify so the new playback scopes are granted.${detail ? ` ${detail}` : ''}`)
    throw new Error(`Spotify API ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function getCurrentUser() { return spotifyFetch<SpotifyUser>('/me') }

export async function getPlaylists() {
  const all: SpotifyPlaylist[] = []
  let offset = 0
  do {
    const page = await spotifyFetch<{ items: SpotifyPlaylist[]; next: string | null; total: number }>(`/me/playlists?limit=50&offset=${offset}`)
    all.push(...page.items); offset += page.items.length
    if (!page.next || page.items.length === 0) break
  } while (all.length < 2000)
  return { items: all, total: all.length }
}

export async function getPlaylistTracks(id: string) {
  const all: SpotifyTrack[] = []
  let offset = 0
  do {
    const data = await spotifyFetch<{ items: Array<{ item: SpotifyTrack | null }>; next: string | null }>(
      `/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}&fields=items(item(id,name,duration_ms,external_urls,artists(name),album(name,images)))`
    )
    for (const row of data.items) if (row.item?.id) all.push(row.item)
    offset += data.items.length
    if (!data.next || data.items.length === 0) break
  } while (all.length < 5000)
  return all
}

export async function getSpotifyDevices() {
  const data = await spotifyFetch<{ devices: SpotifyDevice[] }>('/me/player/devices')
  return data.devices
}

/**
 * Plays the selected Spotify track on the user's currently active Spotify device.
 * This is intentionally Spotify-controlled playback: it does not expose Spotify's
 * protected audio as a Web Audio source.
 */
export async function playSpotifyTrack(trackId: string) {
  // If the player is already initialized, activate it immediately from the
  // calling click handler so browser autoplay rules can be satisfied.
  if (webPlayer && webDeviceId) {
    try { void webPlayer.activateElement?.() } catch {}
  }
  await ensureSpotifyWebPlayer()
  if (!webDeviceId) throw new Error('Spotify Web Player is not ready yet. Click Enable Spotify Player first.')

  await spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(webDeviceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: 0 })
  })

  return { id: webDeviceId, name: 'NULLDECK Web Player' }
}

export async function pauseSpotifyPlayback(deviceId?: string | null) {
  await spotifyFetch<void>(deviceId ? `/me/player/pause?device_id=${encodeURIComponent(deviceId)}` : '/me/player/pause', { method: 'PUT' })
}

export async function seekSpotifyPlayback(positionMs: number, deviceId?: string | null) {
  const qs = new URLSearchParams({ position_ms: String(Math.max(0, Math.floor(positionMs))) })
  if (deviceId) qs.set('device_id', deviceId)
  await spotifyFetch<void>(`/me/player/seek?${qs.toString()}`, { method: 'PUT' })
}

export async function setSpotifyVolume(percent: number, deviceId?: string | null) {
  const qs = new URLSearchParams({ volume_percent: String(Math.max(0, Math.min(100, Math.round(percent)))) })
  if (deviceId) qs.set('device_id', deviceId)
  await spotifyFetch<void>(`/me/player/volume?${qs.toString()}`, { method: 'PUT' })
}
