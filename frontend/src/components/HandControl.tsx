import React, { useEffect, useRef, useState } from 'react'
import { Hand, X } from 'lucide-react'
import { djEngine } from '../audio/DJEngine'

declare global { interface Window { Hands?: any } }

type DeckId = 'A' | 'B'
type EQBand = 'bass' | 'mid' | 'treble'
type Point = { x: number; y: number; z: number }

type Gesture = 'PINCH_CUE' | 'EQ_BASS' | 'EQ_MID' | 'EQ_TREBLE' | 'FIST' | 'VICTORY' | 'OPEN' | 'MOVE'

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const distance = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

function fingerExtended(lm: any[], tip: number, pip: number) {
  return distance(lm[tip], lm[0]) > distance(lm[pip], lm[0]) * 1.12
}

function classifyGesture(lm: any[]): Gesture {
  const index = fingerExtended(lm, 8, 6)
  const middle = fingerExtended(lm, 12, 10)
  const ring = fingerExtended(lm, 16, 14)
  const pinky = fingerExtended(lm, 20, 18)

  // Pinch a specific finger with the thumb to select an EQ band.
  // The pinky pinch is reserved for CUE so normal index/middle/ring pinches become EQ controls.
  const pinchDistances = {
    bass: distance(lm[4], lm[8]),
    mid: distance(lm[4], lm[12]),
    treble: distance(lm[4], lm[16]),
    cue: distance(lm[4], lm[20])
  }
  const closest = Object.entries(pinchDistances).sort((a, b) => a[1] - b[1])[0]
  if (closest[1] < 0.075) {
    if (closest[0] === 'bass') return 'EQ_BASS'
    if (closest[0] === 'mid') return 'EQ_MID'
    if (closest[0] === 'treble') return 'EQ_TREBLE'
    return 'PINCH_CUE'
  }

  if (!index && !middle && !ring && !pinky) return 'FIST'
  if (index && middle && !ring && !pinky) return 'VICTORY'
  if (index && middle && ring && pinky) return 'OPEN'
  return 'MOVE'
}

function gestureLabel(g: Gesture) {
  switch (g) {
    case 'EQ_BASS': return 'BASS EQ'
    case 'EQ_MID': return 'MID EQ'
    case 'EQ_TREBLE': return 'TREBLE EQ'
    case 'PINCH_CUE': return 'CUE'
    case 'FIST': return 'PLAY/PAUSE'
    case 'VICTORY': return 'SYNC'
    case 'OPEN': return 'OPEN PALM'
    default: return 'MOVE'
  }
}

async function loadLegacyMediaPipeHands() {
  if (window.Hands) return window.Hands
  const urls = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js',
    'https://unpkg.com/@mediapipe/hands@0.4.1675469240/hands.js'
  ]
  for (const src of urls) {
    try {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = src
        script.async = true
        script.crossOrigin = 'anonymous'
        script.onload = () => resolve()
        script.onerror = () => reject(new Error(`Could not load ${src}`))
        document.head.appendChild(script)
      })
      if (window.Hands) return window.Hands
    } catch { /* fallback */ }
  }
  throw new Error('MediaPipe Hands could not be downloaded. Check internet/CDN access.')
}

