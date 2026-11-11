import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  aspectLabel,
  type ContentBounds,
  type PanScanData,
  type PanScanManualKey,
  type PanScanSubject,
  type VideoCrop,
} from "../moka";
import {
  PAN_SCAN_FPS,
  buildHumanPanScan,
  detectPeopleAt,
  getPanScanPosition,
  trackAssistedPanScan,
  type DetectedPerson,
  type PanScanProgress,
} from "../video/panscan";
import { placementStyle, windowInsideContent } from "../video/letterbox";
import { MokaWatermark } from "./MokaWatermark";

interface Props {
  title: string;
  videoFile: File;
  videoUrl: string;
  videoWidth: number;
  videoHeight: number;
  crop: VideoCrop | null;
  panScan: PanScanData | null;
  content?: ContentBounds | null;
  onApply: (crop: VideoCrop, panScan: PanScanData) => void;
  onClose: () => void;
}

const ASPECTS = [
  { value: 1, label: "1:1" },
  { value: 4 / 3, label: "4:3" },
  { value: 16 / 9, label: "16:9" },
  { value: 9 / 16, label: "9:16" },
];

type Mode = "assisted" | "human";

export function PanScanCalibrator({
  title,
  videoFile,
  videoUrl,
  videoWidth,
  videoHeight,
  crop,
  panScan,
  content = null,
  onApply,
  onClose,
}: Props) {
  const initialAspect = panScan?.aspect ?? crop?.aspect ?? 1;
  const [mode, setMode] = useState<Mode>(panScan?.method === "human" ? "human" : "assisted");
  const [aspect, setAspect] = useState(initialAspect);
  const [subjects, setSubjects] = useState<PanScanSubject[]>(panScan?.subjects ?? []);
  const [manualKeys, setManualKeys] = useState<PanScanManualKey[]>(panScan?.manualKeys ?? []);
  const [draft, setDraft] = useState({ x: 0.5, y: 0.5 });
  const [analysis, setAnalysis] = useState<PanScanData | null>(
    panScan?.method === "assisted" || panScan?.method === "human" ? panScan : null
  );
  const [people, setPeople] = useState<DetectedPerson[]>([]);
  const [progress, setProgress] = useState<PanScanProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const sourceAspect = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 0;
  const canPan = sourceAspect > 0 && Math.abs(sourceAspect - aspect) > 0.02;

  const previewPosition = useMemo(() => {
    if (mode === "human" && (dragging || manualKeys.length === 0)) return draft;
    if (analysis && analysis.aspect === aspect && (analysis.method === mode || mode === "human")) {
      return getPanScanPosition(analysis, previewTime);
    }
    return { x: 0.5, y: 0.5 };
  }, [analysis, aspect, draft, dragging, manualKeys.length, mode, previewTime]);

  useEffect(() => {
    if (mode !== "human") return;
    const span = Math.max(duration, ...manualKeys.map((key) => key.time), 0);
    if (!manualKeys.length || span <= 0) return;
    setAnalysis(buildHumanPanScan(aspect, span, manualKeys));
  }, [aspect, duration, manualKeys, mode]);

  useEffect(() => {
    if (!previewPlaying) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (!video) return;
      setPreviewTime(video.currentTime);
      if (video.ended) setPreviewPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [previewPlaying]);

  useEffect(() => () => videoRef.current?.pause(), []);

  const seekPreview = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPreviewPlaying(false);
    video.currentTime = value;
    setPreviewTime(value);
  };

  useEffect(() => {
    if (mode !== "assisted" || busy) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void detectPeopleAt(videoFile, previewTime).then((detected) => {
        if (!cancelled) setPeople(detected);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [busy, mode, previewTime, videoFile]);

  const designateSubject = (event: ReactPointerEvent<HTMLVideoElement>) => {
    if (mode !== "assisted" || busy) return;
    const video = event.currentTarget;
    const bounds = video.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const hit = people.find(
      (person) =>
        x >= person.x &&
        x <= person.x + person.width &&
        y >= person.y &&
        y <= person.y + person.height
    );
    const subject: PanScanSubject = hit
      ? { time: previewTime, x: hit.x, y: hit.y, width: hit.width, height: hit.height }
      : {
          time: previewTime,
          x: Math.max(0, x - 0.09),
          y: Math.max(0, y - 0.16),
          width: 0.18,
          height: 0.42,
        };
    setSubjects((current) =>
      [...current.filter((item) => Math.abs(item.time - previewTime) > 0.2), subject].sort(
        (a, b) => a.time - b.time
      )
    );
    setAnalysis(null);
  };

  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "human" || !canPan) return;
    drag.current = { x: event.clientX, y: event.clientY, px: previewPosition.x, py: previewPosition.y };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const next = {
      x: Math.max(0, Math.min(1, drag.current.px - (event.clientX - drag.current.x) / rect.width)),
      y: Math.max(0, Math.min(1, drag.current.py - (event.clientY - drag.current.y) / rect.height)),
    };
    setDraft(next);
  };
  const onDragEnd = () => {
    drag.current = null;
    setDragging(false);
  };

  const addManualKey = () => {
    const key = { time: previewTime, x: draft.x, y: draft.y };
    setManualKeys((current) =>
      [...current.filter((item) => Math.abs(item.time - key.time) > 0.08), key].sort(
        (a, b) => a.time - b.time
      )
    );
  };

  const runAssisted = async () => {
    if (busy || !canPan) return;
    setBusy(true);
    setError(null);
    setProgress({ progress: 0, message: "Préparation…" });
    videoRef.current?.pause();
    setPreviewPlaying(false);
    try {
      const result = await trackAssistedPanScan(
        videoFile,
        aspect,
        subjects,
        setProgress,
        content
      );
      setAnalysis(result);
      setPreviewTime(0);
      if (videoRef.current) videoRef.current.currentTime = 0;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Le suivi assisté a échoué.");
    } finally {
      setBusy(false);
    }
  };

  const togglePreview = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().then(() => setPreviewPlaying(true));
    else {
      video.pause();
      setPreviewPlaying(false);
    }
  };

  const previewBox =
    aspect >= 1
      ? { width: "100%", height: `${100 / aspect}%` }
      : { width: `${aspect * 100}%`, height: "100%" };
  const graphFrames = analysis
    ? analysis.keyframes.filter(
        (_, index) => index % Math.max(1, Math.floor(analysis.keyframes.length / 240)) === 0
      )
    : [];

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-3xl rounded-2xl border border-stone-700 bg-stone-950 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.3em] text-violet-400">
              PAN & SCAN · {PAN_SCAN_FPS} IMAGES / SECONDE
            </p>
            <h3 className="mt-1 text-sm font-bold tracking-[0.16em] text-stone-100">
              SUIVI DU CADRE
            </h3>
            <p className="mt-1 truncate text-xs text-stone-400">{title}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-400 transition hover:border-red-700 hover:text-red-400 disabled:opacity-40"
          >
            Fermer
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <ModeButton
            active={mode === "assisted"}
            disabled={busy}
            title="IA ASSISTÉE"
            text="Vous désignez le sujet de chaque plan. L'IA le suit."
            onClick={() => setMode("assisted")}
          />
          <ModeButton
            active={mode === "human"}
            disabled={busy}
            title="HUMAIN"
            text="Vous posez les cadres. MOKA glisse entre eux."
            onClick={() => setMode("human")}
          />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-stone-400">Format :</span>
          {ASPECTS.map((item) => (
            <button
              key={item.label}
              disabled={busy}
              onClick={() => {
                setAspect(item.value);
                setAnalysis(null);
              }}
              className={`rounded-full px-3 py-1 text-xs transition disabled:opacity-40 ${
                Math.abs(aspect - item.value) < 0.001
                  ? "bg-violet-500 font-bold text-white"
                  : "border border-stone-700 text-stone-400 hover:text-violet-300"
              }`}
            >
              {item.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-stone-500">
            {videoWidth} × {videoHeight}
            {sourceAspect ? ` · ${aspectLabel(sourceAspect)}` : ""}
          </span>
        </div>

        {!canPan && (
          <p className="mb-4 rounded-lg border border-yellow-900/70 bg-yellow-950/30 px-3 py-2 text-xs text-yellow-300">
            Choisissez un format différent de la source, par exemple 1:1, pour que le cadre puisse se déplacer.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div>
            <div
              ref={stageRef}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              className={`relative mx-auto aspect-square w-full overflow-hidden rounded-xl border border-stone-800 bg-black ${
                mode === "human" && canPan ? "cursor-move touch-none" : ""
              }`}
            >
              {mode === "assisted" ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="relative"
                    style={
                      sourceAspect >= 1
                        ? { width: "100%", height: `${100 / Math.max(sourceAspect, 0.01)}%` }
                        : { width: `${sourceAspect * 100}%`, height: "100%" }
                    }
                  >
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      muted
                      playsInline
                      onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
                      onClick={designateSubject}
                      className="h-full w-full cursor-crosshair object-fill"
                    />
                    {people.map((person, index) => (
                      <span
                        key={`${person.x}-${person.y}-${index}`}
                        className="pointer-events-none absolute border border-violet-300/80"
                        style={{
                          left: `${person.x * 100}%`,
                          top: `${person.y * 100}%`,
                          width: `${person.width * 100}%`,
                          height: `${person.height * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative overflow-hidden" style={previewBox}>
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      muted
                      playsInline
                      onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
                      style={placementStyle(
                        windowInsideContent(
                          videoWidth || 16,
                          videoHeight || 9,
                          content,
                          aspect,
                          previewPosition.x,
                          previewPosition.y
                        )
                      )}
                    />
                    {canPan && <MokaWatermark />}
                  </div>
                </div>
              )}
            </div>
            <Scrubber
              time={previewTime}
              duration={duration}
              playing={previewPlaying}
              onToggle={togglePreview}
              onSeek={seekPreview}
            />
          </div>

          <div className="min-w-0">
            {mode === "assisted" ? (
              <>
                <p className="text-xs leading-relaxed text-stone-400">
                  Placez-vous au début d'un plan, puis cliquez la personne à suivre. Recommencez à chaque nouveau plan. L'IA inspecte ensuite <strong>20 images par seconde</strong> et le cadre glisse vers le sujet, sans jamais couper d'une image à l'autre.
                </p>
                <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto text-xs">
                  {subjects.length === 0 && (
                    <li className="text-stone-500">Aucun sujet désigné.</li>
                  )}
                  {subjects.map((subject) => (
                    <li key={subject.time} className="flex items-center justify-between gap-2 text-violet-200">
                      <span>Plan à {formatSeconds(subject.time)}</span>
                      <button
                        onClick={() => setSubjects((current) => current.filter((item) => item !== subject))}
                        className="text-stone-400 hover:text-red-400"
                      >
                        Retirer
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={runAssisted}
                  disabled={busy || !canPan || subjects.length === 0}
                  className="mt-4 w-full rounded-xl bg-violet-600 py-3 text-xs font-bold tracking-[0.16em] text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "SUIVI EN COURS…" : "SUIVRE LES SUJETS · 20 IMG/S"}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs leading-relaxed text-stone-400">
                  Glissez l'image pour cadrer, puis posez une clé. MOKA construit un parcours à 20 images/seconde et <strong>fait glisser le cadre</strong> entre vos clés. Il ne saute jamais d'un point à l'autre.
                </p>
                <button
                  onClick={addManualKey}
                  disabled={!canPan}
                  className="mt-3 rounded-full border border-violet-700 px-4 py-2 text-xs font-bold tracking-widest text-violet-200 transition hover:bg-violet-950 disabled:opacity-40"
                >
                  POSER UNE CLÉ À {formatSeconds(previewTime)}
                </button>
                <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto text-xs">
                  {manualKeys.length === 0 && <li className="text-stone-500">Aucune clé.</li>}
                  {manualKeys.map((key) => (
                    <li key={key.time} className="flex items-center justify-between gap-2 text-violet-200">
                      <button onClick={() => seekPreview(key.time)}>
                        {formatSeconds(key.time)} · {Math.round(key.x * 100)}% / {Math.round(key.y * 100)}%
                      </button>
                      <button
                        onClick={() => setManualKeys((current) => current.filter((item) => item !== key))}
                        className="text-stone-400 hover:text-red-400"
                      >
                        Retirer
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {progress && (
              <div className="mt-4 rounded-lg border border-stone-800 bg-stone-950 p-3">
                <div className="flex justify-between gap-3 text-xs text-stone-400">
                  <span>{progress.message}</span>
                  <span className="tabular-nums">{Math.round(progress.progress * 100)}%</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-700">
                  <div className="h-full bg-violet-500" style={{ width: `${progress.progress * 100}%` }} />
                </div>
              </div>
            )}
            {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
          </div>
        </div>

        {analysis && analysis.method === mode && (
          <div className="mt-5">
            <div className="relative h-24 overflow-hidden rounded-lg border border-stone-800 bg-stone-950">
              <svg viewBox="0 0 320 96" className="h-full w-full" preserveAspectRatio="none">
                <path d="M0 48H320" stroke="rgba(255,255,255,.08)" />
                <path
                  d={graphFrames
                    .map((frame, index) => {
                      const x = (frame.time / Math.max(0.01, analysis.keyframes.at(-1)?.time ?? 1)) * 320;
                      const y = 8 + frame.x * 80;
                      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="2"
                />
                <circle
                  cx={(previewTime / Math.max(0.01, analysis.keyframes.at(-1)?.time ?? 1)) * 320}
                  cy={8 + previewPosition.x * 80}
                  r="4"
                  fill="#fbbf24"
                />
              </svg>
              <span className="absolute left-2 top-2 text-[9px] font-bold tracking-wider text-violet-300">
                GLISSEMENT CONTINU · {analysis.keyframes.length} IMAGES
              </span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-stone-500">
              Chaque image vérifiée est espacée de {Math.round(1000 / PAN_SCAN_FPS)} ms. Le déplacement est limité pour que le cadre glisse au lieu de couper, y compris quand le sujet change de plan.
            </p>
            <button
              onClick={() => {
                const first = analysis.keyframes[0];
                onApply({ aspect, posX: first?.x ?? 0.5, posY: first?.y ?? 0.5 }, analysis);
                videoRef.current?.pause();
              }}
              className="mt-3 w-full rounded-xl bg-moka-900 py-3 text-xs font-bold tracking-[0.22em] text-white transition hover:bg-moka-700"
            >
              APPLIQUER LE PAN & SCAN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  title,
  text,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-3 py-2 text-left transition disabled:opacity-40 ${
        active ? "border-violet-500 bg-violet-950/50" : "border-stone-800 hover:border-stone-600"
      }`}
    >
      <span className="block text-[10px] font-bold tracking-[0.16em] text-violet-200">{title}</span>
      <span className="mt-1 block text-[11px] leading-snug text-stone-400">{text}</span>
    </button>
  );
}

function Scrubber({
  time,
  duration,
  playing,
  onToggle,
  onSeek,
}: {
  time: number;
  duration: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (time: number) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        onClick={onToggle}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-xs text-white"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={1 / PAN_SCAN_FPS}
        value={Math.min(time, duration || 0)}
        onChange={(event) => onSeek(Number(event.target.value))}
        className="min-w-0 flex-1 accent-violet-500"
      />
      <span className="w-10 text-right text-[10px] tabular-nums text-stone-400">
        {formatSeconds(time)}
      </span>
    </div>
  );
}

function formatSeconds(time: number): string {
  if (!Number.isFinite(time)) return "0:00";
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
