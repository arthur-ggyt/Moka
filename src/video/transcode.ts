import type { ContentBounds, VideoCrop } from "../moka";
import { NO_BARS, windowInsideContent } from "./letterbox";

export const MAX_VIDEO_DIMENSION = 10000;

export interface VideoDimensions {
  width: number;
  height: number;
}

export interface VideoOutputSize extends VideoDimensions {
  cropWidth: number;
  cropHeight: number;
  resized: boolean;
}

export interface PreparedVideo {
  blob: Blob;
  width: number;
  height: number;
  transcoded: boolean;
}

function evenFloor(value: number): number {
  const rounded = Math.floor(value);
  return Math.max(2, rounded - (rounded % 2));
}

export function getVideoOutputSize(
  width: number,
  height: number,
  crop: VideoCrop | null,
  maxDimension = 10000
): VideoOutputSize {
  const sourceWidth = Math.max(1, width);
  const sourceHeight = Math.max(1, height);
  const sourceAspect = sourceWidth / sourceHeight;
  const aspect = crop && crop.aspect > 0 ? crop.aspect : sourceAspect;

  // Compute the selected crop in source pixels while preserving its aspect ratio.
  const cropWidth = aspect >= sourceAspect ? sourceWidth : sourceHeight * aspect;
  const cropHeight = aspect >= sourceAspect ? sourceWidth / aspect : sourceHeight;
  const resized = width > maxDimension || height > maxDimension;
  const scale = resized
    ? Math.min(1, maxDimension / cropWidth, maxDimension / cropHeight)
    : 1;
  const outWidth = resized ? evenFloor(cropWidth * scale) : width;
  const outHeight = resized ? evenFloor(cropHeight * scale) : height;

  return {
    width: Math.min(maxDimension, outWidth),
    height: Math.min(maxDimension, outHeight),
    cropWidth,
    cropHeight,
    resized,
  };
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("La vidéo n'a pas pu être décodée par ce navigateur."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function recorderMimeType(): string {
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? "";
}

function drawWatermark(ctx: CanvasRenderingContext2D, w:number, h:number, t:number, duration:number, needs:boolean){
  if(!needs) return
  // entry 0-0.7s, exit last 0.7s, permanent in between with 10% opacity
  let opacity = 0.10
  let offsetY = 0
  if(t < 0.7){
    const p = t/0.7
    opacity = 0.10 * p
    offsetY = (1-p)*8
  } else if(t > duration - 0.7){
    const p = (duration - t)/0.7
    opacity = 0.10 * Math.max(0,p)
    offsetY = (1-Math.max(0,p))*6
  }
  if(opacity <= 0.005) return
  const scale = Math.max(10, Math.min(28, w*0.035))
  const padX = w*0.03
  const padY = h*0.03
  const mugSize = scale*1.1
  const text = "MOKA"
  ctx.save()
  ctx.globalAlpha = opacity
  // pill background
  ctx.fillStyle = "rgba(0,0,0,0.35)"
  // we need measure after setting font, so set font first
  ctx.font = `900 ${scale*0.75}px system-ui, sans-serif`
  // @ts-ignore
  ctx.letterSpacing = "0.2em"
  const pillWidth = mugSize + 10 + ctx.measureText(text).width + 18
  const pillHeight = scale*1.6
  const x = padX
  const y = h - padY - pillHeight + offsetY
  // rounded rect
  ctx.beginPath()
  const r = pillHeight/2
  ctx.moveTo(x+r, y); ctx.lineTo(x+pillWidth - r, y); ctx.quadraticCurveTo(x+pillWidth, y, x+pillWidth, y+r); ctx.lineTo(x+pillWidth, y+pillHeight - r); ctx.quadraticCurveTo(x+pillWidth, y+pillHeight, x+pillWidth - r, y+pillHeight); ctx.lineTo(x+r, y+pillHeight); ctx.quadraticCurveTo(x, y+pillHeight, x, y+pillHeight - r); ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath()
  ctx.fill()
  // icon
  ctx.fillStyle = "#fffef0"
  ctx.font = `${mugSize}px system-ui`
  ctx.textBaseline = "middle"
  ctx.fillText("☕", x+8, y + pillHeight/2 + 1)
  // text
  ctx.fillStyle = "#fff7ed"
  ctx.font = `900 ${scale*0.72}px ui-sans-serif, system-ui`
  // @ts-ignore letterSpacing not in all TS lib
  ctx.letterSpacing = "0.18em"
  ctx.textBaseline = "middle"
  ctx.fillText(text, x + mugSize + 12, y + pillHeight/2 + 0.5)
  ctx.restore()
}

/**
 * Re-encode a video through a canvas when its dimensions exceed the limit or
 * when a crop was selected. The output keeps the video audio track whenever
 * the browser's Web Audio and MediaRecorder APIs are available.
 */
export async function prepareVideoForMoka(options: {
  file: File;
  crop: VideoCrop | null;
  content?: ContentBounds | null;
  maxDimension?: number;
  watermark?: boolean;
  onProgress?: (progress: number) => void;
}): Promise<PreparedVideo> {
  const { file, crop, onProgress } = options;
  const watermark = options.watermark ?? false
  // la limite est grande (10000) : on encode uniquement si vraiment nécessaire
  const content = options.content ?? NO_BARS;
  const maxDimension = options.maxDimension ?? 1000;
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;

  let audioContext: AudioContext | null = null;
  let sourceStream: MediaStream | null = null;
  let canvasStream: MediaStream | null = null;
  let frameId = 0;

  try {
    video.src = objectUrl;
    await waitForMetadata(video);

    const inputWidth = video.videoWidth;
    const inputHeight = video.videoHeight;
    if (!inputWidth || !inputHeight) {
      throw new Error("Les dimensions de la vidéo sont inconnues.");
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("La durée de la vidéo n'a pas pu être déterminée.");
    }

    const needsProcessing = inputWidth > maxDimension || inputHeight > maxDimension || watermark;
    if (!needsProcessing) {
      onProgress?.(1);
      return { blob: file, width: inputWidth, height: inputHeight, transcoded: false };
    }

    if (typeof MediaRecorder === "undefined") {
      throw new Error(
        "La compression vidéo n'est pas prise en charge par ce navigateur. Utilisez un navigateur récent."
      );
    }
    if (!HTMLCanvasElement.prototype.captureStream) {
      throw new Error("La capture vidéo n'est pas prise en charge par ce navigateur.");
    }
    const mimeType = recorderMimeType();
    if (!mimeType) {
      throw new Error("Aucun encodeur MP4/WebM compatible n'est disponible dans ce navigateur.");
    }

    // A size-only export keeps the original frame (bars included; the player masks
    // them). A chosen crop is baked from the useful picture only, so black bars
    // can never enter the encoded window.
    const sourceWindow = crop?.aspect
      ? windowInsideContent(
          inputWidth,
          inputHeight,
          content,
          crop.aspect,
          crop.posX ?? 0.5,
          crop.posY ?? 0.5
        )
      : { x: 0, y: 0, w: 1, h: 1 };
    const sx = sourceWindow.x * inputWidth;
    const sy = sourceWindow.y * inputHeight;
    const sw = Math.max(2, sourceWindow.w * inputWidth);
    const sh = Math.max(2, sourceWindow.h * inputHeight);
    const windowScale = Math.min(1, maxDimension / sw, maxDimension / sh);
    const outputWidth = evenFloor(sw * windowScale);
    const outputHeight = evenFloor(sh * windowScale);

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Impossible de créer le canvas de compression vidéo.");

    // Connecting the media element to a stream destination captures its audio
    // without playing the source video's sound through the speakers.
    const AudioContextConstructor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let audioTracks: MediaStreamTrack[] = [];
    if (AudioContextConstructor) {
      audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      audioTracks = destination.stream.getAudioTracks();
      await audioContext.resume();
    }

    canvasStream = canvas.captureStream(30);
    sourceStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioTracks,
    ]);

    const recorder = new MediaRecorder(sourceStream, {
      mimeType,
      videoBitsPerSecond: Math.min(2_000_000, outputWidth * outputHeight * 2),
      audioBitsPerSecond: 128_000,
    });
    const chunks: BlobPart[] = [];

    const recording = new Promise<{ blob: Blob } | { error: Error }>((resolve) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener(
        "error",
        () =>
          resolve({
            error: new Error("Une erreur est survenue pendant la compression vidéo."),
          }),
        { once: true }
      );
      recorder.addEventListener(
        "stop",
        () => {
          const result = new Blob(chunks, { type: recorder.mimeType || mimeType });
          if (result.size === 0) resolve({ error: new Error("La vidéo compressée est vide.") });
          else resolve({ blob: result });
        },
        { once: true }
      );
    });

    let lastProgressAt = 0;
    const drawFrame = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.drawImage(
          video,
          sx,
          sy,
          sw,
          sh,
          0,
          0,
          outputWidth,
          outputHeight
        );
        drawWatermark(context, outputWidth, outputHeight, video.currentTime, video.duration || 1, watermark)
      }
      const now = performance.now();
      if (now - lastProgressAt > 180 && video.duration > 0) {
        onProgress?.(Math.max(0, Math.min(1, video.currentTime / video.duration)));
        lastProgressAt = now;
      }
      if (!video.ended) frameId = requestAnimationFrame(drawFrame);
    };

    const playback = new Promise<void>((resolve, reject) => {
      video.addEventListener("ended", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error("La vidéo s'est interrompue pendant le traitement.")),
        { once: true }
      );
      recorder.addEventListener(
        "error",
        () => reject(new Error("Une erreur est survenue pendant la compression vidéo.")),
        { once: true }
      );
    });

    let recorderStarted = false;
    try {
      recorder.start(500);
      recorderStarted = true;
      await video.play();
      frameId = requestAnimationFrame(drawFrame);
      await playback;
    } catch (error) {
      if (recorderStarted) {
        if (recorder.state !== "inactive") recorder.stop();
        await recording;
      }
      if (error instanceof Error) throw error;
      throw new Error("Impossible de démarrer l'encodage de la vidéo.");
    }

    if (recorder.state !== "inactive") recorder.stop();
    const recorded = await recording;
    if ("error" in recorded) throw recorded.error;
    onProgress?.(1);
    return {
      blob: recorded.blob,
      width: outputWidth,
      height: outputHeight,
      transcoded: true,
    };
  } finally {
    cancelAnimationFrame(frameId);
    video.pause();
    video.removeAttribute("src");
    video.load();
    canvasStream?.getTracks().forEach((track) => track.stop());
    sourceStream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close().catch(() => {});
    }
    URL.revokeObjectURL(objectUrl);
  }
}