import React, { useRef } from 'react'
import { Pause, Play, RotateCcw, Zap, FolderOpen } from 'lucide-react'
import type { DeckId, DeckState } from '../types'
import Waveform from './Waveform'
import { djEngine } from '../audio/DJEngine'

const fmt = (s:number) => `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`

export default function Deck({
  id, deck, onChange, onFile, onAnalyze, onSync, onPlay, onPause
}: {
  id: DeckId
  deck: DeckState
  onChange: (p: Partial<DeckState>) => void
  onFile: (f: File) => void
  onAnalyze: () => void
  onSync: () => void
  onPlay?: () => void
  onPause?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const jog = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!deck.audioUrl) return
    const r = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    djEngine.nudge(id, Math.max(-.08, Math.min(.08, (dx + dy * .15) / 300)))
  }
  const slider = (key:keyof DeckState,v:number) => onChange({[key]:v} as Partial<DeckState>)
  const spotifyTrack = deck.track?.source === 'spotify'
  const spotifyMetadataOnly = spotifyTrack && !deck.audioUrl

  return <section className={`deck deck-${id}`}>
    <input
      ref={input}
      type="file"
      accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
      hidden
      onChange={e => {
        const f = e.target.files?.[0]
        if (f) onFile(f)
        e.currentTarget.value = ''
      }}
    />

    <header className="deck-header">
      <span>DECK {id}</span>
      <span>{deck.bpm ? `${deck.bpm.toFixed(0)} BPM` : '— BPM'}</span>
    </header>

    <button className="dropzone" onClick={() => input.current?.click()}>
      <FolderOpen size={14} />
      {spotifyMetadataOnly
        ? 'Spotify metadata selected · load an audio file to mix'
        : deck.audioUrl
          ? 'Local audio loaded — click to replace'
          : 'Drop an audio file here, or click to browse'}
    </button>

    <div className="track-heading">
      <div>
        <div className="track-title">{deck.track?.title ?? 'No track loaded'}</div>
        <div className="track-meta">
          {deck.track ? `${deck.track.artist} · ${deck.key || '—'}` : 'Key — : B♭'}
        </div>
        {spotifyTrack && <small className="muted">Spotify is a library/preview source. DJ processing requires audio loaded into this deck.</small>}
      </div>
      {deck.track?.artwork && <img src={deck.track.artwork} className="artwork" />}
    </div>

    <Waveform analysis={deck.analysis} position={deck.position} onSeek={s => { if (!deck.audioUrl) return; djEngine.seek(id,s); onChange({position:s}) }} />
    <div className="time-row"><span>{fmt(deck.position)}</span><span>{fmt(deck.duration)}</span></div>

    <div className="transport">
      <button disabled={!deck.audioUrl && !spotifyTrack} onClick={() => { if (spotifyTrack) { if (deck.playing) onPause?.(); else onPlay?.() } else djEngine.toggle(id) }}>
        {deck.playing ? <Pause size={12}/> : <Play size={12}/>} {deck.playing ? 'Pause' : 'Play'}
      </button>
      <button disabled={!deck.audioUrl} onClick={() => { onChange({cue:deck.position}); djEngine.setCue(id,deck.position) }}>Set Cue</button>
      <button disabled={!deck.audioUrl || deck.cue === null} onClick={() => deck.cue !== null && djEngine.seek(id,deck.cue)}>Cue →</button>
      <button disabled={!deck.audioUrl} onClick={() => { onChange({loopIn:deck.position}); djEngine.setLoop(id,deck.position,deck.loopOut,deck.loopOn) }}>Loop In</button>
      <button disabled={!deck.audioUrl} onClick={() => { onChange({loopOut:deck.position}); djEngine.setLoop(id,deck.loopIn,deck.position,deck.loopOn) }}>Loop Out</button>
      <button disabled={!deck.audioUrl} onClick={() => { const on=!deck.loopOn; onChange({loopOn:on}); djEngine.setLoop(id,deck.loopIn,deck.loopOut,on) }}>Loop {deck.loopOn?'On':'Off'}</button>
    </div>

    <div className="deck-grid">
      <div className="slider-block"><label>Volume <b>{Math.round(deck.volume*100)}%</b></label><input type="range" min="0" max="1" step=".01" value={deck.volume} onChange={e=>{const v=+e.target.value;slider('volume',v);djEngine.setVolume(id,v)}}/></div>
      <div className="slider-block"><label>Tempo <b>{deck.tempo.toFixed(0)}%</b></label><input type="range" min="-50" max="50" step=".1" value={deck.tempo} onChange={e=>{const v=+e.target.value;slider('tempo',v);djEngine.setTempo(id,v)}}/></div>
    </div>

    <div className="knob-row">{(['bass','mid','treble'] as const).map(b=><label className="vertical-control" key={b}><span>{b.toUpperCase()}</span><input type="range" min="-12" max="12" step=".5" value={deck[b]} onChange={e=>{const v=+e.target.value;slider(b,v);djEngine.setEQ(id,b,v)}}/></label>)}</div>

    <div className="jog-row">
      <div className={`jog-wheel ${!deck.audioUrl ? 'disabled' : ''}`} onPointerDown={jog}><div className="jog-center"><RotateCcw size={15}/><small>JOG</small></div></div>
      <div className="mini-actions">
        <button onClick={onAnalyze} disabled={!deck.audioUrl}><Zap size={12}/> Analyze</button>
        <button onClick={onSync} disabled={!deck.audioUrl}>{deck.audioUrl ? 'Sync Beat' : 'Attach audio first'}</button>
      </div>
    </div>

    <footer className="deck-hint">
      {spotifyTrack
        ? 'Spotify selection is metadata/preview only. Load the track as permitted audio to use EQ, scratch, tempo, cue and crossfader.'
        : id==='A'
          ? 'Hand control: left hand height → volume · pinch → cue'
          : 'Hand control: right hand height → volume · circular motion → jog'}
    </footer>
  </section>
}
