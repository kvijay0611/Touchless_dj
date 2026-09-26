import React, { useMemo, useState } from 'react'
import { ArrowLeft, Music2, Search, X, Sparkles, Play } from 'lucide-react'
import type { Track, DeckId } from '../types'
import type { SpotifyPlaylist } from '../spotify'

type Source = 'spotify' | 'jamendo'

type Props = {
  open: boolean
  playlists?: SpotifyPlaylist[]
  selectedPlaylist?: SpotifyPlaylist | null
  tracks: Track[]
  onClose: () => void
  onChoosePlaylist?: (id: string) => void
  onPick: (d: DeckId, t: Track) => void
  onSuggest?: (t: Track) => void
  onPreview?: (t: Track) => void
  /** Which catalog `tracks` came from. Defaults to 'spotify' to match prior behavior. */
  source?: Source
}

const SOURCE_COPY: Record<Source, { eyebrow: string; title: string; pickHint: string; previewTitle: string }> = {
  spotify: {
    eyebrow: 'SPOTIFY LIBRARY',
    title: 'Your playlists',
    pickHint: 'Map track metadata to Deck',
    previewTitle: 'Preview in NULLDECK Spotify browser player'
  },
  jamendo: {
    eyebrow: 'JAMENDO · CREATIVE COMMONS',
    title: 'Search results',
    pickHint: 'Load full track into Deck',
    previewTitle: 'Preview this track'
  }
}

export default function PlaylistPanel({
  open,
  playlists = [],
  selectedPlaylist = null,
  tracks,
  onClose,
  onChoosePlaylist,
  onPick,
  onSuggest,
  onPreview,
  source = 'spotify'
}: Props) {
  const copy = SOURCE_COPY[source]
  const [query, setQuery] = useState('')

  const filtered = useMemo(
    () => tracks.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(query.toLowerCase())),
    [tracks, query]
  )

  if (!open) return null

  // Spotify: clicking A/B only attaches METADATA to the deck — Spotify audio
  // cannot be downloaded/extracted into the Web Audio DJ engine, so App.tsx
  // routes playback to Spotify's own player instead of djEngine.
  // Jamendo: the track already carries a real streamUrl, so App.tsx loads it
  // straight into djEngine for full EQ/scratch/crossfader mixing.
  function chooseTrack(deck: DeckId, track: Track) {
    onPick(deck, { ...track, source })
    onClose()
  }

  const showPlaylistList = Boolean(onChoosePlaylist && !selectedPlaylist)

  return (
    <div className="playlist-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2>{selectedPlaylist ? selectedPlaylist.name : copy.title}</h2>
        </div>
        <button onClick={onClose} aria-label="Close"><X size={15} /></button>
      </div>

      {showPlaylistList ? (
        <>
          <div className="search-box">
            <Search size={13} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search playlists" />
          </div>

          <div className="track-list">
            {playlists
              .filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
              .map(p => (
                <button key={p.id} className="playlist-row" onClick={() => onChoosePlaylist?.(p.id)}>
                  {p.images?.[0]?.url ? <img src={p.images[0].url} alt="" /> : <div className="art-placeholder"><Music2 size={15} /></div>}
                  <span>
                    <b>{p.name}</b>
                    <small>{p.items?.total ?? p.tracks?.total ?? 0} tracks</small>
                  </span>
                </button>
              ))}
          </div>
        </>
      ) : (
        <>
          {selectedPlaylist && onChoosePlaylist && (
            <div className="playlist-toolbar">
              <button className="back-button" onClick={() => onChoosePlaylist('')}>
                <ArrowLeft size={12} /> Playlists
              </button>
              {onSuggest && (
                <button className="suggest-all" onClick={() => filtered[0] && onSuggest(filtered[0])} disabled={!filtered.length}>
                  <Sparkles size={12} /> Suggest next
                </button>
              )}
            </div>
          )}

          <div className="search-box">
            <Search size={13} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search this playlist" />
          </div>

          <div className="track-list">
            {filtered.map((t, index) => (
              <div className="playlist-track" key={`${t.id}-${t.title}-${t.artist}-${index}`}>
                {t.artwork ? <img src={t.artwork} alt="" /> : <div className="art-placeholder"><Music2 size={15} /></div>}

                <div className="track-copy">
                  <b>{t.title}</b>
                  <span>{t.artist} · {t.album}</span>
                </div>

                <div className="pick-buttons">
                  <button title={`${copy.pickHint} A`} onClick={() => chooseTrack('A', t)}>A</button>
                  <button title={`${copy.pickHint} B`} onClick={() => chooseTrack('B', t)}>B</button>
                  {onPreview && <button title={copy.previewTitle} onClick={() => onPreview(t)}><Play size={11}/></button>}
                  {onSuggest && (
                    <button title="Use as next-track candidate" onClick={() => onSuggest(t)}>
                      <Sparkles size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!filtered.length && <div className="muted" style={{ padding: '18px 0' }}>No tracks found.</div>}
          </div>
        </>
      )}
    </div>
  )
}
