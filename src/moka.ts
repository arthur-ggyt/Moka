// ============================================================
// FORMAT MOKA — conteneur multimédia
//
// Structure binaire :
//   [0..3]   Magic "MOKA" (ASCII)
//   [4]      Version (u8) = 1
//   [5..8]   Taille du manifeste JSON (u32 little-endian)
//   [...]    Manifeste JSON (UTF-8)
//   [...]    Sections binaires, dans l'ordre :
//            COVER → AUDIO → VIDEO1 (clip) → VIDEO2 (paroles)
// ============================================================

import type { Lyrics } from "./lyrics";

export type AudioFormat = "mp3" | "wav" | "flac" | "m4a";
export type AudioQuality = "LOW-FI" | "HI-FI";

export interface MokaMetadata {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: string;
  discNumber: string;
  year: string;
  genre: string;
  composer: string;
  comment: string;
}

export const EMPTY_METADATA: MokaMetadata = {
  title: "",
  artist: "",
  album: "",
  albumArtist: "",
  trackNumber: "",
  discNumber: "",
  year: "",
  genre: "",
  composer: "",
  comment: "",
};

interface SectionInfo {
  mime: string;
  size: number;
  width?: number;
  height?: number;
}

/** Recadrage d'affichage appliqué à une vidéo.
 *  aspect = 0 → aucun recadrage (contenu original).
 *  posX / posY = centre du cadrage, de 0 (gauche/haut) à 1 (droite/bas). */
export interface VideoCrop {
  aspect: number;
  posX: number;
  posY: number;
}

export interface PanScanKeyframe {
  time: number;
  x: number;
  y: number;
  confidence: number;
  scene: number;
}

/** Sujet désigné par l'humain pour un plan, en coordonnées de l'image source. */
export interface PanScanSubject {
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clé de cadrage posée à la main. x/y = position du cadre, de 0 à 1. */
export interface PanScanManualKey {
  time: number;
  x: number;
  y: number;
}

export interface PanScanData {
  version: 1;
  aspect: number;
  method: "assisted" | "human" | "person" | "motion";
  confidence: number;
  scenes: number;
  sampleInterval: number;
  keyframes: PanScanKeyframe[];
  subjects?: PanScanSubject[];
  manualKeys?: PanScanManualKey[];
}

/** Fractions of the encoded frame occupied by baked-in black bars. */
export interface ContentBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Mode Loop : l'intro (0 → start) est jouée une fois, la section
 *  [start, end] est répétée indéfiniment, la fin originale est ignorée. */
export interface LoopSettings {
  start: number;
  end: number;
}

export function aspectLabel(a: number): string {
  if (a === 0) return "Original";
  if (Math.abs(a - 1) < 0.01) return "1:1";
  if (Math.abs(a - 4 / 3) < 0.01) return "4:3";
  if (Math.abs(a - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(a - 9 / 16) < 0.02) return "9:16";
  return `×${a.toFixed(2)}`;
}

export interface MokaManifest {
  format: "MOKA";
  version: 1;
  createdAt: string;
  metadata: MokaMetadata;
  audio: SectionInfo & { audioFormat: AudioFormat; quality: AudioQuality };
  cover: SectionInfo | null;
  video1: SectionInfo | null; // CLIP
  video2: SectionInfo | null; // PAROLES
  // Décalage de synchronisation (secondes) : videoTime = musicTime + offset
  video1Offset?: number;
  video2Offset?: number;
  // Recadrage d'affichage des vidéos
  video1Crop?: VideoCrop;
  video2Crop?: VideoCrop;
  // Le crop a déjà été appliqué au média ou le lecteur doit le traiter comme tel.
  video1Cropped?: boolean;
  video2Cropped?: boolean;
  // Trajectoire de cadrage Pan & Scan calculée image par image.
  video1PanScan?: PanScanData;
  video2PanScan?: PanScanData;
  // Bandes noires incrustées (4:3 dans un cadre 16:9, etc.).
  video1Content?: ContentBounds;
  video2Content?: ContentBounds;
  lyrics?: Lyrics;
  // Compatibilité Mode Loop (section répétitive)
  loop?: LoopSettings;
}

export interface MokaFile {
  manifest: MokaManifest;
  audioBlob: Blob;
  coverBlob: Blob | null;
  video1Blob: Blob | null;
  video2Blob: Blob | null;
}

const MAGIC = [0x4d, 0x4f, 0x4b, 0x41]; // "MOKA"

export const QUALITY_BY_FORMAT: Record<AudioFormat, AudioQuality> = {
  mp3: "LOW-FI",
  m4a: "LOW-FI",
  wav: "HI-FI",
  flac: "HI-FI",
};

export const MIME_BY_FORMAT: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
};

export function detectAudioFormat(file: File): AudioFormat | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "mp3") return "mp3";
  if (ext === "wav" || ext === "wave") return "wav";
  if (ext === "flac") return "flac";
  if (ext === "m4a" || ext === "aac" || ext === "mp4a") return "m4a";
  // fallback sur le type MIME
  const t = file.type.toLowerCase();
  if (t.includes("mpeg")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("flac")) return "flac";
  if (t.includes("mp4") || t.includes("aac") || t.includes("m4a")) return "m4a";
  return null;
}

