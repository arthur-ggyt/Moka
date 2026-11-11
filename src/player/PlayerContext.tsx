import { useCallback, useRef, useState, createContext, useContext, useEffect, type ReactNode } from "react"
import { decodeMoka } from "../moka"
import type { MokaManifest } from "../moka"
export type MediaView = "cover"|"clip"|"lyrics"
export interface LoadedTrack { id:string; fileName:string; manifest:MokaManifest; audioUrl:string; coverUrl:string|null; video1Url:string|null; video2Url:string|null; sourceBlob?:Blob; coverBlob?:Blob }
interface PlayerState {
  track: LoadedTrack|null
  queue: LoadedTrack[]
  queueIndex: number
  isPlaying:boolean
  currentTime:number
  duration:number
  volume:number
  mediaView:MediaView
  error:string|null
  loadMokaFile:(f:File|Blob,n:string)=>Promise<void>
  loadMultiple:(files:FileList|File[])=>Promise<void>
  playQueue:(tracks:LoadedTrack[], idx?:number)=>void
  playTrack:(t:LoadedTrack)=>void
  next:()=>void
  prev:()=>void
  addToQueue:(t:LoadedTrack)=>void
  removeFromQueue:(id:string)=>void
  clearQueue:()=>void
  togglePlay:()=>void
  seek:(t:number)=>void
  skip:(d:number)=>void
  setVolume:(v:number)=>void
  setMediaView:(v:MediaView)=>void
  getAudioElement:()=>HTMLAudioElement
  clearError:()=>void
  loopActive:boolean
  setLoopActive:(b:boolean)=>void
}
const PlayerContext = createContext<PlayerState|null>(null)
export function PlayerProvider({children}:{children:ReactNode}){
  const audioRef = useRef<HTMLAudioElement|null>(null)
  if(!audioRef.current){ audioRef.current=new Audio(); audioRef.current.preload="auto" }
  const audio = audioRef.current
  const [queue,setQueue]=useState<LoadedTrack[]>([])
  const [queueIndex,setQueueIndex]=useState(-1)
  const [track,setTrack]=useState<LoadedTrack|null>(null)
  const [isPlaying,setIsPlaying]=useState(false)
  const [currentTime,setCurrentTime]=useState(0)
  const [duration,setDuration]=useState(0)
  const [volume,setVolumeState]=useState(1)
  const [mediaView,setMediaView]=useState<MediaView>("cover")
  const [error,setError]=useState<string|null>(null)

  const applyTrack = useCallback((t:LoadedTrack)=>{
    setTrack(t)
    setMediaView("cover")
    setCurrentTime(0); setDuration(0)
    audio.src=t.audioUrl
    void audio.play().catch(()=>{})
  },[audio])

  useEffect(()=>{
    const onTime=()=>setCurrentTime(audio.currentTime)
    const onDuration=()=>setDuration(audio.duration||0)
    const onPlay=()=>setIsPlaying(true)
    const onPause=()=>setIsPlaying(false)
    const onEnded=()=>{
      setIsPlaying(false)
      // auto next
      setQueueIndex(i=>{
        const nextIdx = i+1
        const nextTrack = queue[nextIdx]
        if(nextTrack){
          setTimeout(()=> applyTrack(nextTrack), 50)
          return nextIdx
        }
        return i
      })
    }
    audio.addEventListener("timeupdate",onTime); audio.addEventListener("loadedmetadata",onDuration); audio.addEventListener("durationchange",onDuration); audio.addEventListener("play",onPlay); audio.addEventListener("pause",onPause); audio.addEventListener("ended",onEnded)
    return ()=>{ audio.removeEventListener("timeupdate",onTime); audio.removeEventListener("loadedmetadata",onDuration); audio.removeEventListener("durationchange",onDuration); audio.removeEventListener("play",onPlay); audio.removeEventListener("pause",onPause); audio.removeEventListener("ended",onEnded)}
  },[audio, queue, applyTrack])

  const makeTrack = async (file:File|Blob,fileName:string):Promise<LoadedTrack>=>{
    const moka=await decodeMoka(file)
    return {
      id: Math.random().toString(36).slice(2,9)+Date.now().toString(36),
      fileName,
      manifest:moka.manifest,
      audioUrl: URL.createObjectURL(moka.audioBlob),
      coverUrl: moka.coverBlob?URL.createObjectURL(moka.coverBlob):null,
      coverBlob: moka.coverBlob ?? undefined,
      video1Url: moka.video1Blob?URL.createObjectURL(moka.video1Blob):null,
      video2Url: moka.video2Blob?URL.createObjectURL(moka.video2Blob):null,
      sourceBlob: file instanceof Blob ? file : undefined
    }
  }

  const loadMokaFile=useCallback(async(file:File|Blob,fileName:string)=>{
    setError(null)
    try{
      const nt=await makeTrack(file,fileName)
      setTrack(prev=>{
        if(prev){ URL.revokeObjectURL(prev.audioUrl); if(prev.coverUrl) URL.revokeObjectURL(prev.coverUrl); if(prev.video1Url) URL.revokeObjectURL(prev.video1Url); if(prev.video2Url) URL.revokeObjectURL(prev.video2Url)}
        return prev
      })
      // also push to queue if queue empty, else replace queue with single
      setQueue([nt]); setQueueIndex(0)
      setTrack(nt); setMediaView("cover"); setCurrentTime(0); setDuration(0); audio.src=nt.audioUrl; await audio.play().catch(()=>{})
    }catch(e){ setError(e instanceof Error?e.message:"Impossible de lire ce fichier MOKA.") }
  },[audio])

  const loadMultiple=useCallback(async(files:FileList|File[])=>{
    const arr = Array.from(files as FileList)
    const tracks: LoadedTrack[]=[]
    for(const f of arr){
      try{ tracks.push(await makeTrack(f,f.name)) }catch{}
    }
    if(tracks.length){
      setQueue(tracks); setQueueIndex(0); applyTrack(tracks[0])
    }
  },[applyTrack])

  const playQueue=useCallback((tracks:LoadedTrack[], idx=0)=>{
    if(!tracks.length) return
    setQueue(tracks); setQueueIndex(idx); applyTrack(tracks[idx])
  },[applyTrack])

  const playTrack=useCallback((t:LoadedTrack)=>{
    const idx = queue.findIndex(x=>x.id===t.id)
    if(idx>=0){ setQueueIndex(idx); applyTrack(t)}
    else { setQueue(q=>[...q,t]); setQueueIndex(queue.length); applyTrack(t)}
  },[queue, applyTrack])

  const next=useCallback(()=>{
    const idx = queueIndex+1
    if(idx < queue.length) { setQueueIndex(idx); applyTrack(queue[idx])}
  },[queue,queueIndex,applyTrack])
  const prev=useCallback(()=>{
    const idx = queueIndex-1
    if(idx>=0){ setQueueIndex(idx); applyTrack(queue[idx])}
    else { audio.currentTime=0 }
  },[queue,queueIndex,applyTrack,audio])
  const addToQueue=useCallback((t:LoadedTrack)=> setQueue(q=>[...q,t]),[])
  const removeFromQueue=useCallback((id:string)=> setQueue(q=> q.filter(x=>x.id!==id)),[])
  const clearQueue=useCallback(()=>{ setQueue([]); setQueueIndex(-1)},[])

  const togglePlay=useCallback(()=>{ if(!audio.src) return; if(audio.paused) void audio.play(); else audio.pause()},[audio])
  const seek=useCallback((t:number)=>{ if(!audio.src) return; audio.currentTime=Math.max(0,Math.min(t,audio.duration||t)); setCurrentTime(audio.currentTime)},[audio])
  const skip=useCallback((d:number)=>{ if(!audio.src) return; audio.currentTime=Math.max(0,Math.min(audio.currentTime+d,audio.duration||0))},[audio])
  const setVolume=useCallback((v:number)=>{ audio.volume=v; setVolumeState(v)},[audio])
  const getAudioElement=useCallback(()=>audio,[audio])
  const clearError=useCallback(()=>setError(null),[])

  // ============================================================
  // MODE LOOP — l'intro (0 → start) est jouée une seule fois,
  // puis la section [start, end] est répétée indéfiniment :
  // la fin originale de la chanson n'est jamais atteinte.
  // ============================================================
  const [loopActive, setLoopActive] = useState(false)
  const loopMeta = track?.manifest.loop ?? null

  useEffect(()=>{
    if(!loopActive || !loopMeta) return
    const { start, end } = loopMeta
    if(!(end > start)) return
    // Surveillance fine (80 ms) : le rebouclage est quasi imperceptible.
    const iv = window.setInterval(()=>{
      if(!audio.src || audio.paused) return
      if(audio.currentTime >= end - 0.04){
        audio.currentTime = start
      }
    }, 80)
    return ()=>window.clearInterval(iv)
  },[loopActive, loopMeta, audio])

  // ============================================================
  // MEDIA SESSION — envoie la piste courante aux widgets Apple
  // (écran verrouillé, centre de contrôle, widget Apple Music),
  // à Android et aux lecteurs système du navigateur.
  // ============================================================
  const [artwork, setArtwork] = useState<string | null>(null)

  // Pochette convertie en data URL 512×512 (les blob: URL ne sont pas
  // affichées par les widgets ; la data URL, si).
  useEffect(()=>{
    const blob = track?.coverBlob
    if(!blob){ setArtwork(null); return }
    let cancelled = false
    let url: string | null = null
    const img = new Image()
    img.onload = ()=>{
      if(cancelled) return
      const size = 512
      const canvas = document.createElement("canvas")
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext("2d")
      if(!ctx){ return }
      const s = Math.min(img.naturalWidth, img.naturalHeight)
      ctx.drawImage(img, (img.naturalWidth - s)/2, (img.naturalHeight - s)/2, s, s, 0, 0, size, size)
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85)
      if(!cancelled) setArtwork(dataUrl)
    }
    img.onerror = ()=>{ if(!cancelled) setArtwork(null) }
    url = URL.createObjectURL(blob)
    img.src = url
    return ()=>{ cancelled = true; if(url) URL.revokeObjectURL(url) }
  },[track?.id, track?.coverBlob])

  // Métadonnées : titre, artiste, album + image de l'album
  useEffect(()=>{
    if(!("mediaSession" in navigator)) return
    const ms = navigator.mediaSession as any
    const MSM = (window as any).MediaSessionMetadata
    if(!track){ try{ ms.metadata = null }catch{}; return }
    const m = track.manifest.metadata
    if(!MSM) return
    try{
      ms.metadata = new MSM({
        title: m.title || track.fileName,
        artist: m.artist || "MOKA",
        album: m.album || "",
        artwork: artwork ? [{ src: artwork, sizes: "512x512", type: "image/jpeg" }] : []
      })
    }catch{}
  },[track, artwork])

  // Position / durée pour la barre du widget
  useEffect(()=>{
    if(!("mediaSession" in navigator) || !track || !duration || !Number.isFinite(duration)) return
    try{
      navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: Math.max(0, Math.min(currentTime, duration)) })
    }catch{}
  },[currentTime, duration, track])

  // Contrôles : lecture, pause, suivant, précédent, +-10 s
  useEffect(()=>{
    if(!("mediaSession" in navigator)) return
    const ms = navigator.mediaSession
    const define = (action:MediaSessionAction, handler:MediaSessionActionHandler | null)=>{
      try{ ms.setActionHandler(action, handler) }catch{}
    }
    define("play", ()=>{ void audio.play() })
    define("pause", ()=>{ audio.pause() })
    define("previoustrack", ()=>{ prev() })
    define("nexttrack", ()=>{ next() })
    define("seekbackward", ()=>{ skip(-10) })
    define("seekforward", ()=>{ skip(10) })
    return ()=>{
      ;(["play","pause","previoustrack","nexttrack","seekbackward","seekforward"] as MediaSessionAction[]).forEach(a=>define(a, null))
    }
  },[audio, prev, next, skip])

  return <PlayerContext.Provider value={{track,queue,queueIndex,isPlaying,currentTime,duration,volume,mediaView,error,loadMokaFile,loadMultiple,playQueue,playTrack,next,prev,addToQueue,removeFromQueue,clearQueue,togglePlay,seek,skip,setVolume,setMediaView,getAudioElement,clearError,loopActive,setLoopActive}}>{children}</PlayerContext.Provider>
}
export function usePlayer():PlayerState{
  const c=useContext(PlayerContext); if(!c) throw new Error("usePlayer missing"); return c
}
