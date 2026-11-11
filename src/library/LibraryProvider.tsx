import { useEffect, useMemo, useState, type ReactNode } from "react"
import { LibraryContext, type LibraryState } from "./store"

const LS_KEY = "moka:library:v2"

function load(): LibraryState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if(raw){
      const p = JSON.parse(raw)
      return {
        favorites: new Set(p.favorites||[]),
        artistFavorites: new Set(p.artistFavorites||[]),
        notes: p.notes||{},
        artistNotes: p.artistNotes||{},
        playlists: p.playlists||[],
        queueKeys: [],
        repeat: p.repeat||"off",
        shuffle: p.shuffle||false,
      }
    }
  }catch{}
  return { favorites: new Set(), artistFavorites: new Set(), notes:{}, artistNotes:{}, playlists:[], queueKeys:[], repeat:"off", shuffle:false }
}

export function LibraryProvider({ children }:{children: ReactNode}){
  const [s,setS] = useState<LibraryState>(()=>load())
  useEffect(()=>{
    localStorage.setItem(LS_KEY, JSON.stringify({
      favorites: [...s.favorites],
      artistFavorites: [...s.artistFavorites],
      notes: s.notes,
      artistNotes: s.artistNotes,
      playlists: s.playlists,
      repeat: s.repeat,
      shuffle: s.shuffle,
    }))
  },[s])

  const api = useMemo(()=>({
    ...s,
    toggleFavorite: (k:string)=> setS(v=> {
      const n = new Set(v.favorites)
      if(n.has(k)) n.delete(k); else n.add(k)
      return {...v, favorites:n}
    }),
    toggleArtistFavorite: (a:string)=> setS(v=> {
      const n = new Set(v.artistFavorites)
      if(n.has(a)) n.delete(a); else n.add(a)
      return {...v, artistFavorites:n}
    }),
    setNote: (k:string, note:string)=> setS(v=> ({...v, notes:{...v.notes, [k]: note}})),
    setArtistNote: (a:string, note:string)=> setS(v=> ({...v, artistNotes:{...v.artistNotes, [a]: note}})),
    createPlaylist: (name:string)=> {
      const id = Math.random().toString(36).slice(2,9)
      setS(v=> ({...v, playlists:[...v.playlists, {id, name, trackKeys:[], createdAt: Date.now()}]}))
      return id
    },
    deletePlaylist: (id:string)=> setS(v=> ({...v, playlists: v.playlists.filter(p=>p.id!==id)})),
    addToPlaylist: (id:string, key:string)=> setS(v=> ({...v, playlists: v.playlists.map(p=> p.id===id && !p.trackKeys.includes(key) ? {...p, trackKeys:[...p.trackKeys, key]} : p)})),
    removeFromPlaylist: (id:string, key:string)=> setS(v=> ({...v, playlists: v.playlists.map(p=> p.id===id ? {...p, trackKeys: p.trackKeys.filter(k=>k!==key)} : p)})),
    renamePlaylist: (id:string, name:string)=> setS(v=> ({...v, playlists: v.playlists.map(p=> p.id===id ? {...p, name}:p)})),
    setRepeat: (r: LibraryState["repeat"])=> setS(v=> ({...v, repeat:r})),
    setShuffle: (b:boolean)=> setS(v=> ({...v, shuffle:b})),
  }),[s])

  return <LibraryContext.Provider value={api}>{children}</LibraryContext.Provider>
}