// ------------------------------------------------------------
// ENCODAGE : construit un Blob .moka
// ------------------------------------------------------------
export function encodeMoka(input: {
  metadata: MokaMetadata;
  audio: File;
  audioFormat: AudioFormat;
  cover: File | null;
  video1: Blob | null;
  video2: Blob | null;
  coverDimensions?: { width: number; height: number };
  video1Dimensions?: { width: number; height: number };
  video2Dimensions?: { width: number; height: number };
  video1Offset?: number;
  video2Offset?: number;
  video1Crop?: VideoCrop | null;
  video2Crop?: VideoCrop | null;
  video1Cropped?: boolean;
  video2Cropped?: boolean;
  video1PanScan?: PanScanData | null;
  video2PanScan?: PanScanData | null;
  video1Content?: ContentBounds | null;
  video2Content?: ContentBounds | null;
  lyrics?: Lyrics | null;
  loop?: LoopSettings | null;
}): Blob {
  const manifest: MokaManifest = {
    format: "MOKA",
    version: 1,
    createdAt: new Date().toISOString(),
    metadata: input.metadata,
    audio: {
      mime: MIME_BY_FORMAT[input.audioFormat],
      size: input.audio.size,
      audioFormat: input.audioFormat,
      quality: QUALITY_BY_FORMAT[input.audioFormat],
    },
    cover: input.cover
      ? {
          mime: input.cover.type || "image/jpeg",
          size: input.cover.size,
          ...(input.coverDimensions ?? {}),
        }
      : null,
    video1: input.video1
      ? {
          mime: input.video1.type || "video/mp4",
          size: input.video1.size,
          ...(input.video1Dimensions ?? {}),
        }
      : null,
    video2: input.video2
      ? {
          mime: input.video2.type || "video/mp4",
          size: input.video2.size,
          ...(input.video2Dimensions ?? {}),
        }
      : null,
    video1Offset: input.video1 ? input.video1Offset ?? 0 : 0,
    video2Offset: input.video2 ? input.video2Offset ?? 0 : 0,
    ...(input.video1 && input.video1Crop && input.video1Crop.aspect > 0
      ? { video1Crop: input.video1Crop }
      : {}),
    ...(input.video2 && input.video2Crop && input.video2Crop.aspect > 0
      ? { video2Crop: input.video2Crop }
      : {}),
    ...(input.video1 ? { video1Cropped: input.video1Cropped ?? false } : {}),
    ...(input.video2 ? { video2Cropped: input.video2Cropped ?? false } : {}),
    ...(input.video1 && input.video1PanScan
      ? { video1PanScan: input.video1PanScan }
      : {}),
    ...(input.video2 && input.video2PanScan
      ? { video2PanScan: input.video2PanScan }
      : {}),
    ...(input.video1 && input.video1Content
      ? { video1Content: input.video1Content }
      : {}),
    ...(input.video2 && input.video2Content
      ? { video2Content: input.video2Content }
      : {}),
    ...(input.lyrics && input.lyrics.lines.length
      ? { lyrics: input.lyrics }
      : {}),
    ...(input.loop && input.loop.end > input.loop.start
      ? { loop: { start: input.loop.start, end: input.loop.end } }
      : {}),
  };

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new Uint8Array(4 + 1 + 4);
  header.set(MAGIC, 0);
  header[4] = 1; // version
  new DataView(header.buffer).setUint32(5, manifestBytes.length, true);

  const parts: BlobPart[] = [header, manifestBytes];
  if (input.cover) parts.push(input.cover);
  parts.push(input.audio);
  if (input.video1) parts.push(input.video1);
  if (input.video2) parts.push(input.video2);

  return new Blob(parts, { type: "application/x-moka" });
}

// ------------------------------------------------------------
// DÉCODAGE : lit un fichier .moka
// ------------------------------------------------------------
export async function decodeMoka(file: File | Blob): Promise<MokaFile> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  if (
    bytes.length < 9 ||
    bytes[0] !== MAGIC[0] ||
    bytes[1] !== MAGIC[1] ||
    bytes[2] !== MAGIC[2] ||
    bytes[3] !== MAGIC[3]
  ) {
    throw new Error("Ce fichier n'est pas un fichier MOKA valide (magic invalide).");
  }

  const version = bytes[4];
  if (version !== 1) {
    throw new Error(`Version MOKA non supportée : ${version}`);
  }

  const manifestLen = new DataView(buf).getUint32(5, true);
  const manifestStart = 9;
  const manifestEnd = manifestStart + manifestLen;
  if (manifestEnd > bytes.length) {
    throw new Error("Fichier MOKA corrompu (manifeste tronqué).");
  }

  let manifest: MokaManifest;
  try {
    manifest = JSON.parse(
      new TextDecoder().decode(bytes.subarray(manifestStart, manifestEnd))
    );
  } catch {
    throw new Error("Fichier MOKA corrompu (manifeste illisible).");
  }

  let offset = manifestEnd;
  const slice = (info: SectionInfo | null): Blob | null => {
    if (!info) return null;
    const end = offset + info.size;
    if (end > bytes.length) throw new Error("Fichier MOKA corrompu (section tronquée).");
    const blob = new Blob([bytes.subarray(offset, end)], { type: info.mime });
    offset = end;
    return blob;
  };

  const coverBlob = slice(manifest.cover);
  const audioBlob = slice(manifest.audio);
  const video1Blob = slice(manifest.video1);
  const video2Blob = slice(manifest.video2);

  if (!audioBlob) throw new Error("Fichier MOKA invalide : aucune piste audio.");

  return { manifest, audioBlob, coverBlob, video1Blob, video2Blob };
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}
