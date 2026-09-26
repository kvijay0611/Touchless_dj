export type DeckId = 'A' | 'B'

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  artwork?: string
  durationMs: number
  bpm?: number
  key?: string
  spotifyUrl?: string
  /**
   * Direct, playable audio URL for sources that legally expose one (e.g. Jamendo's
   * Creative Commons catalog). When present, this can be fed straight into
   * djEngine.load() for full EQ/scratch/crossfader mixing — unlike Spotify, which
   * is metadata/preview only (see spotify.ts).
   */
  streamUrl?: string
  source?: 'spotify' | 'local' | 'demo' | 'jamendo'
}

export interface Analysis {
  bpm: number
  key: string
  duration: number
  beats: number[]
  waveform: number[]
  sections: Array<{ start: number; end: number; label: string; energy: number }>
}

export interface DeckState {
  track: Track | null
  audioUrl: string | null
  playing: boolean
  position: number
  duration: number
  volume: number
  tempo: number
  bass: number
  mid: number
  treble: number
  filter: number
  cue: number | null
  loopIn: number | null
  loopOut: number | null
  loopOn: boolean
  bpm: number
  key: string
  analysis: Analysis | null
}
