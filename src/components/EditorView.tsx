import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  EMPTY_METADATA,
  QUALITY_BY_FORMAT,
  aspectLabel,
  detectAudioFormat,
  encodeMoka,
  formatBytes,
  type AudioFormat,
  type MokaMetadata,
  type ContentBounds,
  type LoopSettings,
  type PanScanData,
  type VideoCrop,
} from "../moka";
import { formatTime } from "../moka";
import { usePlayer } from "../player/PlayerContext";
import { SyncCalibrator } from "./SyncCalibrator";
import { CropCalibrator } from "./CropCalibrator";
import { PanScanCalibrator } from "./PanScanCalibrator";
import {
  getVideoOutputSize,
  MAX_VIDEO_DIMENSION,
  prepareVideoForMoka,
} from "../video/transcode";
import { detectVideoLetterbox, hasContentBars } from "../video/letterbox";
import { parseLyrics, stampToSeconds, type Lyrics } from "../lyrics";
import { extractWaveform, type Waveform } from "../audio/waveform";

const MAX_DIM = MAX_VIDEO_DIMENSION;

interface MediaPick {
  file: File;
  url: string;
  width: number | null;
  height: number | null;
  resizedFrom?: { width: number; height: number };
  content?: ContentBounds | null;
}

function useObjectUrlCleanup(pick: MediaPick | null) {
  useEffect(() => {
    return () => {
      if (pick) URL.revokeObjectURL(pick.url);
    };
  }, [pick]);
}

async function probeImage(file: File): Promise<MediaPick> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ file, url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ file, url, width: null, height: null });
    img.src = url;
  });
}

async function resizeCoverIfNeeded(file: File): Promise<MediaPick> {
  const pick = await probeImage(file);
  if (!oversize(pick) || !pick.width || !pick.height) return pick;

  const scale = Math.min(MAX_DIM / pick.width, MAX_DIM / pick.height, 1);
  const width = Math.max(1, Math.floor(pick.width * scale));
  const height = Math.max(1, Math.floor(pick.height * scale));
  const image = new Image();
  image.src = pick.url;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return pick;
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.88)
  );
  if (!blob) return pick;

  const extension = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1] || "png";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const resizedFile = new File([blob], `${baseName}.${extension}`, { type: blob.type });
  URL.revokeObjectURL(pick.url);
  return {
    file: resizedFile,
    url: URL.createObjectURL(resizedFile),
    width,
    height,
    resizedFrom: { width: pick.width, height: pick.height },
  };
}

async function probeVideo(file: File): Promise<MediaPick> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () =>
      resolve({ file, url, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => resolve({ file, url, width: null, height: null });
    v.src = url;
  });
}

function oversize(p: MediaPick | null): boolean {
  return !!p && p.width !== null && p.height !== null && (p.width > MAX_DIM || p.height > MAX_DIM);
}

function requiresCrop(pick: MediaPick | null, crop: VideoCrop | null): boolean {
  if (!pick?.width || !pick.height || !crop || crop.aspect <= 0) return false;
  return Math.abs(pick.width / pick.height - crop.aspect) > 0.02;
}

interface EditorProps {
  onCreated: () => void;
}

