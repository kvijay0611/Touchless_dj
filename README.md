# NULLDECK — AI DJ Workstation

A browser-first two-deck DJ workstation based on the supplied reference UI. It combines legal local-audio playback/mixing, a Jamendo (Creative Commons) streaming catalog that's fully mixable, Spotify playlist metadata discovery, waveform analysis, real-time hand tracking, and a transition assistant.

## Where each music source can go

| Source | What it gives you | Goes into the DJ engine? |
|---|---|---|
| **Local file upload** | Full-length audio you're authorized to use | Yes — full EQ/scratch/tempo/crossfader |
| **Jamendo** | Full-length, Creative Commons-licensed catalog, searched live | Yes — same as local audio, real streamable file |
| **Spotify** | Your playlists/tracks for discovery, playable in Spotify's own in-browser player | No — metadata/preview only (see below) |

## Spotify constraint

Spotify is used for playlist/track metadata discovery only. The mixing/analysis path operates on audio files the user is legally authorized to process (local uploads, Jamendo). Spotify audio is not downloaded, extracted, remixed, synchronized, or sent to AI/audio-analysis models — Spotify's Web API/SDK never exposes raw catalog audio to third parties, and their developer terms separately prohibit DJ-style mixing of the catalog. Playing a Spotify track uses Spotify's own Web Playback SDK player embedded in the page.

## Included

- Two independent DJ decks
- Real Web Audio API playback
- Crossfader and independent deck volume
- Tempo/pitch control
- 3-band EQ and filter
- Cue points and loops
- Canvas waveform with playhead, beat grid and section highlights
- Jog/scratch interaction
- Beat-sync control
- Jamendo (Creative Commons) search — results load as real, fully mixable deck audio
- Spotify OAuth 2.0 PKCE metadata integration + Web Playback SDK preview player
- Playlist/search browser with unified A/B deck picker
- Webcam hand tracking with MediaPipe Hands (legacy JS API, loaded from CDN)
- Continuous gesture control
- Fast local-audio analysis API using librosa (real BPM/key/section detection, not a stub)
- Optional stem-separation extension point

## Run

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

Python 3.11+:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Copy `frontend/.env.example` to `frontend/.env.local` and set:

```env
VITE_API_BASE=http://localhost:8000
VITE_SPOTIFY_CLIENT_ID=your_client_id
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
```

Register that exact redirect URI in your Spotify app. PKCE is used so the browser does not contain a client secret.

Scopes:
- `playlist-read-private`
- `playlist-read-collaborative`
- `streaming`, `user-read-playback-state`, `user-modify-playback-state` (for the in-browser preview player)

### Jamendo setup

Get a free `client_id` at https://devportal.jamendo.com/ and set it as a **backend** environment variable (kept server-side, never shipped to the browser):

```bash
# macOS/Linux
export JAMENDO_CLIENT_ID=your_client_id
uvicorn app.main:app --reload --port 8000
```

Or, running via Docker Compose, set it directly in `docker-compose.yml` under the `backend` service's `environment:` block. Without this variable, `/api/jamendo/search` returns a 500 with a message telling you to set it — Spotify and local-file mixing work fine without it.

## Workflow

1. Search Jamendo (top bar) for a Creative Commons track, or connect Spotify for playlist discovery.
2. Pick a track for Deck A and another for Deck B — Jamendo tracks load with full audio immediately; Spotify tracks attach as metadata (open the Spotify Web Player to actually hear them).
3. Attach any authorized local audio files instead/as well.
4. Analyze the loaded tracks.
5. Play, seek, loop, EQ, tempo-match and crossfade.
6. Enable hand control and allow webcam access.
7. Use the transition assistant for a BPM/energy/structure-based suggestion.

## Production deployment

Deploy the frontend to Vercel or another static host and the FastAPI backend to a container host. Use HTTPS/WSS, strict CORS, authentication, quotas and object storage for uploaded audio. Run heavy stem separation in a worker/GPU service rather than inside the API process.

## Current Spotify playback milestone

The current build uses Spotify's Web Playback SDK for browser playback. Connect Spotify, open a playlist, and choose A or B for a track. The selected track is started on the NULLDECK Spotify Web Player. Spotify Premium is required.

Because Spotify's SDK provides Spotify-controlled playback rather than an unrestricted raw audio source, this milestone does not route Spotify audio through the local Web Audio `DJEngine`. Local MP3/WAV/etc. files continue to use the full Web Audio two-deck mixer.

After changing Spotify scopes, reconnect Spotify so the new OAuth permissions are granted.

## Recent changes

- **Added Jamendo integration** (`frontend/src/jamendo.ts`, `/api/jamendo/search` in the backend, `PlaylistPanel` now supports both `spotify` and `jamendo` sources): a real, fully mixable "stream any (CC-licensed) song" path, alongside local files and Spotify metadata.
- **Removed the unused `@mediapipe/tasks-vision` npm dependency.** `HandControl.tsx` has always loaded the legacy `@mediapipe/hands` package from a CDN `<script>` tag at runtime — the npm package was dead weight that didn't match what the code actually used.
- **Removed the `/ws/gestures` WebSocket stub.** Nothing in the frontend called it (all gesture recognition runs client-side via MediaPipe), and it only echoed a hardcoded response — it was a decorative extension point, not working functionality.
