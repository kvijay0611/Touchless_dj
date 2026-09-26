import React, { useEffect, useRef } from 'react'
import type { Analysis } from '../types'

export default function Waveform({analysis, position, onSeek}:{analysis:Analysis|null;position:number;onSeek:(s:number)=>void}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1
    canvas.width = r.width*dpr; canvas.height = r.height*dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr,dpr)
    const w=r.width,h=r.height
    ctx.fillStyle='#10110f'; ctx.fillRect(0,0,w,h)
    if (!analysis) {
      ctx.fillStyle='#343631'; ctx.font='10px ui-monospace,monospace'
      ctx.fillText('— no local audio analysis —',10,h/2); return
    }
    for (const s of analysis.sections) {
      const x=s.start/analysis.duration*w, sw=(s.end-s.start)/analysis.duration*w
      ctx.fillStyle=s.energy>.75?'rgba(255,91,43,.14)':'rgba(255,255,255,.035)'
      ctx.fillRect(x,0,sw,h)
      ctx.fillStyle=s.energy>.75?'#ff5b2b':'#7f827a'
      ctx.font='8px ui-monospace,monospace'; ctx.fillText(s.label,x+5,12)
    }
    ctx.strokeStyle='#e7e8e2'; ctx.lineWidth=1; ctx.beginPath()
    analysis.waveform.forEach((v,i)=>{const x=i/(analysis.waveform.length-1)*w,amp=v*h*.38;ctx.moveTo(x,h/2-amp);ctx.lineTo(x,h/2+amp)})
    ctx.stroke()
    ctx.strokeStyle='rgba(255,91,43,.38)'
    for (const beat of analysis.beats) { const x=beat/analysis.duration*w;ctx.beginPath();ctx.moveTo(x,18);ctx.lineTo(x,h-8);ctx.stroke() }
    const px=Math.min(w,Math.max(0,position/analysis.duration*w))
    ctx.strokeStyle='#ff5b2b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke()
    ctx.fillStyle='#ff5b2b';ctx.beginPath();ctx.arc(px,6,3,0,Math.PI*2);ctx.fill()
  },[analysis,position])
  return <canvas ref={ref} className="waveform" onPointerDown={e=>{
    if(!analysis)return
    const r=e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*analysis.duration)
  }} />
}
