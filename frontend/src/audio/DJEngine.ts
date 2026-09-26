import type { Analysis, DeckId } from '../types'

type Band = 'bass' | 'mid' | 'treble'
type Listener = (id: DeckId, state: { playing: boolean; position: number; duration: number }) => void

interface DeckNodes {
  worklet: AudioWorkletNode
  trim: GainNode
  low: BiquadFilterNode
  mid: BiquadFilterNode
  high: BiquadFilterNode
  filter: BiquadFilterNode
  channel: GainNode
  crossfade: GainNode
  analyser: AnalyserNode
  buffer: AudioBuffer
  position: number
  playing: boolean
  rate: number
  cue: number | null
  loopIn: number | null
  loopOut: number | null
  loopOn: boolean
}

const clamp = (v:number,min:number,max:number) => Math.max(min,Math.min(max,v))

export class DJEngine {
  private ctx: AudioContext | null = null
  private decks: Partial<Record<DeckId, DeckNodes>> = {}
  private listeners: Listener[] = []
  private workletReady = false
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null

  private async ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      await this.ctx.audioWorklet.addModule(new URL('./vinyl-worklet.ts', import.meta.url))
      this.master = this.ctx.createGain()
      this.master.gain.value = .92
      this.limiter = this.ctx.createDynamicsCompressor()
      this.limiter.threshold.value = -1
      this.limiter.knee.value = 0
      this.limiter.ratio.value = 20
      this.limiter.attack.value = .001
      this.limiter.release.value = .08
      this.master.connect(this.limiter).connect(this.ctx.destination)
      this.workletReady = true
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    return this.ctx
  }

  subscribe(fn: Listener) {
    this.listeners.push(fn)
    return () => { this.listeners = this.listeners.filter(x => x !== fn) }
  }

  private emit(id: DeckId) {
    const d = this.decks[id]
    if (!d) return
    this.listeners.forEach(fn => fn(id, { playing:d.playing, position:d.position, duration:d.buffer.duration }))
  }

  async load(id: DeckId, url: string, onReady?: (duration:number) => void) {
    const ctx = await this.ensureContext()
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not load audio (${response.status})`)
    const arrayBuffer = await response.arrayBuffer()
    const buffer = await ctx.decodeAudioData(arrayBuffer)

    const old = this.decks[id]
    old?.worklet.disconnect()

    const worklet = new AudioWorkletNode(ctx, 'nulldeck-vinyl-deck', {
      outputChannelCount: [2],
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: 2
    })
    const trim = ctx.createGain()
    const low = ctx.createBiquadFilter()
    const mid = ctx.createBiquadFilter()
    const high = ctx.createBiquadFilter()
    const filter = ctx.createBiquadFilter()
    const channel = ctx.createGain()
    const crossfade = ctx.createGain()
    const analyser = ctx.createAnalyser()

    low.type='lowshelf'; low.frequency.value=180
    mid.type='peaking'; mid.frequency.value=1000; mid.Q.value=.8
    high.type='highshelf'; high.frequency.value=5000
    filter.type='lowpass'; filter.frequency.value=20000
    trim.gain.value=.9
    channel.gain.value=.9
    crossfade.gain.value=.707
    analyser.fftSize=1024

    worklet.connect(trim).connect(low).connect(mid).connect(high).connect(filter).connect(channel).connect(crossfade).connect(analyser).connect(this.master!)

    const left = buffer.getChannelData(0).slice()
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice()
    worklet.port.postMessage({type:'load',left,right,sampleRate:buffer.sampleRate}, [left.buffer,right.buffer])

    const deck: DeckNodes = {
      worklet, trim, low, mid, high, filter, channel, crossfade, analyser,
      buffer, position:0, playing:false, rate:1, cue:null, loopIn:null, loopOut:null, loopOn:false
    }
    worklet.port.onmessage = event => {
      if (event.data?.type !== 'state') return
      deck.position = clamp(Number(event.data.position)||0,0,buffer.duration)
      deck.playing = Boolean(event.data.playing)
      if (deck.loopOn && deck.loopIn !== null && deck.loopOut !== null && deck.position >= deck.loopOut) {
        deck.position = deck.loopIn
        worklet.port.postMessage({type:'seek',position:deck.loopIn})
      }
      this.emit(id)
    }
    this.decks[id] = deck
    this.applyCrossfader()
    onReady?.(buffer.duration)
    this.emit(id)
  }

  private post(id:DeckId,message:unknown) { this.decks[id]?.worklet.port.postMessage(message) }

  async play(id:DeckId) {
    await this.ensureContext()
    const d=this.decks[id]
    if (!d) return
    d.playing=true
    this.post(id,{type:'transport',playing:true})
    this.emit(id)
  }

  pause(id:DeckId) {
    const d=this.decks[id]
    if (!d) return
    d.playing=false
    this.post(id,{type:'transport',playing:false})
    this.emit(id)
  }

  toggle(id:DeckId) {
    const d=this.decks[id]
    if (!d) return
    if (d.playing) this.pause(id); else void this.play(id)
  }

  seek(id:DeckId,seconds:number) {
    const d=this.decks[id]
    if (!d) return
    d.position=clamp(seconds,0,d.buffer.duration)
    this.post(id,{type:'seek',position:d.position})
    this.emit(id)
  }

  nudge(id:DeckId,delta:number) {
    const d=this.decks[id]
    if (!d) return
    d.position=clamp(d.position+delta,0,d.buffer.duration)
    this.post(id,{type:'nudge',delta})
    this.emit(id)
  }

  setTempo(id:DeckId,percent:number) {
    const d=this.decks[id]
    if (!d) return
    d.rate=clamp(1+percent/100,.5,1.5)
    this.post(id,{type:'rate',rate:d.rate})
  }

  setVolume(id:DeckId,value:number) {
    const d=this.decks[id]
    if (d) d.channel.gain.setTargetAtTime(clamp(value,0,1),this.ctx?.currentTime||0,.015)
  }

  setEQ(id:DeckId,band:Band,db:number) {
    const d=this.decks[id]
    if (!d) return
    const target=band==='bass'?d.low:band==='mid'?d.mid:d.high
    target.gain.setTargetAtTime(clamp(db,-12,12),this.ctx?.currentTime||0,.015)
  }

  setFilter(id:DeckId,normalized:number) {
    const d=this.decks[id]
    if (!d) return
    d.filter.frequency.setTargetAtTime(180*Math.pow(20000/180,clamp(normalized,0,1)),this.ctx?.currentTime||0,.02)
  }

  setCue(id:DeckId,position:number) {
    const d=this.decks[id]
    if (d) d.cue=clamp(position,0,d.buffer.duration)
  }

  cue(id:DeckId) {
    const d=this.decks[id]
    if (!d) return
    if (d.playing) { if (d.cue!==null) this.seek(id,d.cue); this.pause(id) }
    else d.cue=d.position
  }

  setLoop(id:DeckId,loopIn:number|null,loopOut:number|null,on:boolean) {
    const d=this.decks[id]
    if (!d) return
    d.loopIn=loopIn; d.loopOut=loopOut; d.loopOn=on
  }

  crossfade(value:number) {
    const x=clamp(value,-1,1)
    const a=this.decks.A,b=this.decks.B
    if(a) a.crossfade.gain.setTargetAtTime(Math.cos((x+1)*Math.PI/4),this.ctx?.currentTime||0,.01)
    if(b) b.crossfade.gain.setTargetAtTime(Math.sin((x+1)*Math.PI/4),this.ctx?.currentTime||0,.01)
  }

  private applyCrossfader(){ this.crossfade(0) }

  syncDeck(target:DeckId,targetBpm:number,referenceBpm:number):number|null {
    const d=this.decks[target]
    if(!d||!targetBpm||!referenceBpm)return null
    const rate=clamp(referenceBpm/targetBpm,.5,1.5)
    d.rate=rate
    this.post(target,{type:'rate',rate})
    return rate
  }

  syncBToA(bpmA:number,bpmB:number){return this.syncDeck('B',bpmB,bpmA)}

  snapshot(id:DeckId){
    const d=this.decks[id]
    return d?{playing:d.playing,position:d.position,duration:d.buffer.duration}:null
  }
}

export const djEngine=new DJEngine()

export function makeDemoAnalysis(duration:number,bpm=124):Analysis{
  const points=Math.max(32,Math.floor(duration*3))
  const waveform=Array.from({length:points},(_,i)=>Math.min(1,.18+.45*Math.abs(Math.sin(i*.31))+.15*Math.abs(Math.sin(i*.07))+(i%16<2?.2:0)))
  const beatEvery=60/bpm
  const beats:number[]=[]
  for(let t=0;t<duration;t+=beatEvery)beats.push(t)
  const q=duration/4
  return {bpm,key:'Am',duration,beats,waveform,sections:[
    {start:0,end:q,label:'INTRO',energy:.35},{start:q,end:q*2,label:'HOOK',energy:.7},{start:q*2,end:q*3,label:'HIGH ENERGY',energy:1},{start:q*3,end:duration,label:'OUTRO',energy:.42}
  ]}
}
