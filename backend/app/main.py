from __future__ import annotations

import os
import tempfile
from pathlib import Path

import httpx
import librosa
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="NULLDECK AI DJ API", version="1.0.0")
origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# Jamendo: Creative Commons catalog. Unlike Spotify, Jamendo's public API returns a
# direct, streamable audio file per track (no DRM), so tracks from here are legally
# safe to feed into the frontend's Web Audio DJ engine. The client_id is kept here
# (server-side) rather than in the frontend bundle. Get one free at
# https://devportal.jamendo.com/
JAMENDO_CLIENT_ID = os.getenv("JAMENDO_CLIENT_ID", "")
JAMENDO_BASE = "https://api.jamendo.com/v3.0"

def norm(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    if x.size == 0: return x
    lo, hi = float(x.min()), float(x.max())
    return np.zeros_like(x) if hi - lo < 1e-8 else (x - lo) / (hi - lo)

def estimate_sections(y: np.ndarray, sr: int, duration: float):
    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    frames = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    energy = norm(rms)
    bins = np.linspace(0, duration, 33)
    values = [float(energy[(frames >= bins[i]) & (frames < bins[i+1])].mean()) if ((frames >= bins[i]) & (frames < bins[i+1])).any() else 0 for i in range(32)]
    sections = []
    intro_end = min(duration*.14, 32)
    outro_start = max(duration-min(duration*.14,32), duration*.72)
    peak = int(np.argmax(values)) if values else 0
    peak_start, peak_end = bins[peak], bins[min(peak+4, len(bins)-1)]
    if intro_end > 0: sections.append({"start":0,"end":intro_end,"label":"INTRO","energy":.35})
    if peak_start > intro_end+4: sections.append({"start":peak_start,"end":peak_end,"label":"HIGH ENERGY","energy":1.0})
    chorus_start=max(intro_end,duration*.30); chorus_end=min(outro_start,chorus_start+max(16,duration*.12))
    if chorus_end>chorus_start: sections.append({"start":chorus_start,"end":chorus_end,"label":"HOOK / CHORUS","energy":.78})
    if outro_start<duration: sections.append({"start":outro_start,"end":duration,"label":"OUTRO","energy":.42})
    return sorted(sections,key=lambda s:s["start"])

@app.get("/health")
def health():
    return {"ok": True, "service": "nulldeck"}

@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    suffix = Path(file.filename or ".audio").suffix or ".audio"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        path = tmp.name
    try:
        y, sr = librosa.load(path, sr=None, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))
        if duration <= 0: raise ValueError("Audio has no duration")
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
        bpm = float(np.asarray(tempo).reshape(-1)[0]) if np.asarray(tempo).size else 120.0
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        target=1600; hop=max(256,len(y)//target)
        waveform=norm(np.array([float(np.max(np.abs(y[i:i+hop]))) if len(y[i:i+hop]) else 0 for i in range(0,len(y),hop)]))
        chroma=librosa.feature.chroma_cqt(y=y,sr=sr)
        keys=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
        key=keys[int(np.argmax(chroma.mean(axis=1)))]
        return {"bpm":round(bpm,2),"key":key,"duration":round(duration,3),"beats":[round(float(x),4) for x in beat_times[:10000]],"waveform":[round(float(x),5) for x in waveform.tolist()],"sections":estimate_sections(y,sr,duration)}
    finally:
        try: os.unlink(path)
        except OSError: pass

@app.post("/api/stems")
async def stems(file: UploadFile = File(...)):
    return {"status":"optional","message":"Add Demucs in a dedicated worker for legally authorized local audio."}

@app.get("/api/jamendo/search")
async def jamendo_search(query: str = "", limit: int = 30):
    if not JAMENDO_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Set JAMENDO_CLIENT_ID on the backend to enable Jamendo search.")
    params = {
        "client_id": JAMENDO_CLIENT_ID,
        "format": "json",
        "limit": str(min(max(limit, 1), 50)),
        "include": "musicinfo",
        "audioformat": "mp32",
        "boost": "popularity_total",
    }
    if query.strip():
        # "search" does a full-text match across track name, artist, album and tags —
        # much more forgiving than "namesearch" (track title only), which was
        # returning zero results for perfectly normal queries like "lover".
        params["search"] = query.strip()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{JAMENDO_BASE}/tracks/", params=params)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Jamendo: {exc}") from exc
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Jamendo API error ({resp.status_code})")
    data = resp.json()
    results = [
        {
            "id": str(t["id"]),
            "name": t.get("name") or "Untitled",
            "artist_name": t.get("artist_name") or "Unknown artist",
            "album_name": t.get("album_name") or "",
            "album_image": t.get("album_image") or t.get("image"),
            "duration": t.get("duration") or 0,
            "audio": t.get("audio"),
            "audiodownload": t.get("audiodownload"),
        }
        for t in data.get("results", [])
        if t.get("audio")
    ]
    return {"results": results}