import { useState, useMemo } from "react"
import { usePlayer } from "../player/PlayerContext"
import { useLibrary, trackKey, artistKey } from "../library/store"
import { Search, Star, ListMusic, Disc3, User, Plus, Trash2, Play, Heart, StickyNote, X, Shuffle, Repeat, Repeat1 } from "lucide-react"

export function LibraryView(){
  const { queue, track, playQueue, playTrack } = usePlayer()
  const lib = useLibrary()
  const [filter,setFilter]=useState("")
  const [tab,setTab]=useState<"all"|"albums"|"artists"|"playlists"|"favorites">("all")
  const [newPlName,setNewPlName]=useState("")
  const [noteOpen,setNoteOpen]=useState<{key:string, type:"track"|"artist"}|null>(null)
  const [noteText,setNoteText]=useState("")

  const allTracks = queue // for now library is queue; in real app would be indexedDB collection
  const filtered = useMemo(()=>{
    const q=filter.toLowerCase()
    if(!q) return allTracks
    return allTracks.filter(t=> `${t.manifest.metadata.title} ${t.manifest.metadata.artist} ${t.manifest.metadata.album}`.toLowerCase().includes(q))
  },[allTracks,filter])

  // group by album
  const albums = useMemo(()=>{
    const m=new Map<string, typeof allTracks>()
    for(const t of filtered){
      const k=t.manifest.metadata.album||"Sans album"
      if(!m.has(k)) m.set(k,[])
      m.get(k)!.push(t)
    }
    return [...m.entries()]
  },[filtered])
  const artists = useMemo(()=>{
    const m=new Map<string, typeof allTracks>()
    for(const t of filtered){
      const k=t.manifest.metadata.artist||"Artiste inconnu"
      if(!m.has(k)) m.set(k,[])
      m.get(k)!.push(t)
    }
    return [...m.entries()]
  },[filtered])

  const favTracks = filtered.filter(t=> lib.favorites.has(trackKey(t.manifest)))

  const openNote=(k:string, type:"track"|"artist")=>{
    setNoteOpen({key:k, type})
    setNoteText(type==="track" ? lib.notes[k]||"" : lib.artistNotes[k]||"")
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-stone-100">Bibliothèque</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400"/>
            <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Rechercher titre, artiste, album" className="w-full rounded-full border border-stone-800 bg-stone-900/60 pl-9 pr-3 py-2 text-sm outline-none focus:border-moka-500 focus:ring-2 focus:ring-moka-500/20 sm:w-64"/>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          {k:"all", l:"Tout", i:ListMusic},
          {k:"albums", l:"Albums", i:Disc3},
          {k:"artists", l:"Artistes", i:User},
          {k:"playlists", l:"Playlists", i:ListMusic},
          {k:"favorites", l:"Favoris", i:Heart},
        ].map(tabBtn=>{
          const Icon=tabBtn.i
          const active=tab===tabBtn.k
          return <button key={tabBtn.k} onClick={()=>setTab(tabBtn.k as any)} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${active?"bg-moka-500 text-white shadow":"bg-stone-900 text-stone-400 hover:bg-stone-200"}`}><Icon className="h-4 w-4"/>{tabBtn.l}</button>
        })}
        <div className="ml-auto flex items-center gap-2 text-stone-400">
          <button onClick={()=>lib.setShuffle(!lib.shuffle)} className={`rounded-full p-2 ${lib.shuffle?"bg-moka-500 text-white":"bg-stone-900"}`} title="Aléatoire"><Shuffle className="h-4 w-4"/></button>
          <button onClick={()=>lib.setRepeat(lib.repeat==="off"?"all": lib.repeat==="all"?"one":"off")} className={`rounded-full p-2 ${lib.repeat!=="off"?"bg-moka-500 text-white":"bg-stone-900"}`} title="Répéter">{lib.repeat==="one"?<Repeat1 className="h-4 w-4"/>:<Repeat className="h-4 w-4"/>}</button>
        </div>
      </div>

      {tab==="all" && (
        <div className="mt-6 grid gap-3">
          {filtered.length===0 && <p className="text-stone-400 text-sm">Aucun morceau chargé. Ouvrez des fichiers .moka depuis le lecteur pour construire votre bibliothèque.</p>}
          {filtered.map(t=>{
            const k=trackKey(t.manifest)
            const fav=lib.favorites.has(k)
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-stone-800 bg-stone-900/60 p-3 shadow-sm hover:shadow-md transition">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-stone-900">{t.coverUrl ? <img src={t.coverUrl} className="h-full w-full object-cover"/> : <div className="flex h-full w-full items-center justify-center text-stone-400"><Disc3 className="h-6 w-6"/></div>}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-stone-100">{t.manifest.metadata.title || t.fileName}</p>
                  <p className="truncate text-sm text-stone-400">{t.manifest.metadata.artist} {t.manifest.metadata.album ? "· "+t.manifest.metadata.album : ""}</p>
                </div>
                <button onClick={()=>playTrack(t)} className="rounded-full bg-moka-900 p-2.5 text-white hover:bg-black"><Play className="h-4 w-4 fill-white"/></button>
                <button onClick={()=>lib.toggleFavorite(k)} className={`rounded-full p-2 ${fav?"bg-moka-500 text-white":"bg-stone-900 text-stone-400"}`}><Star className={`h-4 w-4 ${fav?"fill-white":""}`}/></button>
                <button onClick={()=>openNote(k,"track")} className="rounded-full bg-stone-900 p-2 text-stone-400 hover:bg-stone-200"><StickyNote className="h-4 w-4"/></button>
              </div>
            )
          })}
        </div>
      )}

      {tab==="albums" && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {albums.map(([album, tracks])=>(
            <div key={album} className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-stone-100">{album}</h3>
                <button onClick={()=>playQueue(tracks,0)} className="inline-flex items-center gap-1 rounded-full bg-moka-500 px-3 py-1 text-xs font-bold text-white"><Play className="h-3 w-3 fill-white"/> Lire l'album</button>
              </div>
              <ul className="mt-3 divide-y divide-stone-800">
                {tracks.map(t=> <li key={t.id} className="flex items-center justify-between py-2 text-sm"><span className="truncate pr-2">{t.manifest.metadata.title}</span><button onClick={()=>playTrack(t)} className="text-stone-400 hover:text-moka-400"><Play className="h-4 w-4"/></button></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}

      {tab==="artists" && (
        <div className="mt-6 grid gap-4">
          {artists.map(([artist, tracks])=>{
            const aKey=artistKey(artist)
            const fav=lib.artistFavorites.has(aKey)
            return (
              <div key={artist} className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-700"><User className="h-5 w-5"/></div>
                    <h3 className="font-semibold text-stone-100">{artist}</h3>
                    {lib.artistNotes[aKey] && <span className="rounded-full bg-moka-100 px-2 py-0.5 text-[10px] text-moka-300">note</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={()=>openNote(aKey,"artist")} className="rounded-full bg-stone-900 p-1.5 text-stone-400"><StickyNote className="h-4 w-4"/></button>
                    <button onClick={()=>lib.toggleArtistFavorite(aKey)} className={`rounded-full p-1.5 ${fav?"bg-moka-500 text-white":"bg-stone-900 text-stone-400"}`}><Heart className="h-4 w-4"/></button>
                    <button onClick={()=>playQueue(tracks,0)} className="rounded-full bg-moka-900 px-3 py-1 text-xs font-bold text-white">Lire</button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-stone-400">{tracks.length} titres · {lib.artistNotes[aKey]?.slice(0,80)}</p>
              </div>
            )
          })}
        </div>
      )}

      {tab==="playlists" && (
        <div className="mt-6">
          <div className="flex items-center gap-2">
            <input value={newPlName} onChange={e=>setNewPlName(e.target.value)} placeholder="Nouvelle playlist" className="flex-1 rounded-full border border-stone-800 bg-stone-900/60 px-4 py-2 text-sm outline-none focus:border-violet-500"/>
            <button onClick={()=>{ if(newPlName.trim()){ lib.createPlaylist(newPlName.trim()); setNewPlName("")}}} className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-4 py-2 text-sm font-bold text-white"><Plus className="h-4 w-4"/> Créer</button>
          </div>
          <div className="mt-4 grid gap-4">
            {lib.playlists.map(pl=>(
              <div key={pl.id} className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-stone-100">{pl.name} <span className="ml-1 text-xs text-stone-400">{pl.trackKeys.length} titres</span></h3>
                  <div className="flex items-center gap-1">
                    <button onClick={()=>{
                      const tracks = pl.trackKeys.map(k=> queue.find(t=> trackKey(t.manifest)===k)).filter(Boolean) as typeof queue
                      if(tracks.length) playQueue(tracks,0)
                    }} className="rounded-full bg-moka-900 px-3 py-1 text-xs font-bold text-white inline-flex items-center gap-1"><Play className="h-3 w-3 fill-white"/> Lire</button>
                    <button onClick={()=>lib.deletePlaylist(pl.id)} className="rounded-full bg-stone-900 p-2 text-stone-400 hover:text-red-600"><Trash2 className="h-4 w-4"/></button>
                  </div>
                </div>
                {allTracks.length>0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {allTracks.slice(0,6).map(t=>{
                      const k=trackKey(t.manifest)
                      const inPl = pl.trackKeys.includes(k)
                      return <button key={t.id} onClick={()=> inPl ? lib.removeFromPlaylist(pl.id,k) : lib.addToPlaylist(pl.id,k)} className={`rounded-full px-2 py-1 text-xs ${inPl?"bg-violet-600 text-white":"bg-stone-900 text-stone-400"}`}>{t.manifest.metadata.title}</button>
                    })}
                  </div>
                )}
              </div>
            ))}
            {lib.playlists.length===0 && <p className="text-sm text-stone-400">Aucune playlist.</p>}
          </div>
        </div>
      )}

      {tab==="favorites" && (
        <div className="mt-6 grid gap-3">
          {favTracks.length===0 && <p className="text-sm text-stone-400">Aucun favori.</p>}
          {favTracks.map(t=>(
            <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-moka-900/40 p-3 border border-moka-200">
              <div className="h-10 w-10 overflow-hidden rounded-lg bg-stone-900/60">{t.coverUrl && <img src={t.coverUrl} className="h-full w-full object-cover"/>}</div>
              <div className="flex-1 truncate"><p className="font-medium truncate">{t.manifest.metadata.title}</p><p className="text-xs text-stone-400 truncate">{t.manifest.metadata.artist}</p></div>
              <button onClick={()=>playTrack(t)} className="rounded-full bg-moka-500 p-2 text-white"><Play className="h-4 w-4 fill-white"/></button>
            </div>
          ))}
        </div>
      )}

      {noteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-stone-900/60 p-5 shadow-xl">
            <div className="flex items-center justify-between"><h3 className="font-semibold">Note {noteOpen.type==="artist"?"artiste":"morceau"}</h3><button onClick={()=>setNoteOpen(null)} className="rounded-full bg-stone-900 p-1"><X className="h-4 w-4"/></button></div>
            <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} rows={4} className="mt-3 w-full rounded-xl border border-stone-800 p-3 text-sm outline-none focus:border-moka-500" placeholder="Écrire une note..."/>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={()=>setNoteOpen(null)} className="rounded-full bg-stone-900 px-4 py-1.5 text-sm">Annuler</button>
              <button onClick={()=>{ if(noteOpen.type==="track") lib.setNote(noteOpen.key, noteText); else lib.setArtistNote(noteOpen.key, noteText); setNoteOpen(null)}} className="rounded-full bg-moka-500 px-4 py-1.5 text-sm font-bold text-white">Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {track && (
        <div className="mt-8 rounded-2xl bg-moka-900 p-4 text-stone-400">
          <p className="text-xs tracking-widest text-stone-400">EN COURS</p>
          <p className="font-semibold text-white">{track.manifest.metadata.title} — {track.manifest.metadata.artist}</p>
          <p className="text-xs text-stone-400">{track.manifest.metadata.album}</p>
        </div>
      )}
    </div>
  )
}
