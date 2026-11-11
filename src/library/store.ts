import { createContext, useContext } from "react"

export type TrackKey = string

export function trackKey(manifest: { metadata: { title: string; artist: string; album: string } }): TrackKey {
  return `${manifest.metadata.artist.toLowerCase().trim()}|||${manifest.metadata.title.toLowerCase().trim()}|||${manifest.metadata.album.toLowerCase().trim()}`
}
export function artistKey(artist: string) { return `artist::${artist.toLowerCase().trim()}` }

export interface Playlist {
  id: string
  name: string
  trackKeys: TrackKey[]
  createdAt: number
}

export interface LibraryState {
  favorites: Set<TrackKey>
  artistFavorites: Set<string>
  notes: Record<TrackKey, string>
  artistNotes: Record<string, string>
  playlists: Playlist[]
  queueKeys: TrackKey[]
  repeat: "off" | "one" | "all"
  shuffle: boolean
}

export const LibraryContext = createContext<LibraryState & {
  toggleFavorite: (k: TrackKey)=>void
  toggleArtistFavorite: (a: string)=>void
  setNote: (k: TrackKey, note: string)=>void
  setArtistNote: (a: string, note: string)=>void
  createPlaylist: (name: string)=>string
  deletePlaylist: (id: string)=>void
  addToPlaylist: (id: string, key: TrackKey)=>void
  removeFromPlaylist: (id: string, key: TrackKey)=>void
  renamePlaylist: (id: string, name: string)=>void
  setRepeat: (r: LibraryState["repeat"])=>void
  setShuffle: (s: boolean)=>void
} | null>(null)

export function useLibrary() {
  const v = useContext(LibraryContext)
  if(!v) throw new Error("LibraryContext missing")
  return v
}