export default function HandControl({
  enabled,
  onClose,
  onCrossfade,
  onDeckVolume,
  onEQ,
  onCue,
  bpmA,
  bpmB
}: {
  enabled: boolean
  onClose: () => void
  onCrossfade: (value: number) => void
  onDeckVolume: (id: DeckId, value: number) => void
  onEQ: (id: DeckId, band: EQBand, value: number) => void
  onCue: (id: DeckId) => void
  bpmA: number
  bpmB: number
}) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const callbacks = useRef({ onCrossfade, onDeckVolume, onEQ, onCue })
  const bpm = useRef({ A: bpmA, B: bpmB })
  const previous = useRef<Record<string, Point>>({})
  const stableGesture = useRef<Record<string, { name: Gesture; frames: number }>>({})
  const lastAction = useRef<Record<string, number>>({})
  const lastEQUpdate = useRef<Record<string, number>>({})
  const running = useRef(false)

  const [status, setStatus] = useState('camera off')
  const [hands, setHands] = useState(0)
  const [action, setAction] = useState('READY')

  useEffect(() => {
    callbacks.current = { onCrossfade, onDeckVolume, onEQ, onCue }
    bpm.current = { A: bpmA, B: bpmB }
  }, [onCrossfade, onDeckVolume, onEQ, onCue, bpmA, bpmB])

  useEffect(() => {
    if (!enabled) {
      setStatus('camera off')
      setAction('READY')
      return
    }

    let stream: MediaStream | null = null
    let mpHands: any = null
    let stopped = false
    let frameId = 0

    const trigger = (key: string, fn: () => void) => {
      const now = performance.now()
      if (now - (lastAction.current[key] || 0) < 900) return
      lastAction.current[key] = now
      fn()
    }

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable. Use localhost or HTTPS.')
        setStatus('requesting camera…')

        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false
        })
        if (stopped || !video.current) return

        video.current.srcObject = stream
        video.current.muted = true
        video.current.playsInline = true
        await new Promise<void>(resolve => {
          const v = video.current!
          if (v.readyState >= 2) resolve()
          else v.onloadedmetadata = () => resolve()
        })
        await video.current.play()
        setStatus('camera LIVE · loading hand model…')

        const HandsConstructor = await loadLegacyMediaPipeHands()
        if (stopped) return

        mpHands = new HandsConstructor({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
        })
        mpHands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.45,
          minTrackingConfidence: 0.45
        })

        mpHands.onResults((results: any) => {
          if (stopped) return
          const v = video.current
          const c = canvas.current
          if (!v || !c) return

          c.width = v.videoWidth || 640
          c.height = v.videoHeight || 480
          const ctx = c.getContext('2d')
          if (!ctx) return
          ctx.clearRect(0, 0, c.width, c.height)

          const detected = results.multiHandLandmarks || []
          const handedness = results.multiHandedness || []
          setHands(detected.length)

          detected.forEach((lm: any[], index: number) => {
            const rawLabel = handedness[index]?.label || 'Right'
            const label = rawLabel === 'Left' ? 'Left' : 'Right'
            const deck: DeckId = label === 'Left' ? 'A' : 'B'
            const wrist = lm[0]
            const point: Point = { x: wrist.x, y: wrist.y, z: wrist.z }
            const old = previous.current[label]
            const gesture = classifyGesture(lm)

            const eqBand: EQBand | null =
              gesture === 'EQ_BASS' ? 'bass' :
              gesture === 'EQ_MID' ? 'mid' :
              gesture === 'EQ_TREBLE' ? 'treble' : null

            // Normal hand motion controls volume/crossfader only when not using a button/EQ gesture.
            if (!eqBand && gesture !== 'FIST' && gesture !== 'VICTORY' && gesture !== 'PINCH_CUE') {
              if (deck === 'A') callbacks.current.onCrossfade(clamp((0.5 - wrist.x) * 2, -1, 1))
              callbacks.current.onDeckVolume(deck, clamp(1 - wrist.y, 0, 1))
            }

            // Jog/scratch while moving without a dedicated gesture.
            if (old && (gesture === 'MOVE' || gesture === 'OPEN')) {
              const dx = point.x - old.x
              const dy = point.y - old.y
              if (Math.hypot(dx, dy) > 0.012) {
                djEngine.nudge(deck, clamp(dx * 0.65, -0.06, 0.06))
              }
            }

            // Stabilize the gesture before triggering actions.
            const stable = stableGesture.current[label]
            if (!stable || stable.name !== gesture) {
              stableGesture.current[label] = { name: gesture, frames: 1 }
            } else {
              stable.frames += 1
            }
            const confirmed = stableGesture.current[label]?.frames >= 5

            if (confirmed) {
              if (eqBand) {
                // Vertical position becomes a DJ-style +/-12 dB EQ knob.
                // Move hand up = boost; move hand down = cut.
                const db = clamp((0.5 - wrist.y) * 24, -12, 12)
                const now = performance.now()
                if (now - (lastEQUpdate.current[`${label}-${eqBand}`] || 0) > 45) {
                  lastEQUpdate.current[`${label}-${eqBand}`] = now
                  callbacks.current.onEQ(deck, eqBand, db)
                  setAction(`DECK ${deck} · ${eqBand.toUpperCase()} ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`)
                }
              } else if (gesture === 'FIST') {
                trigger(`${label}-play`, () => {
                  djEngine.toggle(deck)
                  setAction(`DECK ${deck} · ${djEngine.snapshot(deck)?.playing ? 'PLAY' : 'PAUSE'}`)
                })
              } else if (gesture === 'VICTORY') {
                trigger(`${label}-sync`, () => {
                  const reference = deck === 'A' ? bpm.current.B : bpm.current.A
                  const target = deck === 'A' ? bpm.current.A : bpm.current.B
                  const rate = djEngine.syncDeck(deck, target, reference)
                  if (rate) setAction(`DECK ${deck} · SYNC ${reference.toFixed(0)} BPM`)
                  else setAction(`DECK ${deck} · LOAD BOTH TRACKS TO SYNC`)
                })
              } else if (gesture === 'PINCH_CUE') {
                trigger(`${label}-cue`, () => {
                  callbacks.current.onCue(deck)
                  setAction(`DECK ${deck} · CUE`)
                })
              } else if (gesture === 'OPEN') {
                setAction(`DECK ${deck} · OPEN PALM`)
              }
            }

            previous.current[label] = point

            // Controller visualization.
            ctx.strokeStyle = '#ff5b2b'
            ctx.fillStyle = '#ff5b2b'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(wrist.x * c.width, wrist.y * c.height, 10, 0, Math.PI * 2)
            ctx.stroke()
            ctx.font = '14px monospace'
            ctx.fillText(`${label} → DECK ${deck}`, wrist.x * c.width + 15, wrist.y * c.height - 24)
            ctx.fillText(gestureLabel(gesture), wrist.x * c.width + 15, wrist.y * c.height - 6)
            if (eqBand) {
              const db = clamp((0.5 - wrist.y) * 24, -12, 12)
              ctx.fillText(`${eqBand.toUpperCase()} ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`, wrist.x * c.width + 15, wrist.y * c.height + 14)
            }
          })
        })

        setStatus('LIVE · show one or both hands')
        running.current = true

        const process = async () => {
          if (stopped || !running.current || !video.current || !mpHands) return
          if (video.current.readyState >= 2) {
            try { await mpHands.send({ image: video.current }) }
            catch (error) { setStatus(`tracking error · ${error instanceof Error ? error.message : String(error)}`) }
          }
          if (!stopped) frameId = requestAnimationFrame(() => void process())
        }
        frameId = requestAnimationFrame(() => void process())
      } catch (error) {
        running.current = false
        setStatus(`camera error · ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    void start()

    return () => {
      stopped = true
      running.current = false
      cancelAnimationFrame(frameId)
      if (mpHands) { try { void mpHands.close?.() } catch {} }
      if (stream) stream.getTracks().forEach(t => t.stop())
      if (video.current) video.current.srcObject = null
    }
  }, [enabled])

  if (!enabled) return null

  return <aside className="hand-panel">
    <div className="hand-top">
      <div><span className="eyebrow"><Hand size={13}/> HAND CONTROL</span><b>{status}</b></div>
      <button onClick={onClose} aria-label="Close hand control"><X size={14}/></button>
    </div>
    <div className="camera-wrap">
      <video ref={video} autoPlay muted playsInline  />
      <canvas ref={canvas}  />
      <div className="camera-status">LIVE · {hands} hand{hands === 1 ? '' : 's'} detected · {action}</div>
    </div>
    <div className="gesture-map">
      <span>✊ Play/Pause</span><span>✌ Sync</span><span>🤏+index Bass</span><span>🤏+middle Mid</span><span>🤏+ring Treble</span><span>🤏+pinky Cue</span><span>↕ EQ gain</span><span>↔ Jog</span>
    </div>
  </aside>
}
