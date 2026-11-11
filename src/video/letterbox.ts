export interface ContentBounds {
  /** Fraction of the encoded frame covered by a black bar on each side. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FrameWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NO_BARS: ContentBounds = { left: 0, top: 0, right: 0, bottom: 0 };

const BLACK_MEAN = 18;
const BLACK_PIXEL = 30;
const BLACK_RATIO = 0.96;

export function hasContentBars(bounds?: ContentBounds | null): boolean {
  if (!bounds) return false;
  return (
    bounds.left > 0.008 ||
    bounds.top > 0.008 ||
    bounds.right > 0.008 ||
    bounds.bottom > 0.008
  );
}

export function contentArea(bounds: ContentBounds): number {
  return Math.max(0, 1 - bounds.left - bounds.right) * Math.max(0, 1 - bounds.top - bounds.bottom);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function luma(data: Uint8ClampedArray, index: number): number {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function lineIsBlack(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  index: number,
  vertical: boolean
): boolean {
  const length = vertical ? height : width;
  const step = Math.max(1, Math.floor(length / 180));
  let sum = 0;
  let dark = 0;
  let count = 0;
  for (let cursor = 0; cursor < length; cursor += step) {
    const x = vertical ? index : cursor;
    const y = vertical ? cursor : index;
    const value = luma(data, (y * width + x) * 4);
    sum += value;
    if (value <= BLACK_PIXEL) dark++;
    count++;
  }
  return count > 0 && sum / count <= BLACK_MEAN && dark / count >= BLACK_RATIO;
}

function edgeInset(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  vertical: boolean,
  fromEnd: boolean
): number {
  const length = vertical ? width : height;
  const maxInset = Math.floor(length * 0.42);
  let inset = 0;
  while (inset < maxInset) {
    const index = fromEnd ? length - 1 - inset : inset;
    if (!lineIsBlack(data, width, height, index, vertical)) break;
    inset++;
  }
  // A one-pixel fringe is usually compression noise, not a real bar.
  if (inset < 2) return 0;
  return inset / length;
}

/** Detect black bars in one decoded frame. Returns zero when unsure. */
export function detectFrameLetterbox(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ContentBounds {
  if (width < 8 || height < 8 || data.length < width * height * 4) return NO_BARS;
  const bounds = {
    left: edgeInset(data, width, height, true, false),
    right: edgeInset(data, width, height, true, true),
    top: edgeInset(data, width, height, false, false),
    bottom: edgeInset(data, width, height, false, true),
  };
  if (contentArea(bounds) < 0.45) return NO_BARS;
  return bounds;
}

export function mergeLetterbox(samples: ContentBounds[]): ContentBounds {
  const usable = samples.filter((sample) => contentArea(sample) >= 0.45);
  if (usable.length < 2) return NO_BARS;

  const side = (key: keyof ContentBounds): number => {
    const values = usable.map((sample) => sample[key]).sort((a, b) => a - b);
    const confirmed = values.filter((value) => value >= 0.012).length;
    if (confirmed < Math.ceil(usable.length * 0.7)) return 0;
    // High percentile: a bar present in most frames must never remain visible.
    return values[Math.min(values.length - 1, Math.floor((values.length - 1) * 0.8))];
  };

  const merged = {
    left: side("left"),
    top: side("top"),
    right: side("right"),
    bottom: side("bottom"),
  };
  return contentArea(merged) >= 0.45 ? merged : NO_BARS;
}

function safetyInset(bar: number, frameSize: number): number {
  if (bar < 0.008) return 0;
  const pixels = Math.min(28, Math.max(8, bar * frameSize * 0.14));
  return pixels / frameSize;
}

/**
 * Largest target-aspect window that fits inside the useful picture.
 * pos 0 and 1 stop before the black bars, including a safety margin for
 * compression fringes. aspect <= 0 returns the full useful picture.
 */
export function windowInsideContent(
  frameWidth: number,
  frameHeight: number,
  bounds: ContentBounds | null | undefined,
  aspect: number,
  posX = 0.5,
  posY = 0.5
): FrameWindow {
  const source = bounds ?? NO_BARS;
  const left = clamp01(source.left + safetyInset(source.left, frameWidth));
  const right = clamp01(source.right + safetyInset(source.right, frameWidth));
  const top = clamp01(source.top + safetyInset(source.top, frameHeight));
  const bottom = clamp01(source.bottom + safetyInset(source.bottom, frameHeight));
  const contentW = Math.max(0.08, 1 - left - right);
  const contentH = Math.max(0.08, 1 - top - bottom);
  const contentAspect = (contentW * frameWidth) / (contentH * frameHeight);
  const target = aspect > 0.01 ? aspect : contentAspect;

  let w = contentW;
  let h = contentH;
  if (target > contentAspect * 1.002) {
    w = contentW;
    h = (w * frameWidth) / target / frameHeight;
  } else if (target < contentAspect * 0.998) {
    h = contentH;
    w = (h * frameHeight * target) / frameWidth;
  }
  w = Math.min(contentW, Math.max(0.02, w));
  h = Math.min(contentH, Math.max(0.02, h));

  return {
    x: left + (contentW - w) * clamp01(posX),
    y: top + (contentH - h) * clamp01(posY),
    w,
    h,
  };
}

export function placementStyle(win: FrameWindow): {
  position: "absolute";
  width: string;
  height: string;
  left: string;
  top: string;
  maxWidth: "none";
  objectFit: "fill";
} {
  const w = Math.max(0.02, win.w);
  const h = Math.max(0.02, win.h);
  return {
    position: "absolute",
    width: `${(1 / w) * 100}%`,
    height: `${(1 / h) * 100}%`,
    left: `${(-win.x / w) * 100}%`,
    top: `${(-win.y / h) * 100}%`,
    maxWidth: "none",
    objectFit: "fill",
  };
}

function waitFor(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap): Promise<void> {
  if (event === "loadedmetadata" && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Analyse des bandes noires interrompue."));
    }, 8000);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Impossible d'analyser les bords de la vidéo."));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(event, onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(event, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

/** Sample several frames so a fade-to-black cannot be mistaken for letterboxing. */
export async function detectVideoLetterbox(file: Blob): Promise<ContentBounds> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    video.src = url;
    await waitFor(video, "loadedmetadata");
    if (!video.videoWidth || !video.videoHeight || !(video.duration > 0)) return NO_BARS;
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(16, Math.round(video.videoWidth * scale));
    const height = Math.max(16, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return NO_BARS;

    const times = [0.12, 0.34, 0.5, 0.68, 0.86].map((ratio) =>
      Math.min(video.duration - 0.05, Math.max(0, video.duration * ratio))
    );
    const samples: ContentBounds[] = [];
    for (const time of times) {
      video.currentTime = time;
      await waitFor(video, "seeked");
      context.drawImage(video, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      samples.push(detectFrameLetterbox(image.data, width, height));
    }
    return mergeLetterbox(samples);
  } catch {
    return NO_BARS;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
