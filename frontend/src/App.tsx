import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {AudioLines,CircleHelp,Hand,Link2,Music2,Play,Radio,Search,Sparkles,Wand2} from 'lucide-react'
import Deck from './components/Deck'
import HandControl from './components/HandControl'
import PlaylistPanel from './components/PlaylistPanel'
import {activateSpotifyPlayer,disconnectSpotifyWebPlayer,ensureSpotifyWebPlayer,handleSpotifyCallback,getPlaylists,getPlaylistTracks,isSpotifyWebPlayerReady,playSpotifyTrack,pauseSpotifyPlayback,spotifyLogin,spotifyLogout} from './spotify'
import {searchJamendo} from './jamendo'
import type {DeckId,DeckState,Track} from './types'
import {djEngine,makeDemoAnalysis} from './audio/DJEngine'

const API=(import.meta.env.VITE_API_BASE as string|undefined)||'http://localhost:8000'
const initialDeck=():DeckState=>({track:null,audioUrl:null,playing:false,position:0,duration:0,volume:.9,tempo:0,bass:0,mid:0,treble:0,filter:1,cue:null,loopIn:null,loopOut:null,loopOn:false,bpm:124,key:'Am',analysis:null})

export default function App(){
  const [decks,setDecks]=useState<{A:DeckState;B:DeckState}>({A:initialDeck(),B:initialDeck()}),[crossfade,setCrossfade]=useState(0),[hand,setHand]=useState(false),[spotify,setSpotify]=useState(false),[spotifyPlayerReady,setSpotifyPlayerReady]=useState(isSpotifyWebPlayerReady()),[playlistOpen,setPlaylistOpen]=useState(false),[playlists,setPlaylists]=useState<any[]>([]),[tracks,setTracks]=useState<Track[]>([]),[panelSource,setPanelSource]=useState<'spotify'|'jamendo'>('spotify'),[selectedPlaylist,setSelectedPlaylist]=useState(''),[jamendoQuery,setJamendoQuery]=useState(''),[jamendoBusy,setJamendoBusy]=useState(false),[status,setStatus]=useState('Local audio ready'),[assistant,setAssistant]=useState('Load two local tracks to generate a transition plan.'),[busy,setBusy]=useState(false)
  const previewAudio=useRef<HTMLAudioElement|null>(null)
  useEffect(()=>{const unsub=djEngine.subscribe((id,state)=>setDecks(d=>({...d,[id]:{...d[id],...state}})));void handleSpotifyCallback().then(ok=>{if(ok)void connectSpotify()}).catch(e=>setStatus(e.message));return unsub},[])
  const updateDeck=useCallback((id:DeckId,p:Partial<DeckState>)=>setDecks(d=>({...d,[id]:{...d[id],...p}})),[])
  async function connectSpotify(){try{const p=await getPlaylists();setPlaylists(p.items);setSpotify(true);setPanelSource('spotify');setPlaylistOpen(true);setStatus(`${p.items.length} playlists loaded`)}catch(e){setStatus(e instanceof Error?e.message:'Spotify connection failed')}}

  async function disconnectSpotify(){
    try{ await disconnectSpotifyWebPlayer() }catch{}
    spotifyLogout()
    setSpotify(false)
    setSpotifyPlayerReady(false)
    setPlaylists([])
    setSelectedPlaylist('')
    if(panelSource==='spotify'){ setTracks([]); setPlaylistOpen(false) }
    // Any Spotify-mapped decks lose their track reference — their real audio was
    // never in the DJ engine anyway (metadata-only), so nothing to unload.
    setDecks(d=>({
      A: d.A.track?.source==='spotify' ? {...d.A, track:null} : d.A,
      B: d.B.track?.source==='spotify' ? {...d.B, track:null} : d.B
    }))
    setStatus('Disconnected from Spotify.')
  }
  async function enableSpotifyPlayer(){try{setStatus('Starting NULLDECK Spotify Player…');await ensureSpotifyWebPlayer();await activateSpotifyPlayer();setSpotifyPlayerReady(true);setStatus('Spotify Player ready in this browser. Pick a track and press ▶.');return true}catch(e){setSpotifyPlayerReady(false);setStatus(e instanceof Error?e.message:'Could not start Spotify Player');return false}}
  async function choosePlaylist(id:string){setSelectedPlaylist(id);try{const items=await getPlaylistTracks(id);setTracks(items.map(t=>({id:t.id,title:t.name,artist:t.artists.map(a=>a.name).join(', '),album:t.album.name,artwork:t.album.images?.[1]?.url||t.album.images?.[0]?.url,durationMs:t.duration_ms,spotifyUrl:t.external_urls?.spotify,source:'spotify'})));setPanelSource('spotify');setPlaylistOpen(true);setStatus(`${items.length} tracks available`)}catch(e){setStatus(e instanceof Error?e.message:'Could not load playlist')}}

  async function searchJamendoCatalog(explicitQuery?:string){
    const q=explicitQuery??jamendoQuery
    setJamendoBusy(true)
    try{
      const results=await searchJamendo(q)
      setTracks(results.map(t=>({id:t.id,title:t.name,artist:t.artist_name,album:t.album_name,artwork:t.album_image||undefined,durationMs:t.duration*1000,streamUrl:t.audio,source:'jamendo' as const})))
      setPanelSource('jamendo')
      setPlaylistOpen(true)
      setStatus(`${results.length} Jamendo tracks found${q?` for "${q}"`:''} — Creative Commons, fully mixable.`)
    }catch(e){ setStatus(e instanceof Error?e.message:'Jamendo search failed') }
    finally{ setJamendoBusy(false) }
  }

  // Spotify: metadata/preview only — the track's real audio must stay in Spotify's
  // own player, so the deck only gets a track reference (audioUrl stays null).
  // Jamendo: the track already carries a real, CC-licensed streamUrl, so it goes
  // straight into djEngine.load() just like a local file — full EQ/scratch/mix.
  async function pickTrack(id:DeckId,t:Track){
    if(t.source==='jamendo' && t.streamUrl){
      const streamUrl=t.streamUrl
      updateDeck(id,{track:t,audioUrl:streamUrl,playing:false,position:0,duration:t.durationMs/1000,bpm:t.bpm||124,key:t.key||'Am',analysis:null})
      setPlaylistOpen(false)
      setStatus(`Loading ${t.title} into Deck ${id}…`)
      try{
        await djEngine.load(id,streamUrl,duration=>{
          updateDeck(id,{duration,track:{...t,durationMs:duration*1000}})
          const a=makeDemoAnalysis(duration,t.bpm||124)
          updateDeck(id,{analysis:a,bpm:a.bpm,key:t.key||a.key})
        })
        setStatus(`${t.title} loaded on Deck ${id} — full EQ/scratch/crossfader mixing enabled (Jamendo, Creative Commons).`)
      }catch(e){ setStatus(e instanceof Error?e.message:`Could not load ${t.title} from Jamendo`) }
      return
    }
    updateDeck(id,{track:{...t,source:'spotify'},audioUrl:null,playing:false,position:0,duration:t.durationMs/1000,bpm:t.bpm||124,key:t.key||'Am',analysis:null})
    setPlaylistOpen(false)
    setStatus(`${t.title} mapped to Deck ${id}. Spotify audio stays in Spotify; load an audio file into the deck for full EQ/scratch/mixing.`)
  }

  async function previewSpotify(t:Track){
    if(!t.id)return
    try {
      if(!spotifyPlayerReady && !(await enableSpotifyPlayer())) return
      setStatus(`Starting Spotify player: ${t.title}…`)
      await playSpotifyTrack(t.id)
      setSpotifyPlayerReady(true)
      setStatus(`Spotify is playing in the NULLDECK browser player. Deck EQ/crossfader remain reserved for local/authorized audio.`)
    } catch(e){ setStatus(e instanceof Error ? e.message : 'Spotify playback failed') }
  }

  function previewJamendo(t:Track){
    if(!t.streamUrl)return
    if(!previewAudio.current) previewAudio.current=new Audio()
    const audio=previewAudio.current
    audio.pause()
    audio.src=t.streamUrl
    void audio.play().catch(()=>{})
    setStatus(`Previewing ${t.title} (Jamendo) outside the deck…`)
  }

  async function playDeck(id:DeckId){
    const deck=decks[id]
    if(deck.track?.source==='spotify' && deck.track.id){
      try {
        if(!spotifyPlayerReady && !(await enableSpotifyPlayer())) return
        await playSpotifyTrack(deck.track.id)
        setSpotifyPlayerReady(true)
        setStatus(`${deck.track.title} is playing in the NULLDECK Spotify browser player. Load audio into Deck ${id} for DJ controls.`)
      } catch(e){ setStatus(e instanceof Error ? e.message : 'Spotify playback failed') }
      return
    }
    djEngine.play(id)
  }

  async function pauseDeck(id:DeckId){
    const deck=decks[id]
    if(deck.track?.source==='spotify'){
      try { await pauseSpotifyPlayback(); updateDeck(id,{playing:false}); setStatus(`${deck.track.title} paused`) }
      catch(e){ setStatus(e instanceof Error ? e.message : 'Spotify pause failed') }
      return
    }
    djEngine.pause(id)
  }
  function localFile(id:DeckId,file:File){const url=URL.createObjectURL(file),base=decks[id].track||{id:crypto.randomUUID(),title:file.name.replace(/\.[^/.]+$/,''),artist:'Local file',album:'Local audio',durationMs:0,source:'local' as const};updateDeck(id,{track:{...base,source:'local'},audioUrl:url,analysis:null,position:0});djEngine.load(id,url,duration=>{updateDeck(id,{duration,track:{...base,durationMs:duration*1000}});const a=makeDemoAnalysis(duration,base.bpm||124);updateDeck(id,{analysis:a,bpm:a.bpm,key:base.key||a.key})});setStatus(`Loaded ${file.name} on Deck ${id}`)}
  async function analyze(id:DeckId){const url=decks[id].audioUrl;if(!url)return;setBusy(true);try{const blob=await fetch(url).then(r=>r.blob()),form=new FormData();form.append('file',blob,`deck-${id}.audio`);const res=await fetch(`${API}/api/analyze`,{method:'POST',body:form});if(!res.ok)throw new Error(`Analyzer returned ${res.status}`);const data=await res.json();updateDeck(id,{analysis:data,bpm:data.bpm,key:data.key,duration:data.duration});setStatus(`Audio analysis complete for Deck ${id}`)}catch(e){setStatus(`${e instanceof Error?e.message:'Analysis failed'} — demo analysis remains active.`)}finally{setBusy(false)}}
  function suggest(){const a=decks.A,b=decks.B;if(!a.track||!b.track){setAssistant('Load two tracks first. The assistant will compare BPM, key, energy and section timing.');return}const ratio=b.bpm?a.bpm/b.bpm:1,compatible=Math.abs(a.bpm-b.bpm)<=8,high=a.analysis?.sections.find(s=>s.label==='HIGH ENERGY'),intro=b.analysis?.sections.find(s=>s.label==='INTRO'),start=high?.start??Math.max(0,a.duration-32),align=Math.round(16*Math.max(.5,Math.min(1.5,ratio))),fmt=(s:number)=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;setAssistant(`Suggested transition: Deck A → Deck B\nStart around ${fmt(start)} · ${compatible?'BPM-compatible':`tempo-match ${ratio.toFixed(2)}× first`}\nAlign ${align} beats · reduce Deck A bass · bring in Deck B intro · crossfade over 8 bars.${intro?`\nDeck B intro detected at ${fmt(intro.start)}.`:''}`)}
  function setXF(v:number){setCrossfade(v);djEngine.crossfade(v)}
  const selected=useMemo(()=>playlists.find(p=>p.id===selectedPlaylist),[playlists,selectedPlaylist])
  return <main className="app">
    <header className="topbar"><div><div className="brand">NULL<span>DECK</span></div><p>Touchless two-deck mixing. Load local tracks, ride the crossfader with your hands, and let the analyzer show where each track wants to transition.</p></div><div className="top-actions"><button className="secondary" onClick={()=>setHand(v=>!v)}><Hand size={14}/> {hand?'Disable hand control':'Enable hand control'}</button>{spotify&&<button className="secondary" onClick={()=>void enableSpotifyPlayer()}><Play size={13}/> {spotifyPlayerReady?'Spotify Player Ready':'Enable Spotify Player'}</button>}<button className="spotify-button" onClick={()=>spotify?setPlaylistOpen(true):void spotifyLogin()}><Link2 size={14}/> {spotify?'Spotify playlists':'Connect Spotify'}</button>{spotify&&<button className="secondary" onClick={()=>void disconnectSpotify()}>Disconnect Spotify</button>}</div></header>
    <section className="library-bar"><div className="library-left"><span className="eyebrow">SOURCE</span>{spotify?<><select value={selectedPlaylist} onChange={e=>void choosePlaylist(e.target.value)}><option value="">Choose playlist…</option>{playlists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>{selected&&<span className="muted">{selected.tracks?.total??0} tracks</span>}</>:<span className="muted">Spotify metadata + Jamendo (CC) + local audio</span>}</div><div className="library-right"><div className="search-box"><Search size={12}/><input value={jamendoQuery} onChange={e=>setJamendoQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') void searchJamendoCatalog()}} placeholder="Search Jamendo (Creative Commons)…"/></div><button className="secondary" onClick={()=>void searchJamendoCatalog()} disabled={jamendoBusy}><Radio size={12}/> {jamendoBusy?'Searching…':'Search Jamendo'}</button></div><div className="status"><span className="dot"/>{busy?'Analyzing…':status}</div></section>
    <section className="decks"><Deck id="A" deck={decks.A} onChange={p=>updateDeck('A',p)} onFile={f=>localFile('A',f)} onAnalyze={()=>void analyze('A')} onSync={()=>{const r=djEngine.syncDeck('A',decks.A.bpm,decks.B.bpm);setStatus(r?`Deck A synced to ${decks.B.bpm.toFixed(1)} BPM`:'Load both analyzed tracks first')}} onPlay={()=>void playDeck('A')} onPause={()=>void pauseDeck('A')}/><div className="mixer-column"><div className="mixer-title">CROSSFADER</div><div className="crossfader-vertical"><div className="cross-track"/><div className="cross-thumb" style={{top:`${(crossfade+1)*50}%`}}/></div><input className="cross-slider" type="range" min="-1" max="1" step=".01" value={crossfade} onChange={e=>setXF(+e.target.value)}/><div className="hand-map"><Hand size={16}/><b>Hand control</b><span>X-position drives crossfader</span><span>Height drives deck volume</span><span>Motion drives jog</span><span>Pinch sets cue</span></div><button className="sync" onClick={()=>{void djEngine.syncBToA(decks.A.bpm,decks.B.bpm);setStatus('Deck B tempo matched to Deck A')}}><AudioLines size={13}/> Sync beats</button></div><Deck id="B" deck={decks.B} onChange={p=>updateDeck('B',p)} onFile={f=>localFile('B',f)} onAnalyze={()=>void analyze('B')} onSync={()=>{const r=djEngine.syncDeck('B',decks.B.bpm,decks.A.bpm);setStatus(r?`Deck B synced to ${decks.A.bpm.toFixed(1)} BPM`:'Load both analyzed tracks first')}} onPlay={()=>void playDeck('B')} onPause={()=>void pauseDeck('B')}/></section>
    <section className="assistant"><div className="assistant-title"><Sparkles size={14}/> AI TRANSITION ASSISTANT</div><div className="assistant-body"><pre>{assistant}</pre><button onClick={suggest}><Wand2 size={13}/> Suggest transition</button></div></section>
    <section className="feature-strip"><div><Music2 size={14}/><span>Local waveform analysis</span></div><div><Hand size={14}/><span>MediaPipe hand tracking</span></div><div><CircleHelp size={14}/><span>Spotify browser preview</span></div><div><Radio size={14}/><span>Jamendo CC mixing</span></div><div><Play size={14}/><span>Real Web Audio mixing</span></div></section>
    <PlaylistPanel open={playlistOpen} tracks={tracks} source={panelSource} onClose={()=>setPlaylistOpen(false)} onPick={pickTrack} onPreview={panelSource==='jamendo'?previewJamendo:previewSpotify}/>
    <HandControl enabled={hand} onClose={()=>setHand(false)} onCrossfade={setXF} onDeckVolume={(id,v)=>{updateDeck(id,{volume:v});djEngine.setVolume(id,v)}} onEQ={(id,band,v)=>{updateDeck(id,{[band]:v});djEngine.setEQ(id,band,v)}} onCue={id=>{djEngine.cue(id);updateDeck(id,{cue:decks[id].position})}} bpmA={decks.A.bpm} bpmB={decks.B.bpm}/>
  </main>
}
