import { useState } from "react"
import { PlayerProvider, usePlayer } from "./player/PlayerContext"
import { LibraryProvider } from "./library/LibraryProvider"
import { PlayerView } from "./components/PlayerView"
import { EditorView } from "./components/EditorView"
import { LibraryView } from "./components/LibraryView"
import { MiniPlayer } from "./components/MiniPlayer"
import { Coffee, PlayCircle, PenSquare, Library, Sparkles } from "lucide-react"
import { useSmartphone } from "./hooks/useSmartphone"

type Tab = "player"|"library"|"editor"

function Shell(){
  const [tab,setTab]=useState<Tab>("player")
  const { track } = usePlayer()
  const showMini = tab!=="player" && !!track
  const smartphone = useSmartphone()
  return (
    <div className="min-h-screen bg-stone-950 text-stone-200 selection:bg-moka-700/60">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(76,97,165,0.16),transparent_60%),radial-gradient(ellipse_at_bottom_right,_rgba(31,42,77,0.30),transparent_60%)]"/>
      <header className="sticky top-0 z-40 border-b border-stone-800/70 bg-stone-900/70 backdrop-blur">
        <div className={`mx-auto max-w-6xl ${smartphone ? "px-3 py-2.5" : "px-4 py-3"} flex items-center justify-between gap-2`}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-moka-800 border border-moka-600 text-white"><Coffee className="h-5 w-5"/></div>
            {!smartphone && (
              <div>
                <h1 className="text-lg font-black tracking-tight text-stone-100">MOKA <span className="ml-1 rounded-full bg-moka-500 px-1.5 py-0.5 text-[10px] font-bold text-white">v1</span></h1>
                <p className="text-[11px] text-stone-400">Votre collection audio · clips · paroles</p>
              </div>
            )}
          </div>
          <nav className="flex items-center gap-1 rounded-full bg-stone-900 p-1">
            <TabButton active={tab==="player"} onClick={()=>setTab("player")} icon={PlayCircle} label={smartphone ? "Écoute" : "Écouter"} small={smartphone}/>
            <TabButton active={tab==="library"} onClick={()=>setTab("library")} icon={Library} label={smartphone ? "Biblio" : "Bibliothèque"} small={smartphone}/>
            <TabButton active={tab==="editor"} onClick={()=>setTab("editor")} icon={PenSquare} label={smartphone ? "Créer" : "Créer"} small={smartphone}/>
          </nav>
          <div className="hidden lg:flex items-center gap-2 text-xs text-stone-400"><Sparkles className="h-4 w-4 text-moka-500"/> Pan & Scan IA intégré</div>
        </div>
      </header>
      <main className="relative mx-auto max-w-6xl">
        {tab==="player" && <PlayerView/>}
        {tab==="library" && <LibraryView/>}
        {tab==="editor" && <EditorView onCreated={()=>setTab("player")}/>}
      </main>
      {showMini && <MiniPlayer onOpenPlayer={()=>setTab("player")}/>}
    </div>
  )
}
function TabButton({active,onClick,icon:Icon,label,small}:{active:boolean,onClick:()=>void,icon:any,label:string,small?:boolean}){
  return <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-full font-medium transition ${small?"px-3 py-1.5 text-xs":"px-4 py-1.5 text-sm"} ${active?"bg-moka-600 text-white shadow":"text-stone-400 hover:bg-stone-800"}`}><Icon className="h-4 w-4"/>{label}</button>
}
export default function App(){
  return <LibraryProvider><PlayerProvider><Shell/></PlayerProvider></LibraryProvider>
}
