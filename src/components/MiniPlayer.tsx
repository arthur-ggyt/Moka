import { usePlayer } from "../player/PlayerContext"
import { formatTime } from "../moka"
import { activeLyricIndex } from "../lyrics"
import { ProgressBar } from "./ProgressBar"
import { SkipBack, SkipForward, Play, Pause, Music2 } from "lucide-react"
import { useSmartphone } from "../hooks/useSmartphone"
export function MiniPlayer({ onOpenPlayer }: { onOpenPlayer: ()=>void }){
  const { track, isPlaying, currentTime, duration, togglePlay, seek, skip } = usePlayer()
  const smartphone = useSmartphone()
  if(!track) return null
  const meta = track.manifest.metadata
  const lyricIndex = track.manifest.lyrics ? activeLyricIndex(track.manifest.lyrics, currentTime, duration) : -1
  const lyricLine = lyricIndex>=0 ? track.manifest.lyrics?.lines[lyricIndex]?.text : ""
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-800 bg-stone-950/95 backdrop-blur">
      <div className={`mx-auto flex ${smartphone ? "max-w-md px-3 py-2" : "max-w-5xl px-4 py-2.5"} items-center gap-2.5`}>
        <button onClick={onOpenPlayer} title="Revenir au lecteur" className={`shrink-0 overflow-hidden rounded-xl border border-stone-800 ${smartphone ? "h-10 w-10" : "h-11 w-11"}`}>
          {track.coverUrl ? <img src={track.coverUrl} className="h-full w-full object-cover"/> : <div className="flex h-full w-full items-center justify-center bg-stone-900 text-stone-400"><Music2 className="h-5 w-5"/></div>}
        </button>
        <button onClick={onOpenPlayer} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-stone-100">{meta.title || track.fileName}</p>
          <p className="truncate text-xs text-stone-400">{meta.artist || "Artiste inconnu"}</p>
          {lyricLine && <p className="truncate text-[11px] text-moka-400">{lyricLine}</p>}
        </button>
        <div className="flex items-center gap-1.5">
          <button onClick={()=>skip(-10)} className="rounded-full p-2 text-stone-400 hover:bg-stone-900"><SkipBack className="h-4 w-4"/></button>
          <button onClick={togglePlay} className="flex h-9 w-9 items-center justify-center rounded-full bg-moka-900 text-white"><span className="sr-only">play</span>{isPlaying ? <Pause className="h-4 w-4 fill-white"/> : <Play className="h-4 w-4 fill-white ml-0.5"/>}</button>
          <button onClick={()=>skip(10)} className="rounded-full p-2 text-stone-400 hover:bg-stone-900"><SkipForward className="h-4 w-4"/></button>
        </div>
        <div className="hidden w-48 items-center gap-2 sm:flex">
          <span className="text-[10px] tabular-nums text-stone-400">{formatTime(currentTime)}</span>
          <div className="flex-1"><ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} compact/></div>
          <span className="text-[10px] tabular-nums text-stone-400">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  )
}
