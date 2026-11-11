import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { aspectLabel, type ContentBounds, type VideoCrop } from "../moka";
import { getVideoOutputSize, MAX_VIDEO_DIMENSION } from "../video/transcode";
import { placementStyle, windowInsideContent } from "../video/letterbox";
import { MokaWatermark } from "./MokaWatermark";

interface Props {
  title: string;
  videoUrl: string;
  videoWidth: number;
  videoHeight: number;
  crop: VideoCrop | null;
  content?: ContentBounds | null;
  onChange: (crop: VideoCrop) => void;
  onClose: () => void;
}

const ASPECTS: { value: number; label: string }[] = [
  { value: 0, label: "ORIGINAL" },
  { value: 1, label: "1:1" },
  { value: 4 / 3, label: "4:3" },
  { value: 16 / 9, label: "16:9" },
  { value: 9 / 16, label: "9:16" },
];

const clamp = (x: number) => Math.max(0, Math.min(1, x));

function rectFor(a: number) {
  return a >= 1 ? { w: 100, h: 100 / a } : { w: a * 100, h: 100 };
}

export function CropCalibrator({
  title,
  videoUrl,
  videoWidth,
  videoHeight,
  crop,
  content = null,
  onChange,
  onClose,
}: Props) {
  const [c, setC] = useState<VideoCrop>(
    crop && crop.aspect > 0
      ? crop
      : { aspect: 0, posX: 0.5, posY: 0.5 }
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const va =
    videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
  const previewWindow = windowInsideContent(
    videoWidth || 16,
    videoHeight || 9,
    content,
    c.aspect,
    c.posX,
    c.posY
  );
  const previewAspect =
    videoWidth > 0 && videoHeight > 0
      ? (previewWindow.w * videoWidth) / (previewWindow.h * videoHeight)
      : va;
  const box = rectFor(previewAspect);
  const pannable = c.aspect > 0;
  const outputSize =
    videoWidth > 0 && videoHeight > 0
      ? getVideoOutputSize(videoWidth, videoHeight, c, MAX_VIDEO_DIMENSION)
      : null;

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pannable) return;
    drag.current = { x: e.clientX, y: e.clientY, px: c.posX, py: c.posY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    const fw = (box.w / 100) * r.width;
    const fh = (box.h / 100) * r.height;
    if (fw <= 0 || fh <= 0) return;
    const dx = (e.clientX - drag.current.x) / fw;
    const dy = (e.clientY - drag.current.y) / fh;
    const px = clamp(drag.current.px + dx);
    const py = clamp(drag.current.py + dy);
    setC((v) => ({ ...v, posX: px, posY: py }));
  };
  const onUp = () => {
    drag.current = null;
  };

  const apply = () => {
    onChange({
      ...c,
      posX: Math.round(c.posX * 1000) / 1000,
      posY: Math.round(c.posY * 1000) / 1000,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-lg rounded-2xl border border-stone-700 bg-stone-950 p-6 shadow-2xl">
        {/* En-tête */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold tracking-[0.25em] text-moka-400">
              RECALIBRAGE DE L'IMAGE
            </h3>
            <p className="mt-1 truncate text-xs text-stone-400">{title}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-400 transition hover:border-red-700 hover:text-red-400"
          >
            ✕ Fermer
          </button>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-stone-400">
          Choisissez le format d'affichage de la vidéo dans le lecteur (ex. passer du
          16:9 au 1:1) puis <span className="text-stone-300">glissez dans la zone</span>{" "}
          pour régler le cadrage. Le recadrage est enregistré dans le fichier .moka.
        </p>

        {/* Formats */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-stone-400">
          <span className="font-semibold text-stone-400">Format d'affichage :</span>
          {ASPECTS.map((a) => {
            const active =
              a.value === 0
                ? c.aspect === 0
                : Math.abs(c.aspect - a.value) < 0.001;
            return (
              <button
                key={a.label}
                onClick={() => setC((v) => ({ ...v, aspect: a.value }))}
                className={`rounded-full px-3 py-1 transition ${
                  active
                    ? "bg-moka-900 font-bold text-white"
                    : "border border-stone-700 text-stone-400 hover:text-moka-400"
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>

        {/* Scène : vidéo en fond (contenu) + cadre de recadrage */}
        <div
          ref={stageRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className={`relative mx-auto aspect-square w-full max-w-[340px] touch-none select-none overflow-hidden rounded-xl border border-stone-800 bg-black ${
            pannable ? "cursor-move" : ""
          }`}
        >
          {/* Vidéo complète (référence, assombrie) */}
          <video
            src={videoUrl}
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-contain opacity-35"
          />
          {/* Cadre de recadrage : ce que verra le lecteur */}
          <div
            className="absolute overflow-hidden border-2 border-moka-600 bg-black"
            style={{
              left: `${(100 - box.w) / 2}%`,
              top: `${(100 - box.h) / 2}%`,
              width: `${box.w}%`,
              height: `${box.h}%`,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            }}
          >
            <video
              src={videoUrl}
              muted
              playsInline
              style={placementStyle(previewWindow)}
            />
            {c.aspect > 0 && <MokaWatermark />}
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-moka-300">
              {c.aspect > 0 ? aspectLabel(c.aspect) : "CONTENU COMPLET"}
            </span>
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] text-stone-500">
          {videoWidth > 0 && videoHeight > 0
            ? `${videoWidth} × ${videoHeight} px (${aspectLabel(va)}) → ${
                c.aspect > 0 ? aspectLabel(c.aspect) : "original"
              }${pannable ? " · glissez pour ajuster le cadrage" : ""}`
            : "dimensions inconnues"}
        </p>

        <div className="mt-3 rounded-lg border border-emerald-900/70 bg-emerald-950/30 px-3 py-2 text-center">
          <p className="text-xs font-semibold text-emerald-300">
            {outputSize
              ? `Résolution finale MOKA : ${outputSize.width} × ${outputSize.height} px`
              : "Résolution finale calculée lors de l'export"}
          </p>
          <p className="mt-1 text-[10px] text-stone-400">
            Limite : {MAX_VIDEO_DIMENSION} × {MAX_VIDEO_DIMENSION} px. Le recadrage est
            appliqué puis la vidéo est automatiquement redimensionnée si nécessaire.
          </p>
        </div>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setC({ aspect: 0, posX: 0.5, posY: 0.5 })}
            className="rounded-full border border-stone-700 px-4 py-2 text-xs font-bold tracking-widest text-stone-400 transition hover:border-moka-700 hover:text-moka-400"
          >
            ↺ RÉINITIALISER
          </button>
          <button
            onClick={apply}
            className="flex-1 rounded-xl bg-moka-900 py-2 text-xs font-bold tracking-[0.25em] text-white transition hover:bg-moka-700"
          >
            ✔ APPLIQUER LE RECADRAGE
          </button>
        </div>
      </div>
    </div>
  );
}
