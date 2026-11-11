import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { drawWaveform, extractWaveform, type Waveform } from "../audio/waveform";
import { autoDetectOffset, type AutoCalibResult } from "../audio/autocalib";

// Convention : videoTime = musicTime + offset
// offset > 0 → la vidéo est lue "plus loin" que la musique (la vidéo était en avance)
// offset < 0 → la vidéo est lue "plus tôt" (la vidéo était en retard)

interface Props {
  title: string;
  musicFile: File;
  videoFile: File;
  videoUrl: string;
  offset: number;
  onChange: (offset: number) => void;
  onClose: () => void;
}

const ZOOMS = [10, 30, 60];

export function SyncCalibrator({
  title,
  musicFile,
  videoFile,
  videoUrl,
  offset,
  onChange,
  onClose,
}: Props) {
  const [musicWave, setMusicWave] = useState<Waveform | null>(null);
  const [videoWave, setVideoWave] = useState<Waveform | null>(null);
  const [waveError, setWaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pxPerSec, setPxPerSec] = useState(30);

  const musicCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);

  // --- Prévisualisation ---
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewStart, setPreviewStart] = useState(0);
  const [listen, setListen] = useState<"music" | "video">("music");

  // --- Calibration automatique (IA) ---
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoResult, setAutoResult] = useState<AutoCalibResult | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);

  // Extraction des deux spectres
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setWaveError(null);
    (async () => {
      try {
        const [mw, vw] = await Promise.all([
          extractWaveform(musicFile),
          extractWaveform(videoFile).catch(() => null),
        ]);
        if (cancelled) return;
        setMusicWave(mw);
        if (vw) setVideoWave(vw);
        else
          setWaveError(
            "Impossible d'extraire le spectre audio de la vidéo (pas de piste audio ou codec non supporté). Vous pouvez quand même régler le décalage manuellement."
          );
      } catch {
        if (!cancelled)
          setWaveError("Impossible d'extraire les spectres audio de ces fichiers.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [musicFile, videoFile]);

  // Dessin
  useEffect(() => {
    if (musicWave && musicCanvasRef.current)
      drawWaveform(musicCanvasRef.current, musicWave, pxPerSec, "#f59e0b");
  }, [musicWave, pxPerSec]);
  useEffect(() => {
    if (videoWave && videoCanvasRef.current)
      drawWaveform(videoCanvasRef.current, videoWave, pxPerSec, "#38bdf8");
  }, [videoWave, pxPerSec]);

  // Audio de prévisualisation (musique)
  useEffect(() => {
    const url = URL.createObjectURL(musicFile);
    const a = new Audio(url);
    a.preload = "auto";
    musicAudioRef.current = a;
    return () => {
      a.pause();
      URL.revokeObjectURL(url);
      musicAudioRef.current = null;
    };
  }, [musicFile]);

  const setOffset = useCallback(
    (v: number) => onChange(Math.round(v * 1000) / 1000),
    [onChange]
  );

  // Analyse IA locale : corrélation croisée des deux spectres
  const runAutoCalibration = useCallback(() => {
    if (!musicWave || !videoWave || autoBusy) return;
    setAutoBusy(true);
    setAutoError(null);
    // petit délai pour laisser l'interface afficher l'état « analyse »
    window.setTimeout(() => {
      try {
        const r = autoDetectOffset(musicWave, videoWave);
        setOffset(r.offset);
        setAutoResult(r);
      } catch {
        setAutoError(
          "L'analyse automatique a échoué. Utilisez le réglage manuel."
        );
      } finally {
        setAutoBusy(false);
      }
    }, 60);
  }, [musicWave, videoWave, autoBusy, setOffset]);

  // Un réglage manuel invalide le résultat de l'IA
  const manualSetOffset = useCallback(
    (v: number) => {
      setAutoResult(null);
      setOffset(v);
    },
    [setOffset]
  );

  // --- Glisser le spectre vidéo pour l'aligner ---
  const dragState = useRef<{ startX: number; startOffset: number } | null>(null);
  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = { startX: e.clientX, startOffset: offset };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    // déplacer le spectre vers la droite = la vidéo commence plus tard = offset diminue
    manualSetOffset(dragState.current.startOffset - dx / pxPerSec);
  };
  const onDragEnd = () => {
    dragState.current = null;
  };

  // --- Prévisualisation synchronisée ---
  const applyPreviewSync = useCallback(() => {
    const a = musicAudioRef.current;
    const v = previewVideoRef.current;
    if (!a || !v) return;
    const target = a.currentTime + offset;
    if (Math.abs(v.currentTime - target) > 0.08) {
      v.currentTime = Math.max(0, Math.min(target, v.duration || target));
    }
  }, [offset]);

  useEffect(() => {
    if (!previewing) return;
    applyPreviewSync();
    const id = window.setInterval(applyPreviewSync, 400);
    return () => window.clearInterval(id);
  }, [previewing, applyPreviewSync]);

  useEffect(() => {
    const a = musicAudioRef.current;
    const v = previewVideoRef.current;
    if (!a || !v) return;
    a.muted = listen !== "music";
    v.muted = listen !== "video";
  }, [listen, previewing]);

  const startPreview = () => {
    const a = musicAudioRef.current;
    const v = previewVideoRef.current;
    if (!a || !v) return;
    a.currentTime = previewStart;
    v.currentTime = Math.max(0, previewStart + offset);
    a.muted = listen !== "music";
    v.muted = listen !== "video";
    void a.play();
    void v.play();
    setPreviewing(true);
  };
  const stopPreview = () => {
    musicAudioRef.current?.pause();
    previewVideoRef.current?.pause();
    setPreviewing(false);
  };

  useEffect(() => () => stopPreview(), []);

  const ms = Math.round(offset * 1000);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-3xl rounded-2xl border border-stone-700 bg-stone-950 p-6 shadow-2xl">
        {/* En-tête */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold tracking-[0.25em] text-moka-400">
              RECALIBRAGE VIDÉO
            </h3>
            <p className="mt-1 text-xs text-stone-400">{title}</p>
          </div>
          <button
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-400 transition hover:border-red-700 hover:text-red-400"
          >
            × Fermer
          </button>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-stone-400">
          Laissez l'IA détecter le décalage optimal, puis affinez si besoin : alignez
          le spectre <span className="font-semibold text-sky-400">bleu (audio de la
          vidéo)</span> avec le spectre{" "}
          <span className="font-semibold text-moka-400">ambre (musique)</span> en le
          faisant glisser. Le décalage obtenu sera enregistré dans le fichier .moka et
          appliqué automatiquement à la lecture.
        </p>

        {/* Calibration automatique IA */}
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-900/60 bg-indigo-950/30 px-4 py-3">
          <button
            onClick={runAutoCalibration}
            disabled={loading || !musicWave || !videoWave || autoBusy}
            title={
              !videoWave
                ? "Spectre vidéo indisponible — impossible d'analyser automatiquement"
                : "L'IA analyse les deux spectres et détecte le décalage optimal (analyse 100 % locale)"
            }
            className="rounded-full bg-indigo-950/300 px-5 py-2 text-xs font-bold tracking-widest text-white shadow-lg shadow-indigo-200/50 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {autoBusy ? "… ANALYSE DES SPECTRES…" : "CALIBRAGE AUTO (IA)"}
          </button>
          {autoResult && (
            <span
              className={`text-xs ${
                autoResult.confidence >= 0.5
                  ? "text-indigo-300"
                  : "text-yellow-400"
              }`}
            >
              {autoResult.confidence >= 0.5 ? "✔" : "!"} Décalage détecté :{" "}
              <strong className="tabular-nums">
                {Math.round(autoResult.offset * 1000) >= 0 ? "+" : "−"}
                {Math.abs(Math.round(autoResult.offset * 1000))} ms
              </strong>{" "}
              · confiance {Math.round(autoResult.confidence * 100)} %
              {autoResult.confidence < 0.5 &&
                " — faible, vérifiez à l'oreille"}
            </span>
          )}
          {autoError && <span className="text-xs text-red-400">! {autoError}</span>}
          <span className="ml-auto text-[10px] text-indigo-400/50">
            IA locale — aucune donnée envoyée
          </span>
        </div>

        {/* Zoom */}
        <div className="mb-3 flex items-center gap-2 text-xs text-stone-400">
          <span>Zoom :</span>
          {ZOOMS.map((z) => (
            <button
              key={z}
              onClick={() => setPxPerSec(z)}
              className={`rounded-full px-3 py-1 transition ${
                pxPerSec === z
                  ? "bg-moka-900 font-bold text-white"
                  : "border border-stone-700 text-stone-400 hover:text-moka-400"
              }`}
            >
              {z === 10 ? "×1" : z === 30 ? "×3" : "×6"}
            </button>
          ))}
          <span className="ml-auto text-stone-500">1 trait vertical = 1 seconde</span>
        </div>

        {/* Spectres */}
        <div className="rounded-xl border border-stone-800 bg-stone-950 p-3">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-3 text-sm text-stone-400">
              <span className="animate-spin text-xl">…</span>
              Extraction des spectres audio…
            </div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <div className="relative inline-block min-w-full">
                {/* Spectre musique */}
                <div className="mb-1 flex items-center gap-2">
                  <span className="w-14 flex-shrink-0 text-[10px] font-bold tracking-wider text-moka-400">
                    MUSIQUE
                  </span>
                  <canvas ref={musicCanvasRef} className="rounded bg-stone-900/60" />
                </div>
                {/* Spectre vidéo, décalé de -offset */}
                <div className="flex items-center gap-2">
                  <span className="w-14 flex-shrink-0 text-[10px] font-bold tracking-wider text-sky-500">
                    VIDÉO
                  </span>
                  {videoWave ? (
                    <div
                      onPointerDown={onDragStart}
                      onPointerMove={onDragMove}
                      onPointerUp={onDragEnd}
                      onPointerCancel={onDragEnd}
                      className="cursor-grab touch-none active:cursor-grabbing"
                      style={{ transform: `translateX(${-offset * pxPerSec}px)` }}
                      title="Glisser pour aligner avec la musique"
                    >
                      <canvas
                        ref={videoCanvasRef}
                        className="rounded bg-sky-950/30 ring-1 ring-sky-900/50"
                      />
                    </div>
                  ) : (
                    <div className="flex h-[88px] flex-1 items-center justify-center rounded bg-stone-900/60 text-xs text-stone-500">
                      Spectre vidéo indisponible
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {waveError && <p className="mt-2 text-xs text-yellow-400">! {waveError}</p>}
        </div>

        {/* Décalage */}
        <div className="mt-4 rounded-xl border border-stone-800 bg-stone-950 p-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <FineBtn label="−1 s" onClick={() => manualSetOffset(offset - 1)} />
            <FineBtn
              label="−100 ms"
              onClick={() => manualSetOffset(offset - 0.1)}
            />
            <FineBtn
              label="−10 ms"
              onClick={() => manualSetOffset(offset - 0.01)}
            />
            <div className="mx-2 min-w-[130px] text-center">
              <p className="text-xl font-black tabular-nums text-moka-400">
                {ms >= 0 ? "+" : "−"}
                {Math.abs(ms)} ms
              </p>
              <p className="text-[10px] text-stone-400">
                {ms === 0
                  ? "aucun décalage"
                  : ms > 0
                    ? "la vidéo est avancée"
                    : "la vidéo est retardée"}
              </p>
            </div>
            <FineBtn
              label="+10 ms"
              onClick={() => manualSetOffset(offset + 0.01)}
            />
            <FineBtn
              label="+100 ms"
              onClick={() => manualSetOffset(offset + 0.1)}
            />
            <FineBtn label="+1 s" onClick={() => manualSetOffset(offset + 1)} />
          </div>
          <div className="mt-3 flex items-center justify-center gap-3">
            <label className="flex items-center gap-2 text-xs text-stone-400">
              Valeur exacte (s) :
              <input
                type="number"
                step={0.01}
                value={offset}
                onChange={(e) => manualSetOffset(Number(e.target.value) || 0)}
                className="w-24 rounded-lg border border-stone-700 bg-stone-950 px-2 py-1 text-sm tabular-nums text-stone-200 outline-none focus:border-moka-600"
              />
            </label>
            <button
              onClick={() => setOffset(0)}
              className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-400 transition hover:border-moka-700 hover:text-moka-400"
            >
              ↺ Réinitialiser
            </button>
          </div>
        </div>

        {/* Prévisualisation */}
        <div className="mt-4 rounded-xl border border-stone-800 bg-stone-950 p-4">
          <p className="mb-3 text-[10px] font-bold tracking-[0.25em] text-stone-400">
            PRÉVISUALISATION SYNCHRONISÉE
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <video
              ref={previewVideoRef}
              src={videoUrl}
              playsInline
              className="h-28 w-28 flex-shrink-0 rounded-lg border border-stone-800 bg-black object-contain"
            />
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-stone-400">
                <label className="flex items-center gap-2">
                  Démarrer à (s) :
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={previewStart}
                    onChange={(e) =>
                      setPreviewStart(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="w-20 rounded-lg border border-stone-700 bg-stone-950 px-2 py-1 text-sm tabular-nums text-stone-200 outline-none focus:border-moka-600"
                  />
                </label>
                <div className="flex items-center gap-1">
                  <span>Écouter :</span>
                  <button
                    onClick={() => setListen("music")}
                    className={`rounded-full px-3 py-1 transition ${
                      listen === "music"
                        ? "bg-moka-900 font-bold text-white"
                        : "border border-stone-700 text-stone-400"
                    }`}
                  >
                    Musique
                  </button>
                  <button
                    onClick={() => setListen("video")}
                    className={`rounded-full px-3 py-1 transition ${
                      listen === "video"
                        ? "bg-sky-600 font-bold text-stone-100"
                        : "border border-stone-700 text-stone-400"
                    }`}
                  >
                    Audio vidéo
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                {!previewing ? (
                  <button
                    onClick={startPreview}
                    className="rounded-full bg-moka-900 px-5 py-1.5 text-xs font-bold tracking-widest text-white transition hover:bg-moka-700"
                  >
                    Play TESTER LA SYNCHRO
                  </button>
                ) : (
                  <button
                    onClick={stopPreview}
                    className="rounded-full bg-stone-700 px-5 py-1.5 text-xs font-bold tracking-widest text-stone-200 transition hover:bg-stone-600"
                  >
                    Stop ARRÊTER
                  </button>
                )}
              </div>
              <p className="text-[10px] leading-relaxed text-stone-500">
                La vidéo est lue avec le décalage appliqué. Basculez entre « Musique »
                et « Audio vidéo » pour vérifier l'alignement à l'oreille.
              </p>
            </div>
          </div>
        </div>

        {/* Valider */}
        <button
          onClick={() => {
            stopPreview();
            onClose();
          }}
          className="mt-4 w-full rounded-xl bg-moka-900 py-3 text-xs font-bold tracking-[0.25em] text-white transition hover:bg-moka-700"
        >
          ✔ VALIDER LE DÉCALAGE ({ms >= 0 ? "+" : "−"}
          {Math.abs(ms)} ms)
        </button>
      </div>
    </div>
  );
}

function FineBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs tabular-nums text-stone-300 transition hover:border-moka-600 hover:text-moka-400"
    >
      {label}
    </button>
  );
}
