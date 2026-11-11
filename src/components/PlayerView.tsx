import { useEffect, useState, useRef, type ChangeEvent } from "react"
import { usePlayer, type MediaView } from "../player/PlayerContext"
import { formatTime, type ContentBounds, type VideoCrop } from "../moka"
import { ProgressBar } from "./ProgressBar"
import { getPanScanPosition } from "../video/panscan"
import { NO_BARS, detectVideoLetterbox, hasContentBars, placementStyle, windowInsideContent } from "../video/letterbox"
import { MokaWatermark } from "./MokaWatermark"
import { CurrentLyric, LyricsPanel } from "./LyricsPanel"
import { activeLyricIndex, activeWordIndex } from "../lyrics"
import { useLibrary, trackKey, artistKey } from "../library/store"
import { useSmartphone } from "../hooks/useSmartphone"
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Upload, Image as ImageIcon, Film, Mic2, Heart, Star, ListMusic, Shuffle, Repeat } from "lucide-react"

export function PlayerView(){
  const { track, queue, queueIndex, isPlaying, currentTime, duration, volume, mediaView, error, loadMokaFile, loadMultiple, playQueue, next, prev, togglePlay, seek, skip, setVolume, setMediaView, getAudioElement, clearError, loopActive, setLoopActive } = usePlayer()
  const lib = useLibrary()
  const fileInputRef=useRef<HTMLInputElement>(null)
  const multiRef=useRef<HTMLInputElement>(null)
  const videoRef=useRef<HTMLVideoElement>(null)
  const lyricLineRef=useRef<HTMLLIElement|null>(null)
  const [frameSize,setFrameSize]=useState({width:0,height:0})
  const [detectedBars,setDetectedBars]=useState<ContentBounds|null>(null)

  // La vidéo reste TOUJOURS montée et préchargée (sous la pochette) pour que
  // l'ouverture se fasse sans rechargement ni freeze : en vue paroles texte,
  // le clip est déjà chargé et synchronisé en attendant.
  const activeVideoUrl = track ? (mediaView==="lyrics" ? (track.video2Url ?? track.video1Url ?? null) : track.video1Url ?? null) : null
  const showVideo = !!activeVideoUrl && (mediaView==="clip" || (mediaView==="lyrics" && !!track?.video2Url))
  const lyricsTextActive = mediaView==="lyrics" && !track?.video2Url && !!track?.manifest.lyrics
  const lyricsIndex = track?.manifest.lyrics ? activeLyricIndex(track.manifest.lyrics, currentTime, duration) : -1
  const lyricsObj = track?.manifest.lyrics ?? null
  const smartphone = useSmartphone()

  useEffect(()=>{
    if(lyricsTextActive) lyricLineRef.current?.scrollIntoView({block:"center", behavior:"smooth"})
  },[lyricsIndex, lyricsTextActive])

  const videoOffset = mediaView==="clip"? track?.manifest.video1Offset ?? 0 : mediaView==="lyrics"? track?.manifest.video2Offset ?? 0 : 0
  const activeCrop: VideoCrop|null = (mediaView==="clip"? track?.manifest.video1Crop : mediaView==="lyrics"? track?.manifest.video2Crop : undefined) ?? null
  const activePanScan = mediaView==="clip"? track?.manifest.video1PanScan ?? null : mediaView==="lyrics"? track?.manifest.video2PanScan ?? null : null
  const activeVideoInfo = mediaView==="clip"? track?.manifest.video1 : mediaView==="lyrics"? track?.manifest.video2 : null
  const storedBars = mediaView==="clip"? track?.manifest.video1Content : mediaView==="lyrics"? track?.manifest.video2Content : undefined
  const contentBars = storedBars ?? detectedBars ?? NO_BARS
  const activeCropped = mediaView==="clip" ? !!track?.manifest.video1Cropped || !!track?.manifest.video1PanScan || cropHasEffect(track?.manifest.video1Crop, activeVideoInfo?.width, activeVideoInfo?.height) : mediaView==="lyrics" ? !!track?.manifest.video2Cropped || !!track?.manifest.video2PanScan || cropHasEffect(track?.manifest.video2Crop, activeVideoInfo?.width, activeVideoInfo?.height) : false
  const cropKey = activeCrop ? `${activeCrop.aspect}:${activeCrop.posX}:${activeCrop.posY}` : "auto"
  const panKey = activePanScan ? `${activePanScan.aspect}:${activePanScan.keyframes.length}:${activePanScan.keyframes.at(-1)?.time ?? 0}` : "none"

  useEffect(()=>{
    const video=videoRef.current; if(!video||!activeVideoUrl) return
    const audio=getAudioElement()
    const targetTime=()=> audio.currentTime + videoOffset
    const updatePan=()=>{
      // Le recadrage n'est appliqué qu'une fois les métadonnées connues :
      // pas de saut de cadre pendant l'animation de pochette.
      if(video.videoWidth<=0) return
      const point = activePanScan ? getPanScanPosition(activePanScan, video.currentTime) : { x: activeCrop?.posX ?? 0.5, y: activeCrop?.posY ?? 0.5 }
      const style = placementStyle(windowInsideContent(video.videoWidth, video.videoHeight, contentBars, activePanScan?.aspect || activeCrop?.aspect || 0, point.x, point.y))
      video.style.position=style.position; video.style.width=style.width; video.style.height=style.height; video.style.left=style.left; video.style.top=style.top; video.style.maxWidth=style.maxWidth; video.style.objectFit=style.objectFit as any
    }
    const applyTime=()=>{ const t=targetTime(); video.currentTime=Math.max(0, Math.min(t, video.duration||t)); updatePan() }
    const inRange=()=>{ const t=targetTime(); return t>=0 && (!video.duration || t < video.duration)}
    const sync=()=>{
      if(Math.abs(video.currentTime - targetTime())>0.25) applyTime()
      updatePan()
      const ok=inRange()
      if(video.readyState<1) return
      if(!audio.paused && ok && video.paused) void video.play().catch(()=>{})
      if((audio.paused||!ok) && !video.paused) video.pause()
    }
    const onMeta=()=>{ if(video.videoWidth&&video.videoHeight) setFrameSize({width:video.videoWidth,height:video.videoHeight}); applyTime(); sync()}
    if(video.readyState>=1) onMeta(); else video.addEventListener("loadedmetadata",onMeta)
    sync(); const id=window.setInterval(sync, activePanScan?80:250)
    return ()=>{ window.clearInterval(id); video.removeEventListener("loadedmetadata",onMeta)}
  },[activeVideoUrl,videoOffset,isPlaying,getAudioElement,cropKey,panKey,activePanScan,activeCrop,contentBars,frameSize.width,frameSize.height,activeVideoInfo?.width,activeVideoInfo?.height])

  useEffect(()=>{
    if(!activeVideoUrl || storedBars){ setDetectedBars(null); return }
    let cancelled=false
    void fetch(activeVideoUrl).then(r=>r.blob()).then(b=>detectVideoLetterbox(b)).then(bounds=>{ if(!cancelled) setDetectedBars(hasContentBars(bounds)?bounds:NO_BARS)}).catch(()=>{ if(!cancelled) setDetectedBars(NO_BARS)})
    return ()=>{ cancelled=true }
  },[activeVideoUrl,storedBars])

  const onFileChosen=(e:ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; if(f) void loadMokaFile(f,f.name); e.target.value="" }
  const onMultiChosen=(e:ChangeEvent<HTMLInputElement>)=>{ if(e.target.files) void loadMultiple(e.target.files); e.target.value="" }

  const meta=track?.manifest.metadata
  const frameW = frameSize.width || activeVideoInfo?.width || 16
  const frameH = frameSize.height || activeVideoInfo?.height || 9
  const playbackPoint = activePanScan ? getPanScanPosition(activePanScan, currentTime) : {x:activeCrop?.posX ?? 0.5, y:activeCrop?.posY ?? 0.5}
  const playbackWindow = windowInsideContent(frameW,frameH,contentBars, activePanScan?.aspect || activeCrop?.aspect ||0, playbackPoint.x, playbackPoint.y)
  const playbackAspect = (playbackWindow.w * frameW)/ Math.max(1, playbackWindow.h * frameH)
  const viewportStyle = playbackAspect>=1 ? {width:"100%", height:`${100/playbackAspect}%`} : {width:`${playbackAspect*100}%`, height:"100%"}
  const mediaButtons: {key:MediaView,label:string,available:boolean,icon:any}[]=[
    {key:"cover",label:"Pochette",available:true, icon: ImageIcon},
    {key:"clip",label:"Clip",available:!!track?.video1Url, icon: Film},
    {key:"lyrics",label:"Paroles",available:!!track?.video2Url || !!track?.manifest.lyrics, icon: Mic2},
  ]

  const tk = track ? trackKey(track.manifest) : ""
  const ak = meta ? artistKey(meta.artist) : ""
  const isFav = tk && lib.favorites.has(tk)
  const isArtistFav = ak && lib.artistFavorites.has(ak)
  const loopMeta = track?.manifest.loop ?? null

  return (
    <div className={`mx-auto w-full ${smartphone ? "max-w-md px-3 pb-16" : "max-w-5xl px-4 pb-10"}`}>
      <div className={`flex flex-wrap items-center justify-center gap-3 ${smartphone ? "py-3" : "py-4"}`}>
        <input ref={fileInputRef} type="file" accept=".moka,application/x-moka" className="hidden" onChange={onFileChosen}/>
        <input ref={multiRef} type="file" multiple accept=".moka,application/x-moka" className="hidden" onChange={onMultiChosen}/>
        <button onClick={()=>fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-full bg-moka-500 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-moka-600"><Upload className="h-4 w-4"/> Ouvrir un .moka</button>
        <button onClick={()=>multiRef.current?.click()} className="inline-flex items-center gap-2 rounded-full bg-stone-900/60 px-5 py-2.5 text-sm font-semibold text-stone-400 border border-stone-800 hover:bg-stone-900"><ListMusic className="h-4 w-4"/> Ouvrir plusieurs</button>
      </div>

      {error && <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button onClick={clearError} className="text-red-500">Fermer</button></div>}

      <div className="grid gap-5 lg:grid-cols-[420px_1fr] lg:gap-6">
        <div>
          <div className={`relative mx-auto aspect-square overflow-hidden rounded-[24px] border border-stone-800 bg-stone-900 shadow-sm ${smartphone ? "w-full" : "w-full max-w-md"}`}>
            {!track ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-stone-400"><div className="flex h-20 w-20 items-center justify-center rounded-full bg-stone-900/60"><ImageIcon className="h-8 w-8"/></div><p className="text-sm">Aucun fichier chargé</p><p className="text-xs text-stone-400">Choisissez un fichier .moka</p></div>
            ) : (
              <>
                {/* VIDÉO — déjà affichée SOUS la pochette, visible avant qu'elle glisse */}
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  {activeVideoUrl && (
                    <div className="relative overflow-hidden" style={viewportStyle}>
                      <video
                        key={activeVideoUrl}
                        ref={videoRef}
                        src={activeVideoUrl}
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                        style={frameSize.width > 0 ? placementStyle(playbackWindow) : undefined}
                      />
                      {activeCropped && <MokaWatermark/>}
                    </div>
                  )}
                </div>

                {/* POCHETTE — glisse vers la gauche (ouverture / fermeture) */}
                <div
                  className="absolute inset-0 overflow-hidden bg-black transition-transform duration-[650ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
                  style={{ transform: showVideo ? "translateX(-102%)" : "translateX(0%)" }}
                >
                  {track.coverUrl ? (
                    <img
                      src={track.coverUrl}
                      alt="Cover"
                      className={`h-full w-full object-cover transition-opacity duration-700 ${lyricsTextActive ? "opacity-35" : "opacity-100"}`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-800 to-moka-950 text-moka-300"><ImageIcon className="h-12 w-12"/></div>
                  )}
                </div>

                {/* PAROLES — texte blanc sur la pochette assombrie (35 % d'opacité) */}
                <div className={`absolute inset-0 pointer-events-none ${lyricsTextActive ? "" : "opacity-0"}`}>
                  {lyricsTextActive && lyricsObj && (
                    <div className="pointer-events-auto h-full w-full overflow-y-auto px-6 py-8">
                      <ol className="space-y-2.5 text-center">
                        {lyricsObj.lines.map((line, i)=>{
                          const active = i===lyricsIndex
                          const wordIdx = active ? activeWordIndex(line, currentTime, lyricsObj.offset) : -1
                          return (
                            <li
                              key={`${line.time}-${i}`}
                              ref={active ? lyricLineRef : undefined}
                              className={`transition-opacity duration-300 ${active ? "text-lg font-semibold text-white opacity-100" : "text-sm text-white/45"}`}
                            >
                              {line.words?.length
                                ? line.words.map((w, wi)=>(
                                    <span key={`${w.time}-${wi}`} className={wi===wordIdx ? "font-bold text-moka-200" : "text-white"}>
                                      {w.text}
                                    </span>
                                  ))
                                : line.text}
                            </li>
                          )
                        })}
                      </ol>
                    </div>
                  )}
                </div>
              </>
            )}
            {track && <div className="absolute right-3 top-3 rounded-full bg-stone-900/80 px-3 py-1 text-[10px] font-bold tracking-widest text-stone-400 shadow">{track.manifest.audio.audioFormat.toUpperCase()} · {track.manifest.audio.quality}</div>}
          </div>

          {track && (
            <div className="mt-3 flex justify-center gap-2">
              {mediaButtons.filter(b=>b.available).map(b=>{
                const Icon=b.icon
                return <button key={b.key} onClick={()=>setMediaView(b.key)} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition ${mediaView===b.key?"bg-moka-900 text-white":"bg-stone-900/60 border border-stone-800 text-stone-400 hover:bg-stone-900"}`}><Icon className="h-4 w-4"/>{b.label}</button>
              })}
            </div>
          )}

          <div className="mt-6 text-center">
            <h2 className="truncate text-xl font-bold text-stone-100">{meta?.title || (track?track.fileName:"—")}</h2>
            <p className="truncate text-sm text-moka-400">{meta?.artist || (track?"Artiste inconnu":"")}</p>
            <p className="truncate text-xs text-stone-400">{meta?.album||""}{meta?.year?` · ${meta.year}`:""}</p>
            {loopActive && loopMeta && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-moka-900/60 px-2.5 py-0.5 text-[11px] font-semibold text-moka-300">
                <Repeat className="h-3 w-3"/> Loop · {formatTime(loopMeta.start)} → {formatTime(loopMeta.end)}
              </p>
            )}
            {track?.manifest.lyrics && mediaView!=="lyrics" && <div className="mt-2"><CurrentLyric lyrics={track.manifest.lyrics} time={currentTime} duration={duration}/></div>}
          </div>

          <div className="mt-6">
            <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} disabled={!track}/>
            <div className="mt-1 flex justify-between text-xs tabular-nums text-stone-400"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
          </div>

          <div className="mt-4 flex items-center justify-center gap-3">
            <button onClick={prev} disabled={!track} className="rounded-full bg-stone-900/60 border border-stone-800 p-3 text-stone-400 hover:bg-stone-900 disabled:opacity-30"><SkipBack className="h-5 w-5"/></button>
            <button onClick={togglePlay} disabled={!track} className="flex h-14 w-14 items-center justify-center rounded-full bg-moka-500 text-white shadow hover:bg-moka-600 disabled:opacity-30">{isPlaying ? <Pause className="h-6 w-6 fill-white"/> : <Play className="h-6 w-6 fill-white ml-0.5"/>}</button>
            <button onClick={next} disabled={!track} className="rounded-full bg-stone-900/60 border border-stone-800 p-3 text-stone-400 hover:bg-stone-900 disabled:opacity-30"><SkipForward className="h-5 w-5"/></button>
          </div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <button onClick={()=>skip(-10)} className="text-xs text-stone-400 hover:text-moka-300">-10s</button>
            <div className={`flex items-center gap-2 rounded-full bg-stone-900/60 border border-stone-800 px-3 py-1.5 ${smartphone ? "flex-1" : ""}`}>
              <button onClick={()=>setVolume(volume===0?0.8:0)}>{volume===0? <VolumeX className="h-4 w-4"/> : <Volume2 className="h-4 w-4"/>}</button>
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={e=>setVolume(Number(e.target.value))} className={`h-1 accent-moka-500 ${smartphone ? "w-full" : "w-24"}`}/>
            </div>
            <button onClick={()=>skip(10)} className="text-xs text-stone-400 hover:text-moka-300">+10s</button>
            <button
              onClick={()=>setLoopActive(!loopActive)}
              disabled={!loopMeta}
              title={loopMeta
                ? `Mode Loop — intro jouée une fois, puis ${formatTime(loopMeta.start)} → ${formatTime(loopMeta.end)} en boucle`
                : "Ce fichier n'a pas été configuré pour le Mode Loop"}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                loopActive && loopMeta
                  ? "border-moka-400 bg-moka-500 text-white shadow"
                  : "border-stone-700 bg-stone-900/60 text-stone-400 hover:text-moka-300"
              } disabled:cursor-not-allowed disabled:opacity-35`}
            >
              <Repeat className="h-3.5 w-3.5"/> Loop
            </button>
          </div>

          {track && (
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={()=>lib.toggleFavorite(tk)} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${isFav?"bg-moka-500 text-white":"bg-stone-900/60 border border-stone-800 text-stone-400"}`}><Heart className={`h-4 w-4 ${isFav?"fill-white":""}`}/> Favori</button>
              <button onClick={()=>lib.toggleArtistFavorite(ak)} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${isArtistFav?"bg-violet-600 text-white":"bg-stone-900/60 border border-stone-800 text-stone-400"}`}><Star className="h-4 w-4"/> Artiste</button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4">
            <div className="flex items-center justify-between"><h3 className="font-semibold text-stone-100">File d'attente</h3><span className="text-xs text-stone-400">{queue.length} titres</span></div>
            {queue.length===0 && <p className="mt-2 text-sm text-stone-400">Chargez plusieurs fichiers pour créer une écoute continue.</p>}
            <div className="mt-3 max-h-64 space-y-1 overflow-auto pr-1">
              {queue.map((q,idx)=>(
                <div key={q.id} className={`flex items-center gap-2 rounded-xl px-2 py-2 ${idx===queueIndex?"bg-moka-900 text-white":"hover:bg-stone-900"}`}>
                  <div className="h-8 w-8 overflow-hidden rounded-lg bg-stone-200 shrink-0">{q.coverUrl ? <img src={q.coverUrl} className="h-full w-full object-cover"/> : null}</div>
                  <button onClick={()=>playQueue(queue, idx)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-medium">{q.manifest.metadata.title}</p><p className={`truncate text-xs ${idx===queueIndex?"text-stone-400":"text-stone-400"}`}>{q.manifest.metadata.artist}</p></button>
                  {idx===queueIndex && <span className="text-xs">En cours</span>}
                </div>
              ))}
            </div>
            {queue.length>1 && <div className="mt-3 flex gap-2"><button onClick={()=>{const shuffled=[...queue].sort(()=>Math.random()-0.5); playQueue(shuffled,0)}} className="inline-flex items-center gap-1 rounded-full bg-stone-900/60 border border-stone-800 px-3 py-1 text-xs"><Shuffle className="h-3 w-3"/> Aléatoire</button><button onClick={()=>{ if(queue.length) playQueue(queue,0)}} className="inline-flex items-center gap-1 rounded-full bg-moka-500 px-3 py-1 text-xs font-semibold text-white"><Play className="h-3 w-3 fill-white"/> Tout lire</button></div>}
          </div>

          {lyricsObj && mediaView==="lyrics" && !!track?.video2Url && <LyricsPanel lyrics={lyricsObj} time={currentTime} duration={duration} compact/>}

          {track && (
            <div className="rounded-2xl border border-stone-800 bg-stone-950/50 p-4">
              <h4 className="text-xs font-bold tracking-widest text-stone-400">DÉTAILS</h4>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <Info label="Fichier" value={track.fileName}/>
                <Info label="Audio" value={`${track.manifest.audio.audioFormat.toUpperCase()} · ${track.manifest.audio.quality}`}/>
                <Info label="Album" value={meta?.album}/>
                <Info label="Genre" value={meta?.genre}/>
                <Info label="Piste" value={meta?.trackNumber}/>
                <Info label="Année" value={meta?.year}/>
                <Info label="Paroles" value={track.manifest.lyrics ? `${track.manifest.lyrics.lines.length} lignes` : "—"}/>
                <Info label="Mode Loop" value={loopMeta ? `${formatTime(loopMeta.start)} → ${formatTime(loopMeta.end)}` : "non configuré"}/>
                <Info label="Cover" value={track.manifest.cover? `${track.manifest.cover.width}×${track.manifest.cover.height}`:"—"}/>
              </div>
              <div className="mt-3 rounded-xl bg-stone-900/60 p-3">
                <p className="text-xs font-semibold text-stone-400">Note sur ce titre</p>
                <textarea value={lib.notes[tk]||""} onChange={e=>lib.setNote(tk,e.target.value)} placeholder="Ajouter une note personnelle..." rows={2} className="mt-1 w-full rounded-lg border border-stone-800 p-2 text-sm outline-none focus:border-moka-500"/>
                <p className="mt-2 text-xs font-semibold text-stone-400">Note sur l'artiste</p>
                <textarea value={lib.artistNotes[ak]||""} onChange={e=>lib.setArtistNote(ak,e.target.value)} placeholder={`Note sur ${meta?.artist||"l'artiste"}...`} rows={2} className="mt-1 w-full rounded-lg border border-stone-800 p-2 text-sm outline-none focus:border-moka-500"/>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function cropHasEffect(c?:VideoCrop,w?:number,h?:number){ if(!c||c.aspect<=0) return false; if(!w||!h) return true; return Math.abs(w/h - c.aspect)>0.02 }
function Info({label,value}:{label:string,value?:string|null}){ return <p className="truncate"><span className="text-stone-400">{label} : </span><span className="text-stone-400">{value||"—"}</span></p>}