export function EditorView({ onCreated }: EditorProps) {
  const { loadMokaFile } = usePlayer();

  // --- AUDIO ---
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioFormat, setAudioFormat] = useState<AudioFormat | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // --- COVER / VIDÉOS ---
  const [cover, setCover] = useState<MediaPick | null>(null);
  const [video1, setVideo1] = useState<MediaPick | null>(null);
  const [video2, setVideo2] = useState<MediaPick | null>(null);
  useObjectUrlCleanup(cover);
  useObjectUrlCleanup(video1);
  useObjectUrlCleanup(video2);

  // --- SYNCHRONISATION VIDÉO (recalibrage audio) ---
  const [video1Offset, setVideo1Offset] = useState(0);
  const [video2Offset, setVideo2Offset] = useState(0);
  const [calibrating, setCalibrating] = useState<1 | 2 | null>(null);

  // --- RECADRAGE VIDÉO (recalibrage image) ---
  const [video1Crop, setVideo1Crop] = useState<VideoCrop | null>(null);
  const [video2Crop, setVideo2Crop] = useState<VideoCrop | null>(null);
  const [cropping, setCropping] = useState<1 | 2 | null>(null);
  const [video1PanScan, setVideo1PanScan] = useState<PanScanData | null>(null);
  const [video2PanScan, setVideo2PanScan] = useState<PanScanData | null>(null);
  const [scanning, setScanning] = useState<1 | 2 | null>(null);

  // --- MÉTADONNÉES ---
  const [meta, setMeta] = useState<MokaMetadata>({ ...EMPTY_METADATA });
  const [lyricsMode, setLyricsMode] = useState<"text" | "lrc">("text");
  const [lyricsText, setLyricsText] = useState("");
  const [lyricsName, setLyricsName] = useState("");

  // --- MODE LOOP ---
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState("0:20");
  const [loopEnd, setLoopEnd] = useState("2:30");
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState<"loop" | "seam" | "audition" | null>(null);
  const previewRef = useRef<{
    audio: HTMLAudioElement;
    url: string;
    mode: "loop" | "seam" | "audition";
    wrapped: boolean;
  } | null>(null);
  const [loopWave, setLoopWave] = useState<Waveform | null>(null);
  const [loopWaveLoading, setLoopWaveLoading] = useState(false);
  const [loopWaveError, setLoopWaveError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);

  // --- CRÉATION ---
  const [errors, setErrors] = useState<string[]>([]);
  const [created, setCreated] = useState<{ blob: Blob; name: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState(0);
  const [creationMessage, setCreationMessage] = useState("");
  const downloadRef = useRef<HTMLAnchorElement>(null);

  const setField = (k: keyof MokaMetadata) => (e: ChangeEvent<HTMLInputElement>) =>
    setMeta((m) => ({ ...m, [k]: e.target.value }));

  const onAudioChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const fmt = detectAudioFormat(f);
    if (!fmt) {
      setAudioError("Format audio non reconnu. Formats acceptés : MP3, WAV, FLAC, M4A.");
      setAudioFile(null);
      setAudioFormat(null);
      return;
    }
    setAudioError(null);
    setAudioFile(f);
    setAudioFormat(fmt);
    setCreated(null);
    // Pré-remplir le titre depuis le nom du fichier si vide
    setMeta((m) => {
      if (m.title) return m;
      const base = f.name.replace(/\.[^.]+$/, "");
      const dash = base.split(" - ");
      if (dash.length >= 2) {
        return {
          ...m,
          artist: m.artist || dash[0].trim(),
          title: dash.slice(1).join(" - ").trim(),
        };
      }
      return { ...m, title: base };
    });
  };

  const onCoverChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setCover(await resizeCoverIfNeeded(f));
      setErrors([]);
    } catch {
      setErrors(["Cette image n'a pas pu être chargée ou redimensionnée."]);
    }
    setCreated(null);
  };

  const onVideoChosen =
    (
      setter: typeof setVideo1,
      offsetSetter: (v: number) => void,
      cropSetter: (v: VideoCrop | null) => void,
      panScanSetter: (v: PanScanData | null) => void
    ) =>
    async (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      const picked = await probeVideo(f);
      setter(picked);
      offsetSetter(0); // nouveau fichier → remise à zéro du décalage
      cropSetter(null); // et du recadrage
      panScanSetter(null);
      setCreated(null);
      void detectVideoLetterbox(f).then((bounds) => {
        setter((current) => {
          if (!current || current.file !== f) return current;
          return { ...current, content: hasContentBars(bounds) ? bounds : null };
        });
      });
    };

  const lyrics = useMemo<Lyrics | null>(() => {
    if (!lyricsText.trim()) return null;
    return parseLyrics(lyricsText, lyricsMode);
  }, [lyricsMode, lyricsText]);

  const quality = audioFormat ? QUALITY_BY_FORMAT[audioFormat] : null;

  // --- Durée de l'audio (pour la validation et la frise de la boucle) ---
  useEffect(() => {
    if (!audioFile) {
      setAudioDuration(null);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    const probe = new Audio(url);
    probe.preload = "metadata";
    const onMeta = () => setAudioDuration(Number.isFinite(probe.duration) ? probe.duration : null);
    probe.addEventListener("loadedmetadata", onMeta);
    return () => {
      probe.removeEventListener("loadedmetadata", onMeta);
      probe.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [audioFile]);

  // --- Spectre audio pour prérégler la boucle ---
  useEffect(() => {
    if (!loopEnabled || !audioFile) {
      setLoopWave(null);
      return;
    }
    let cancelled = false;
    setLoopWaveLoading(true);
    setLoopWaveError(null);
    setPlayhead(0);
    extractWaveform(audioFile, 50)
      .then((wf) => {
        if (!cancelled) setLoopWave(wf);
      })
      .catch(() => {
        if (!cancelled) setLoopWaveError("Impossible d'extraire le spectre de cet audio.");
      })
      .finally(() => {
        if (!cancelled) setLoopWaveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audioFile, loopEnabled]);

  // --- Pré-écoutes (boucle, couture fin→début, tête de lecture) ---
  const stopPreview = useCallback(() => {
    if (previewRef.current) {
      previewRef.current.audio.pause();
      URL.revokeObjectURL(previewRef.current.url);
      previewRef.current = null;
    }
    setPreviewMode(null);
  }, []);

  useEffect(() => {
    stopPreview();
  }, [audioFile, stopPreview]);
  useEffect(() => () => stopPreview(), [stopPreview]);

  const loopParsed = {
    start: stampToSeconds(loopStart),
    end: stampToSeconds(loopEnd),
  };
  const loopValid =
    loopParsed.start !== null &&
    loopParsed.end !== null &&
    loopParsed.start >= 0 &&
    loopParsed.end > loopParsed.start;

  const launchPreview = useCallback(
    (mode: "loop" | "seam" | "audition") => {
      if (!audioFile || !loopValid) return;
      stopPreview();
      const s = loopParsed.start as number;
      const e = loopParsed.end as number;
      const seamWindow = Math.min(1.5, Math.max(0.4, (e - s) * 0.3));
      const url = URL.createObjectURL(audioFile);
      const a = new Audio(url);
      const entry = { audio: a, url, mode, wrapped: false };
      previewRef.current = entry;
      a.addEventListener("loadedmetadata", () => {
        if (mode === "audition") {
          a.currentTime = Math.min(playhead, Math.max(0, a.duration - 0.05));
        } else if (mode === "seam") {
          // On part de la fin de la boucle pour entendre la couture.
          a.currentTime = Math.max(s, e - seamWindow);
        } else {
          a.currentTime = s;
        }
        void a.play();
      });
      a.addEventListener("timeupdate", () => {
        if (previewRef.current !== entry) return;
        setPlayhead(a.currentTime);
        if (mode === "seam") {
          if (a.currentTime >= e - 0.03) {
            entry.wrapped = true;
            a.currentTime = s;
          }
          if (entry.wrapped && a.currentTime >= s + seamWindow - 0.02) {
            stopPreview();
          }
        } else if (mode === "loop") {
          if (a.currentTime >= e - 0.03) a.currentTime = s;
        } else {
          if (a.currentTime >= Math.min(playhead, Math.max(0, a.duration - 0.05)) + 2.05) {
            stopPreview();
          }
        }
      });
      a.addEventListener("ended", () => stopPreview());
      setPreviewMode(mode);
    },
    [audioFile, loopValid, loopParsed, playhead, stopPreview]
  );

  const buildLoop = (): LoopSettings | null => {
    if (!loopEnabled || !loopValid) return null;
    return { start: loopParsed.start as number, end: loopParsed.end as number };
  };

  const videoStatus = (
    has: boolean,
    off: number,
    crop: VideoCrop | null,
    panScan: PanScanData | null
  ): string => {
    if (!has) return "—";
    const parts: string[] = [];
    const ms = Math.round(off * 1000);
    if (ms !== 0) parts.push(`${ms > 0 ? "+" : "−"}${Math.abs(ms)} ms`);
    if (crop && crop.aspect > 0) parts.push(aspectLabel(crop.aspect));
    if (panScan) {
      const fps = panScan.sampleInterval > 0 ? Math.round(1 / panScan.sampleInterval) : 20;
      const label =
        panScan.method === "human"
          ? "humain"
          : panScan.method === "assisted"
            ? "IA assistée"
            : "IA";
      parts.push(`${label} · ${fps} img/s`);
    }
    return parts.length > 0 ? `✔ (${parts.join(" · ")})` : "✔";
  };

  const validation = useMemo(() => {
    const errs: string[] = [];
    if (!audioFile || !audioFormat) errs.push("Un fichier audio est requis (MP3, WAV, FLAC ou M4A).");
    if (!meta.title.trim()) errs.push("Le titre est requis.");
    if (!meta.artist.trim()) errs.push("L'artiste est requis.");
    if (oversize(cover)) errs.push(`La cover n'a pas pu être redimensionnée sous ${MAX_DIM} × ${MAX_DIM} pixels.`);
    if (loopEnabled) {
      if (!loopValid) {
        errs.push("Mode Loop : indiquez un début et une fin valides au format mm:ss, avec le début avant la fin.");
      } else if (audioDuration !== null && (loopParsed.end as number) > audioDuration) {
        errs.push(`Mode Loop : la fin (${formatTime(loopParsed.end as number)}) dépasse la durée de l'audio (${formatTime(audioDuration)}).`);
      }
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioFile, audioFormat, meta.title, meta.artist, cover, loopEnabled, loopStart, loopEnd, audioDuration]);

  const createMoka = async () => {
    setErrors(validation);
    if (validation.length > 0 || !audioFile || !audioFormat) return;

    setErrors([]);
    setCreated(null);
    setIsCreating(true);
    setCreationProgress(0);

    try {
      const processVideo = async (
        pick: MediaPick | null,
        crop: VideoCrop | null,
        panScan: PanScanData | null,
        label: string
      ) => {
        if (!pick) return null;
        setCreationMessage(`Redimensionnement de ${label}…`);
        setCreationProgress(0);
        const watermark = !!panScan || requiresCrop(pick, crop)
        const result = await prepareVideoForMoka({
          file: pick.file,
          crop: panScan ? null : crop,
          content: pick.content,
          watermark,
          maxDimension: MAX_DIM,
          onProgress: (progress) => setCreationProgress(Math.round(progress * 100)),
        });
        return result;
      };

      const preparedVideo1 = await processVideo(
        video1,
        video1Crop,
        video1PanScan,
        "la vidéo 1"
      );
      const preparedVideo2 = await processVideo(
        video2,
        video2Crop,
        video2PanScan,
        "la vidéo 2"
      );

      setCreationMessage("Assemblage et vérification du fichier .moka…");
      setCreationProgress(100);
      const blob = encodeMoka({
        metadata: meta,
        audio: audioFile,
        audioFormat,
        cover: cover?.file ?? null,
        coverDimensions:
          cover?.width && cover.height
            ? { width: cover.width, height: cover.height }
            : undefined,
        video1: preparedVideo1?.blob ?? null,
        video2: preparedVideo2?.blob ?? null,
        video1Dimensions: preparedVideo1
          ? { width: preparedVideo1.width, height: preparedVideo1.height }
          : undefined,
        video2Dimensions: preparedVideo2
          ? { width: preparedVideo2.width, height: preparedVideo2.height }
          : undefined,
        video1Offset,
        video2Offset,
        // Garder l'aspect dans le manifeste même si le crop a été encodé :
        // le lecteur en a besoin pour placer le logo dans l'image, sans recrop effectif.
        video1Crop: video1Crop?.aspect ? video1Crop : null,
        video2Crop: video2Crop?.aspect ? video2Crop : null,
        video1Cropped:
          !!video1 && (requiresCrop(video1, video1Crop) || !!video1PanScan),
        video2Cropped:
          !!video2 && (requiresCrop(video2, video2Crop) || !!video2PanScan),
        video1PanScan,
        video2PanScan,
        video1Content:
          preparedVideo1?.transcoded && video1Crop?.aspect && !video1PanScan
            ? null
            : video1?.content,
        video2Content:
          preparedVideo2?.transcoded && video2Crop?.aspect && !video2PanScan
            ? null
            : video2?.content,
        lyrics,
        loop: buildLoop(),
      });

      const name = `${meta.artist.trim()} - ${meta.title.trim()}.moka`;
      setCreated({ blob, name });
      setCreationMessage("Fichier MOKA prêt au téléchargement.");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErrors([
        e instanceof Error
          ? e.message
          : "Le média n'a pas pu être compressé. Vérifiez son format et réessayez.",
      ]);
      setCreationMessage("");
    } finally {
      setIsCreating(false);
    }
  };

  const openInPlayer = () => {
    if (!created) return;
    void loadMokaFile(created.blob, created.name);
    onCreated();
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-6">
      <h2 className="mb-6 text-center text-lg font-bold tracking-[0.3em] text-moka-400">
        CRÉER UN FICHIER MOKA
      </h2>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ============ COLONNE FORMULAIRE ============ */}
        <div className="space-y-6">
          {/* ---- AUDIO ---- */}
          <Section title="AUDIO" required>
            <FilePicker
              label={audioFile ? audioFile.name : "Choisir un fichier audio"}
              accept=".mp3,.wav,.flac,.m4a,audio/mpeg,audio/wav,audio/flac,audio/mp4"
              onChange={onAudioChosen}
              filled={!!audioFile}
            />
            {audioError && <p className="mt-2 text-xs text-red-400">! {audioError}</p>}
            <p className="mt-2 text-xs text-stone-400">
              Formats acceptés : MP3, M4A (LOW-FI) · WAV, FLAC (HI-FI)
            </p>

            {audioFile && audioFormat && (
              <div className="mt-3 rounded-lg border border-stone-800 bg-stone-950 p-3 text-sm">
                <p className="text-stone-400">
                  Format détecté :{" "}
                  <span className="font-bold text-moka-400">
                    {audioFormat.toUpperCase()}
                  </span>
                </p>
                <div className="mt-2 flex gap-2">
                  <QualityBadge
                    active={quality === "LOW-FI"}
                    label="LOW-FI"
                    sub="MP3 / M4A"
                  />
                  <QualityBadge
                    active={quality === "HI-FI"}
                    label="HI-FI"
                    sub="WAV / FLAC"
                  />
                </div>
                <p className="mt-2 text-xs text-stone-400">
                  Taille : {formatBytes(audioFile.size)}
                </p>
              </div>
            )}
          </Section>

          {/* ---- COVER ---- */}
          <Section title="COVER">
            <FilePicker
              label={cover ? cover.file.name : "Choisir une image (JPG, PNG, WebP)"}
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              onChange={onCoverChosen}
              filled={!!cover}
            />
            <p className="mt-2 text-xs text-stone-400">Maximum : 1000 × 1000 pixels</p>
            {cover && (
              <div className="mt-3 flex items-center gap-3">
                <img
                  src={cover.url}
                  alt="Aperçu cover"
                  className="h-20 w-20 rounded-lg border border-stone-700 object-cover"
                />
                <div className="text-xs text-stone-400">
                  <p>
                    {cover.width ?? "?"} × {cover.height ?? "?"} px ·{" "}
                    {formatBytes(cover.file.size)}
                  </p>
                  {cover.resizedFrom && (
                    <p className="mt-1 font-semibold text-emerald-400">
                      ✔ Redimensionnée : {cover.resizedFrom.width} × {cover.resizedFrom.height}
                      {" → "}
                      {cover.width} × {cover.height} px
                    </p>
                  )}
                  {oversize(cover) && (
                    <p className="mt-1 font-semibold text-red-400">
                      ! L'image n'a pas pu être redimensionnée automatiquement.
                    </p>
                  )}
                  <button
                    onClick={() => setCover(null)}
                    className="mt-1 text-stone-400 underline hover:text-red-400"
                  >
                    Retirer
                  </button>
                </div>
              </div>
            )}
          </Section>

          {/* ---- VIDÉOS ---- */}
          <VideoSection
            title="VIDÉO 1 — CLIP"
            pick={video1}
            onChange={onVideoChosen(
              setVideo1,
              setVideo1Offset,
              setVideo1Crop,
              setVideo1PanScan
            )}
            onRemove={() => {
              setVideo1(null);
              setVideo1Offset(0);
              setVideo1Crop(null);
              setVideo1PanScan(null);
            }}
            offset={video1Offset}
            canCalibrate={!!audioFile}
            onCalibrate={() => setCalibrating(1)}
            crop={video1Crop}
            onCrop={() => setCropping(1)}
            panScan={video1PanScan}
            onPanScan={() => setScanning(1)}
            onDisablePanScan={() => {
              setVideo1PanScan(null);
              setCreated(null);
            }}
          />
          <VideoSection
            title="VIDÉO 2 — PAROLES"
            pick={video2}
            onChange={onVideoChosen(
              setVideo2,
              setVideo2Offset,
              setVideo2Crop,
              setVideo2PanScan
            )}
            onRemove={() => {
              setVideo2(null);
              setVideo2Offset(0);
              setVideo2Crop(null);
              setVideo2PanScan(null);
            }}
            offset={video2Offset}
            canCalibrate={!!audioFile}
            onCalibrate={() => setCalibrating(2)}
            crop={video2Crop}
            onCrop={() => setCropping(2)}
            panScan={video2PanScan}
            onPanScan={() => setScanning(2)}
            onDisablePanScan={() => {
              setVideo2PanScan(null);
              setCreated(null);
            }}
          />

          <Section title="PAROLES">
            <div className="mb-3 flex gap-2">
              <button
                onClick={() => setLyricsMode("text")}
                className={`rounded-full px-4 py-1.5 text-xs font-bold tracking-widest ${
                  lyricsMode === "text"
                    ? "bg-moka-900 text-white"
                    : "border border-stone-700 text-stone-400"
                }`}
              >
                TEXTE
              </button>
              <button
                onClick={() => setLyricsMode("lrc")}
                className={`rounded-full px-4 py-1.5 text-xs font-bold tracking-widest ${
                  lyricsMode === "lrc"
                    ? "bg-moka-900 text-white"
                    : "border border-stone-700 text-stone-400"
                }`}
              >
                .LRC SYNCHRONISÉ
              </button>
            </div>
            {lyricsMode === "lrc" && (
              <FilePicker
                label={lyricsName || "Importer un fichier .lrc"}
                accept=".lrc,text/plain"
                filled={!!lyricsName}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void file.text().then((value) => {
                    setLyricsText(value);
                    setLyricsName(file.name);
                    setLyricsMode("lrc");
                    setCreated(null);
                  });
                }}
              />
            )}
            <textarea
              value={lyricsText}
              onChange={(event) => {
                setLyricsText(event.target.value);
                setCreated(null);
              }}
              rows={7}
              placeholder={
                lyricsMode === "lrc"
                  ? "[00:12.00] Première ligne\n[00:16.40] Ligne suivante"
                  : "Collez les paroles, une ligne par passage…"
              }
              className="mt-3 w-full resize-y rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm leading-relaxed text-stone-200 outline-none focus:border-moka-600"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-stone-400">
              <span>
                {lyrics
                  ? lyrics.format === "lrc"
                    ? `${lyrics.lines.length} lignes minutées`
                    : `${lyrics.lines.length} lignes · surlignage estimé à la lecture`
                  : "Aucun texte"}
              </span>
              {lyricsText && (
                <button
                  onClick={() => {
                    setLyricsText("");
                    setLyricsName("");
                    setCreated(null);
                  }}
                  className="underline hover:text-red-400"
                >
                  Effacer
                </button>
              )}
            </div>
          </Section>

          {/* ---- MODE LOOP ---- */}
          <Section title="RÉGLAGES DE CRÉATION — MODE LOOP">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={loopEnabled}
                onChange={(e) => {
                  setLoopEnabled(e.target.checked);
                  setCreated(null);
                }}
                className="h-4 w-4 accent-moka-500"
              />
              Activer la compatibilité avec le Mode Loop
            </label>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">
              Le lecteur joue l'introduction une seule fois, puis répète indéfiniment la
              section Loop — la fin originale n'est jamais jouée. Idéal pour les musiques
              d'ambiance et les fonds sonores.
            </p>
            {loopEnabled &&
              (!audioFile ? (
                <p className="mt-3 text-xs text-yellow-400">
                  Choisissez d'abord un fichier audio pour définir la boucle.
                </p>
              ) : (
                <div className="mt-3 rounded-lg border border-stone-800 bg-stone-950 p-3">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <label className="flex items-center gap-2 text-xs text-stone-400">
                      Début
                      <input
                        value={loopStart}
                        onChange={(e) => {
                          setLoopStart(e.target.value);
                          setCreated(null);
                        }}
                        placeholder="0:20.000"
                        className="w-24 rounded-lg border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-sm tabular-nums text-stone-200 outline-none focus:border-moka-600"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-stone-400">
                      Fin
                      <input
                        value={loopEnd}
                        onChange={(e) => {
                          setLoopEnd(e.target.value);
                          setCreated(null);
                        }}
                        placeholder="2:30.000"
                        className="w-24 rounded-lg border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-sm tabular-nums text-stone-200 outline-none focus:border-moka-600"
                      />
                    </label>
                    {audioDuration !== null && (
                      <span className="text-xs text-stone-500">
                        Durée : {formatTime(audioDuration)}
                      </span>
                    )}
                    <span className="text-xs tabular-nums text-stone-500">
                      Tête de lecture :{" "}
                      <span className="text-stone-200">{formatMs(playhead)}</span>
                    </span>
                  </div>

                  {!loopValid && (
                    <p className="mt-2 text-xs text-red-400">
                      Format : mm:ss.mmm (précision à la milliseconde), avec le début avant la fin.
                    </p>
                  )}

                  {/* Spectre audio + coupes */}
                  <div className="mt-3">
                    {loopWaveLoading && (
                      <p className="text-xs text-stone-500">Extraction du spectre audio…</p>
                    )}
                    {loopWaveError && (
                      <p className="text-xs text-yellow-400">{loopWaveError}</p>
                    )}
                    {loopWave && !loopWaveLoading && (
                      <>
                        <LoopWaveformEditor
                          wave={loopWave}
                          start={loopParsed.start ?? 0}
                          end={loopParsed.end ?? loopWave.duration}
                          playhead={playhead}
                          onScrub={(t) => setPlayhead(t)}
                          onSetStart={(t) => {
                            const e = loopParsed.end;
                            const cap = e !== null ? e - 0.02 : Number.MAX_SAFE_INTEGER;
                            setLoopStart(toMsStamp(Math.max(0, Math.min(t, cap))));
                            setCreated(null);
                          }}
                          onSetEnd={(t) => {
                            const s = loopParsed.start ?? 0;
                            const cap = audioDuration ?? Number.MAX_SAFE_INTEGER;
                            setLoopEnd(toMsStamp(Math.max(s + 0.02, Math.min(t, cap))));
                            setCreated(null);
                          }}
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => {
                              setLoopStart(toMsStamp(playhead));
                              setCreated(null);
                            }}
                            className="rounded-full border border-moka-700 px-3 py-1 text-xs font-semibold text-moka-300 transition hover:bg-moka-950/60"
                          >
                            Couper le début ici
                          </button>
                          <button
                            onClick={() => {
                              setLoopEnd(toMsStamp(playhead));
                              setCreated(null);
                            }}
                            className="rounded-full border border-moka-700 px-3 py-1 text-xs font-semibold text-moka-300 transition hover:bg-moka-950/60"
                          >
                            Couper la fin ici
                          </button>
                          <span className="text-[10px] text-stone-600">
                            Glissez sur le spectre pour placer la tête de lecture · tirez les
                            poignées A / B pour couper à la milliseconde.
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Pré-écoutes */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {previewMode === null ? (
                      <>
                        <button
                          onClick={() => launchPreview("seam")}
                          disabled={!loopValid}
                          className="rounded-full bg-moka-900 px-4 py-1.5 text-xs font-bold tracking-widest text-white transition hover:bg-moka-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Préécouter la couture
                        </button>
                        <button
                          onClick={() => launchPreview("loop")}
                          disabled={!loopValid}
                          className="rounded-full bg-stone-700 px-4 py-1.5 text-xs font-bold tracking-widest text-stone-200 transition hover:bg-stone-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Préécouter la boucle
                        </button>
                        <button
                          onClick={() => launchPreview("audition")}
                          disabled={!loopValid}
                          className="rounded-full bg-stone-700 px-4 py-1.5 text-xs font-bold tracking-widest text-stone-200 transition hover:bg-stone-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Écouter à la tête (2 s)
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={stopPreview}
                        className="rounded-full bg-stone-700 px-4 py-1.5 text-xs font-bold tracking-widest text-stone-200 transition hover:bg-stone-600"
                      >
                        Arrêter la pré-écoute
                      </button>
                    )}
                    <span className="text-[10px] leading-relaxed text-stone-600">
                      « Couture » : la fin de la boucle est écoutée puis le début enchaîne, pour
                      vérifier que la transition est fluide. La tête de lecture suit la pré-écoute.
                    </span>
                  </div>
                </div>
              ))}
          </Section>

          {/* ---- MÉTADONNÉES ---- */}
          <Section title="MÉTADONNÉES">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Titre *" value={meta.title} onChange={setField("title")} />
              <Field label="Artiste *" value={meta.artist} onChange={setField("artist")} />
              <Field label="Album" value={meta.album} onChange={setField("album")} />
              <Field
                label="Artiste de l'album"
                value={meta.albumArtist}
                onChange={setField("albumArtist")}
              />
              <Field
                label="Numéro de piste"
                value={meta.trackNumber}
                onChange={setField("trackNumber")}
              />
              <Field
                label="Numéro de disque"
                value={meta.discNumber}
                onChange={setField("discNumber")}
              />
              <Field label="Année" value={meta.year} onChange={setField("year")} />
              <Field label="Genre" value={meta.genre} onChange={setField("genre")} />
              <Field
                label="Compositeur"
                value={meta.composer}
                onChange={setField("composer")}
              />
              <Field
                label="Commentaire"
                value={meta.comment}
                onChange={setField("comment")}
              />
            </div>
          </Section>

          {/* ---- ERREURS ---- */}
          {errors.length > 0 && (
            <div className="rounded-lg border border-red-800 bg-red-950/60 p-4 text-sm text-red-300">
              <p className="mb-1 font-bold">Impossible de créer le fichier :</p>
              <ul className="list-inside list-disc space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- BOUTON CRÉER ---- */}
          {isCreating && (
            <div className="rounded-lg border border-stone-800 bg-stone-950 p-4">
              <div className="flex items-center justify-between gap-3 text-xs text-moka-300">
                <span>{creationMessage}</span>
                <span className="tabular-nums">{creationProgress}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-700">
                <div
                  className="h-full rounded-full bg-moka-700 transition-[width]"
                  style={{ width: `${creationProgress}%` }}
                />
              </div>
              <p className="mt-2 text-[10px] text-stone-400">
                Les vidéos sont traitées dans le navigateur. Ne fermez pas cette page.
              </p>
            </div>
          )}
          <button
            onClick={createMoka}
            disabled={isCreating}
            className="w-full rounded-xl bg-moka-900 py-4 text-sm font-bold tracking-[0.25em] text-white shadow-lg shadow-moka-900/30 transition hover:bg-moka-700 disabled:cursor-wait disabled:opacity-60"
          >
            {isCreating ? "… TRAITEMENT EN COURS…" : "CRÉER LE MOKA"}
          </button>

          {created && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 text-sm text-emerald-300">
              <p className="font-bold">✔ Fichier MOKA créé avec succès !</p>
              <p className="mt-1 text-emerald-400">
                {created.name} · {formatBytes(created.blob.size)}
              </p>
              <p className="mt-1 text-xs text-emerald-400">
                Le téléchargement a démarré automatiquement.
              </p>
              <button
                onClick={openInPlayer}
                className="mt-3 rounded-full border border-emerald-300 px-4 py-1.5 text-xs font-bold tracking-widest text-emerald-300 transition hover:bg-emerald-100"
              >
                ▶ OUVRIR DANS LE LECTEUR
              </button>
            </div>
          )}
          <a ref={downloadRef} className="hidden" />
        </div>

        {/* ============ COLONNE APERÇU ============ */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-stone-800 bg-stone-900/60 p-5">
            <p className="mb-4 text-center text-xs font-bold tracking-[0.3em] text-stone-400">
              APERÇU MOKA
            </p>
            <div className="mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-xl border border-stone-800 bg-stone-950">
              {cover ? (
                <img src={cover.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-5xl text-stone-700">
                  ☕
                </div>
              )}
            </div>
            <div className="mt-4 text-center">
              <p className="truncate font-bold text-stone-100">
                {meta.title || "Titre…"}
              </p>
              <p className="truncate text-sm text-moka-400">
                {meta.artist || "Artiste…"}
              </p>
              <p className="truncate text-xs text-stone-400">
                Album : {meta.album || "—"}
              </p>
            </div>
            <div className="mt-4 space-y-1.5 border-t border-stone-800 pt-3 text-xs">
              <PreviewRow
                label="Audio"
                value={
                  audioFormat
                    ? `${audioFormat.toUpperCase()} — ${QUALITY_BY_FORMAT[audioFormat]}`
                    : "—"
                }
                ok={!!audioFormat}
              />
              <PreviewRow label="Cover" value={cover ? "✔" : "—"} ok={!!cover} />
              <PreviewRow
                label="Clip"
                value={videoStatus(
                  !!video1,
                  video1Offset,
                  video1Crop,
                  video1PanScan
                )}
                ok={!!video1}
              />
              <PreviewRow
                label="Paroles vidéo"
                value={videoStatus(
                  !!video2,
                  video2Offset,
                  video2Crop,
                  video2PanScan
                )}
                ok={!!video2}
              />
              <PreviewRow
                label="Texte"
                value={
                  lyrics
                    ? lyrics.format === "lrc"
                      ? `LRC · ${lyrics.lines.length}`
                      : `Texte · ${lyrics.lines.length}`
                    : "—"
                }
                ok={!!lyrics}
              />
              <PreviewRow
                label="Mode Loop"
                value={loopEnabled && loopValid ? `${loopStart} → ${loopEnd}` : "—"}
                ok={loopEnabled && loopValid}
              />
            </div>
            {meta.artist && meta.title && (
              <p className="mt-4 truncate rounded-lg bg-stone-950 px-3 py-2 text-center text-[11px] text-stone-400">
                {meta.artist.trim()} - {meta.title.trim()}.moka
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ===== MODAL DE RECALIBRAGE ===== */}
      {calibrating === 1 && audioFile && video1 && (
        <SyncCalibrator
          title={`VIDÉO 1 — CLIP · ${video1.file.name}`}
          musicFile={audioFile}
          videoFile={video1.file}
          videoUrl={video1.url}
          offset={video1Offset}
          onChange={(v) => {
            setVideo1Offset(v);
            setCreated(null);
          }}
          onClose={() => setCalibrating(null)}
        />
      )}
      {calibrating === 2 && audioFile && video2 && (
        <SyncCalibrator
          title={`VIDÉO 2 — PAROLES · ${video2.file.name}`}
          musicFile={audioFile}
          videoFile={video2.file}
          videoUrl={video2.url}
          offset={video2Offset}
          onChange={(v) => {
            setVideo2Offset(v);
            setCreated(null);
          }}
          onClose={() => setCalibrating(null)}
        />
      )}

      {/* ===== MODAL DE RECALIBRAGE D'IMAGE ===== */}
      {cropping === 1 && video1 && (
        <CropCalibrator
          title={`VIDÉO 1 — CLIP · ${video1.file.name}`}
          videoUrl={video1.url}
          videoWidth={video1.width ?? 0}
          videoHeight={video1.height ?? 0}
          crop={video1Crop}
          content={video1.content}
          onChange={(v) => {
            setVideo1Crop(v.aspect > 0 ? v : null);
            setVideo1PanScan(null);
            setCreated(null);
          }}
          onClose={() => setCropping(null)}
        />
      )}
      {cropping === 2 && video2 && (
        <CropCalibrator
          title={`VIDÉO 2 — PAROLES · ${video2.file.name}`}
          videoUrl={video2.url}
          videoWidth={video2.width ?? 0}
          videoHeight={video2.height ?? 0}
          crop={video2Crop}
          content={video2.content}
          onChange={(v) => {
            setVideo2Crop(v.aspect > 0 ? v : null);
            setVideo2PanScan(null);
            setCreated(null);
          }}
          onClose={() => setCropping(null)}
        />
      )}

      {/* ===== MODE PAN & SCAN IA ===== */}
      {scanning === 1 && video1 && (
        <PanScanCalibrator
          title={`VIDÉO 1 — CLIP · ${video1.file.name}`}
          videoFile={video1.file}
          videoUrl={video1.url}
          videoWidth={video1.width ?? 0}
          videoHeight={video1.height ?? 0}
          crop={video1Crop}
          panScan={video1PanScan}
          content={video1.content}
          onApply={(nextCrop, nextTrack) => {
            setVideo1Crop(nextCrop);
            setVideo1PanScan(nextTrack);
            setCreated(null);
            setScanning(null);
          }}
          onClose={() => setScanning(null)}
        />
      )}
      {scanning === 2 && video2 && (
        <PanScanCalibrator
          title={`VIDÉO 2 — PAROLES · ${video2.file.name}`}
          videoFile={video2.file}
          videoUrl={video2.url}
          videoWidth={video2.width ?? 0}
          videoHeight={video2.height ?? 0}
          crop={video2Crop}
          panScan={video2PanScan}
          content={video2.content ?? null}
          onApply={(nextCrop, nextTrack) => {
            setVideo2Crop(nextCrop);
            setVideo2PanScan(nextTrack);
            setCreated(null);
            setScanning(null);
          }}
          onClose={() => setScanning(null)}
        />
      )}
    </div>
  );
}

/* ================= Sous-composants ================= */

function Section({
  title,
  required,
  children,
}: {
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-800 bg-stone-900/50 p-5">
      <h3 className="mb-3 text-xs font-bold tracking-[0.25em] text-moka-400">
        {title}
        {required && <span className="ml-2 text-stone-400">(requis)</span>}
      </h3>
      {children}
    </section>
  );
}

function FilePicker({
  label,
  accept,
  onChange,
  filled,
}: {
  label: string;
  accept: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  filled: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={onChange} />
      <button
        onClick={() => ref.current?.click()}
        className={`w-full truncate rounded-lg border px-4 py-2.5 text-left text-sm transition ${
          filled
            ? "border-moka-800 bg-moka-950/40 text-moka-300"
            : "border-dashed border-stone-700 text-stone-400 hover:border-moka-700 hover:text-moka-400"
        }`}
      >
        {filled ? "" : ""}
        {label}
      </button>
    </>
  );
}

function VideoSection({
  title,
  pick,
  onChange,
  onRemove,
  offset,
  canCalibrate,
  onCalibrate,
  crop,
  onCrop,
  panScan,
  onPanScan,
  onDisablePanScan,
}: {
  title: string;
  pick: MediaPick | null;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  offset: number;
  canCalibrate: boolean;
  onCalibrate: () => void;
  crop: VideoCrop | null;
  onCrop: () => void;
  panScan: PanScanData | null;
  onPanScan: () => void;
  onDisablePanScan: () => void;
}) {
  const ms = Math.round(offset * 1000);
  const outputSize =
    pick?.width && pick.height
      ? getVideoOutputSize(pick.width, pick.height, panScan ? null : crop, MAX_DIM)
      : null;
  return (
    <Section title={title}>
      <FilePicker
        label={pick ? pick.file.name : "Choisir un MP4 (facultatif)"}
        accept=".mp4,video/mp4"
        onChange={onChange}
        filled={!!pick}
      />
      <p className="mt-2 text-xs text-stone-400">
        Maximum : 10 000 × 10 000 pixels · export MP4 si disponible, WebM sinon.
      </p>
      {pick && (
        <div className="mt-3 flex items-center gap-3">
          <video
            src={pick.url}
            muted
            playsInline
            className="h-20 w-32 rounded-lg border border-stone-700 bg-black object-contain"
          />
          <div className="text-xs text-stone-400">
            <p>
              Source : {pick.width ?? "?"} × {pick.height ?? "?"} px · {formatBytes(pick.file.size)}
            </p>
            {outputSize && (
              <>
                <p className="mt-1 font-semibold text-emerald-400">
                  Sortie MOKA : {outputSize.width} × {outputSize.height} px max.
                </p>
                <p className="mt-1 text-[11px] text-moka-400">
                  {outputSize.resized
                    ? panScan
                      ? "Compression auto. · le suivi Pan & Scan reste dynamique."
                      : crop?.aspect
                        ? "Recadrage choisi et compression automatique à la création."
                        : "Compression automatique à la création."
                    : panScan
                      ? "Vidéo source conservée · suivi dynamique dans le lecteur."
                      : crop?.aspect
                        ? "Format choisi conservé, résolution déjà sous la limite."
                        : "Déjà sous la limite, aucun redimensionnement nécessaire."}
                </p>
              </>
            )}
            {!outputSize && (
              <p className="mt-1 font-semibold text-red-400">
                ! Résolution inconnue : la vidéo sera vérifiée à la création.
              </p>
            )}
            {pick.content === undefined && (
              <p className="mt-1 text-[11px] text-stone-400">Recherche des bandes noires…</p>
            )}
            {hasContentBars(pick.content) && (
              <p className="mt-1 font-semibold text-emerald-400">
                Bandes noires détectées : elles restent hors cadre, même en Pan & Scan.
              </p>
            )}
            <button
              onClick={onRemove}
              className="mt-1 text-stone-400 underline hover:text-red-400"
            >
              Retirer
            </button>
          </div>
        </div>
      )}

      {pick && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2.5">
          <button
            onClick={onCalibrate}
            disabled={!canCalibrate}
            title={
              canCalibrate
                ? "Comparer les spectres audio et régler la synchronisation"
                : "Choisissez d'abord un fichier audio pour pouvoir calibrer"
            }
            className="rounded-full border border-sky-800 bg-sky-950/40 px-4 py-1.5 text-xs font-bold tracking-widest text-sky-300 transition hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            RECALIBRER LA SYNCHRO
          </button>
          <span
            className={`text-xs tabular-nums ${
              ms === 0 ? "text-stone-500" : "font-semibold text-sky-400"
            }`}
          >
            Décalage : {ms >= 0 ? "+" : "−"}
            {Math.abs(ms)} ms
          </span>
          {!canCalibrate && (
            <span className="text-[10px] text-stone-500">
              (nécessite un fichier audio)
            </span>
          )}
        </div>
      )}

      {pick && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-violet-950 bg-violet-950/20 px-3 py-2.5">
          <button
            onClick={onPanScan}
            className="rounded-full border border-violet-700 bg-violet-950/50 px-4 py-1.5 text-xs font-bold tracking-widest text-violet-200 transition hover:bg-violet-900/60"
          >
            {panScan ? "RÉGLER LE PAN & SCAN IA" : "ACTIVER PAN & SCAN IA"}
          </button>
          {panScan ? (
            <>
              <span className="text-xs text-violet-300">
                {aspectLabel(panScan.aspect)} ·{" "}
                {panScan.method === "human"
                  ? "suivi humain"
                  : panScan.method === "assisted"
                    ? "IA assistée"
                    : panScan.method === "person"
                      ? "personne suivie"
                      : "suivi de mouvement"}
              </span>
              <button
                onClick={onDisablePanScan}
                className="text-[10px] text-stone-400 underline transition hover:text-red-400"
              >
                Désactiver le suivi
              </button>
            </>
          ) : (
            <span className="text-[10px] text-stone-500">
              Détecte et suit le sujet principal entre les changements de plan
            </span>
          )}
          {requiresCrop(pick, crop) && !panScan && (
            <span className="text-[10px] text-stone-500">
              Logo MOKA discret dans le lecteur
            </span>
          )}
        </div>
      )}

      {pick && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2.5">
          <button
            onClick={onCrop}
            title="Ajuster le format d'affichage de la vidéo (ex. 16:9 → 1:1)"
            className="rounded-full border border-violet-800 bg-violet-950/40 px-4 py-1.5 text-xs font-bold tracking-widest text-violet-300 transition hover:bg-violet-900/50"
          >
            RECALIBRER L'IMAGE
          </button>
          {crop && crop.aspect > 0 ? (
            <span className="text-xs font-semibold text-violet-400">
              Recadrage : {aspectLabel(crop.aspect)}
            </span>
          ) : (
            <span className="text-xs text-stone-500">
              Recadrage : aucun (contenu original)
            </span>
          )}
        </div>
      )}
    </Section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-stone-400">{label}</span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none transition placeholder:text-stone-500 focus:border-moka-600"
      />
    </label>
  );
}

function QualityBadge({
  active,
  label,
  sub,
}: {
  active: boolean;
  label: string;
  sub: string;
}) {
  return (
    <div
      className={`flex-1 rounded-lg border px-3 py-2 text-center ${
        active
          ? "border-moka-600 bg-moka-950/60 text-moka-300"
          : "border-stone-800 text-stone-500"
      }`}
    >
      <p className="text-xs font-bold tracking-widest">
        {active ? "● " : "○ "}
        {label}
      </p>
      <p className="mt-0.5 text-[10px] opacity-70">{sub}</p>
    </div>
  );
}

function PreviewRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-stone-400">{label}</span>
      <span className={ok ? "font-semibold text-emerald-400" : "text-stone-500"}>
        {value}
      </span>
    </div>
  );
}

/* ================= Mode Loop ================= */

/** 1:23.456 → "1:23.456" (avec millisecondes) */
function toMsStamp(sec: number): string {
  const clamped = Math.max(0, sec);
  let m = Math.floor(clamped / 60);
  let s = Math.floor(clamped % 60);
  let ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  if (ms >= 1000) {
    ms -= 1000;
    s += 1;
  }
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function formatMs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00.000";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`;
}

const LOOP_W = 1400;
const LOOP_H = 120;

function LoopWaveformEditor({
  wave,
  start,
  end,
  playhead,
  onScrub,
  onSetStart,
  onSetEnd,
}: {
  wave: Waveform;
  start: number;
  end: number;
  playhead: number;
  onScrub: (t: number) => void;
  onSetStart: (t: number) => void;
  onSetEnd: (t: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<null | "play" | "start" | "end">(null);
  const dur = Math.max(0.001, wave.duration);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = LOOP_W;
    canvas.height = LOOP_H;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, LOOP_W, LOOP_H);
    const mid = LOOP_H / 2;
    const startPx = (start / dur) * LOOP_W;
    const endPx = (end / dur) * LOOP_W;

    // Spectre : intro (sombre), boucle (bleu vif), fin ignorée (gris)
    const n = wave.peaks.length;
    for (let x = 0; x < LOOP_W; x++) {
      const idx = Math.floor((x / LOOP_W) * n);
      const p = wave.peaks[idx] ?? 0;
      const h = Math.max(1, p * (mid - 10));
      const inLoop = x >= startPx && x <= endPx;
      g.fillStyle = inLoop ? "#7c9cf5" : x < startPx ? "#4c61a5" : "#3f3f46";
      g.fillRect(x, mid - h, 1, h * 2);
    }

    // Graduations par seconde
    for (let sec = 0; sec <= dur; sec++) {
      const x = Math.floor((sec / dur) * LOOP_W);
      const major = sec % 5 === 0;
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.fillRect(x, LOOP_H - (major ? 14 : 7), 1, major ? 12 : 6);
      if (major) {
        g.fillStyle = "rgba(255,255,255,0.4)";
        g.font = "9px ui-sans-serif, system-ui";
        g.fillText(formatMs(sec).split(".")[0], x + 3, LOOP_H - 16);
      }
    }

    // Poignées de coupe A / B
    const handles: [number, string][] = [
      [startPx, "A"],
      [endPx, "B"],
    ];
    for (const [px, label] of handles) {
      g.fillStyle = "#fbbf24";
      g.fillRect(px - 1, 0, 2, LOOP_H);
      g.fillRect(px - 8, 0, 16, 12);
      g.fillStyle = "#1c1917";
      g.font = "bold 9px ui-sans-serif, system-ui";
      g.fillText(label, px - 3.5, 9);
    }

    // Tête de lecture
    const phx = Math.max(0, Math.min(LOOP_W, (playhead / dur) * LOOP_W));
    g.fillStyle = "#ffffff";
    g.fillRect(phx - 1, 0, 2, LOOP_H);
    g.beginPath();
    g.moveTo(phx, 12);
    g.lineTo(phx - 5, 12);
    g.lineTo(phx, 19);
    g.closePath();
    g.fill();
  }, [wave, start, end, playhead, dur]);

  const timeAt = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const r = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(ratio * dur * 1000) / 1000;
  };

  const applyDrag = (clientX: number) => {
    const t = timeAt(clientX);
    if (dragRef.current === "start") onSetStart(t);
    else if (dragRef.current === "end") onSetEnd(t);
    else onScrub(t);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * LOOP_W;
    const startPx = (start / dur) * LOOP_W;
    const endPx = (end / dur) * LOOP_W;
    if (Math.abs(px - startPx) < 12) dragRef.current = "start";
    else if (Math.abs(px - endPx) < 12) dragRef.current = "end";
    else dragRef.current = "play";
    e.currentTarget.setPointerCapture(e.pointerId);
    applyDrag(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) applyDrag(e.clientX);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="h-auto w-full cursor-crosshair touch-none rounded-lg border border-stone-800 bg-stone-950"
    />
  );
}
