import type {
  ContentBounds,
  PanScanData,
  PanScanKeyframe,
  PanScanManualKey,
  PanScanSubject,
} from "../moka";
import type { Detection, ObjectDetector } from "@mediapipe/tasks-vision";
import { NO_BARS, detectVideoLetterbox, windowInsideContent } from "./letterbox";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite";
const ANALYSIS_WIDTH = 480;
export const PAN_SCAN_FPS = 20;
const MAX_GLIDE_SPEED = 0.7;

export interface PanScanProgress {
  progress: number;
  message: string;
}

export interface DetectedPerson {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

interface SubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

interface Center {
  x: number;
  y: number;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
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
      reject(new Error("La vidéo ne peut pas être analysée par le navigateur."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (
    Math.abs(video.currentTime - time) < 0.01 &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Délai dépassé pendant l'analyse d'une image vidéo."));
    }, 8000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Une image vidéo n'a pas pu être décodée."));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

async function createPersonDetector(): Promise<ObjectDetector> {
  const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    runningMode: "IMAGE",
    categoryAllowlist: ["person"],
    scoreThreshold: 0.25,
    maxResults: 8,
  });
}

function readHistogram(image: ImageData): Float32Array {
  const bins = new Float32Array(24);
  const data = image.data;
  let total = 0;
  for (let i = 0; i < data.length; i += 16) {
    const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 256;
    bins[Math.min(23, Math.floor(luma * bins.length))]++;
    total++;
  }
  if (total > 0) {
    for (let i = 0; i < bins.length; i++) bins[i] /= total;
  }
  return bins;
}

function histogramDistance(a: Float32Array, b: Float32Array): number {
  let distance = 0;
  for (let i = 0; i < a.length; i++) distance += Math.abs(a[i] - b[i]);
  return distance / 2;
}

function motionCenter(current: ImageData, previous: ImageData | null): Center | null {
  if (!previous) return null;
  const data = current.data;
  const old = previous.data;
  let sum = 0;
  let weightedX = 0;
  let weightedY = 0;
  const stride = 4;

  const frameWidth = current.width;
  const frameHeight = current.height;
  for (let y = 2; y < frameHeight; y += stride) {
    for (let x = 2; x < frameWidth; x += stride) {
      const i = (y * frameWidth + x) * 4;
      const diff =
        (Math.abs(data[i] - old[i]) +
          Math.abs(data[i + 1] - old[i + 1]) +
          Math.abs(data[i + 2] - old[i + 2])) /
        3;
      const weight = Math.max(0, diff - 24);
      if (weight < 1) continue;
      sum += weight;
      weightedX += x * weight;
      weightedY += y * weight;
    }
  }

  if (sum < 80) return null;
  return {
    x: weightedX / sum / frameWidth,
    y: weightedY / sum / frameHeight,
  };
}

function overlap(a: SubjectBox, b: SubjectBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function personBoxes(
  detections: Detection[],
  frameWidth: number,
  frameHeight: number
): SubjectBox[] {
  return detections.flatMap((detection) => {
    const box = detection.boundingBox;
    const category = detection.categories.find(
      (item) => item.categoryName.toLowerCase() === "person"
    );
    if (!box || !category || frameWidth <= 0 || frameHeight <= 0) return [];
    return [
      {
        x: Math.max(0, box.originX / frameWidth),
        y: Math.max(0, box.originY / frameHeight),
        width: Math.min(1, box.width / frameWidth),
        height: Math.min(1, box.height / frameHeight),
        score: category.score,
      },
    ];
  });
}

function choosePerson(
  people: SubjectBox[],
  previous: SubjectBox | null,
  sceneChanged: boolean
): SubjectBox | null {
  if (people.length === 0) return null;
  if (!previous || sceneChanged) {
    return people.reduce((best, item) => {
      const area = item.width * item.height;
      const centrality = 1 - Math.hypot(item.x + item.width / 2 - 0.5, item.y + item.height / 2 - 0.5);
      const score = item.score * 0.55 + Math.sqrt(area) * 0.3 + centrality * 0.15;
      const bestArea = best.width * best.height;
      const bestCentrality =
        1 - Math.hypot(best.x + best.width / 2 - 0.5, best.y + best.height / 2 - 0.5);
      const bestScore = best.score * 0.55 + Math.sqrt(bestArea) * 0.3 + bestCentrality * 0.15;
      return score > bestScore ? item : best;
    });
  }

  return people.reduce((best, item) => {
    const distance = Math.hypot(
      item.x + item.width / 2 - (previous.x + previous.width / 2),
      item.y + item.height / 2 - (previous.y + previous.height / 2)
    );
    const score =
      overlap(previous, item) * 1.5 +
      Math.max(0, 1 - distance / 0.8) * 0.65 +
      item.score * 0.18 +
      Math.sqrt(item.width * item.height) * 0.08;
    const bestDistance = Math.hypot(
      best.x + best.width / 2 - (previous.x + previous.width / 2),
      best.y + best.height / 2 - (previous.y + previous.height / 2)
    );
    const bestScore =
      overlap(previous, best) * 1.5 +
      Math.max(0, 1 - bestDistance / 0.8) * 0.65 +
      best.score * 0.18 +
      Math.sqrt(best.width * best.height) * 0.08;
    return score > bestScore ? item : best;
  });
}

function toCameraPosition(
  center: Center,
  sourceWidth: number,
  sourceHeight: number,
  aspect: number,
  bounds: ContentBounds
): Center {
  const atStart = windowInsideContent(sourceWidth, sourceHeight, bounds, aspect, 0, 0);
  const atEnd = windowInsideContent(sourceWidth, sourceHeight, bounds, aspect, 1, 1);
  const slackX = atEnd.x - atStart.x;
  const slackY = atEnd.y - atStart.y;
  const desiredX = center.x - atStart.w / 2;
  const desiredY = center.y - atStart.h / 2;
  return {
    x: Math.max(0, Math.min(1, slackX > 0.0001 ? (desiredX - atStart.x) / slackX : 0.5)),
    y: Math.max(0, Math.min(1, slackY > 0.0001 ? (desiredY - atStart.y) / slackY : 0.5)),
  };
}

function glidePath(points: PanScanKeyframe[]): PanScanKeyframe[] {
  if (points.length < 2) return points;
  const glided: PanScanKeyframe[] = [{ ...points[0] }];
  let x = points[0].x;
  let y = points[0].y;
  for (let index = 1; index < points.length; index++) {
    const dt = Math.max(1 / PAN_SCAN_FPS, points[index].time - points[index - 1].time);
    const maxStep = MAX_GLIDE_SPEED * dt;
    const dx = points[index].x - x;
    const dy = points[index].y - y;
    const distance = Math.hypot(dx, dy);
    if (distance > maxStep && distance > 0) {
      x += (dx / distance) * maxStep;
      y += (dy / distance) * maxStep;
    } else {
      x = points[index].x;
      y = points[index].y;
    }
    glided.push({
      ...points[index],
      x: Math.round(x * 10000) / 10000,
      y: Math.round(y * 10000) / 10000,
    });
  }
  return glided;
}

function smoothstep(raw: number): number {
  const t = Math.max(0, Math.min(1, raw));
  return t * t * (3 - 2 * t);
}

export async function analyzePanScan(
  file: File,
  aspect: number,
  onProgress: (progress: PanScanProgress) => void,
  bounds?: ContentBounds | null
): Promise<PanScanData> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  let detector: ObjectDetector | null = null;

  try {
    video.src = objectUrl;
    onProgress({ progress: 0.02, message: "Lecture des informations vidéo…" });
    await waitForMetadata(video);
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      throw new Error("Les dimensions ou la durée de cette vidéo sont inconnues.");
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("La première image ne peut pas être lue.")), { once: true });
      });
    }

    const safeBounds =
      bounds === undefined
        ? await detectVideoLetterbox(file)
        : bounds ?? NO_BARS;
    onProgress({ progress: 0.05, message: "Chargement du modèle IA de détection des personnes…" });
    try {
      detector = await createPersonDetector();
    } catch {
      onProgress({ progress: 0.08, message: "Modèle IA indisponible : analyse de mouvement de secours…" });
    }

    const canvas = document.createElement("canvas");
    const analysisScale = Math.min(1, ANALYSIS_WIDTH / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(16, Math.round(video.videoWidth * analysisScale));
    canvas.height = Math.max(16, Math.round(video.videoHeight * analysisScale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Impossible de préparer l'analyse vidéo.");

    const duration = video.duration;
    const sampleInterval = 1 / PAN_SCAN_FPS;
    const sampleCount = Math.max(2, Math.floor(duration * PAN_SCAN_FPS) + 1);
    const points: PanScanKeyframe[] = [];
    let previousImage: ImageData | null = null;
    let previousHistogram: Float32Array | null = null;
    let previousPerson: SubjectBox | null = null;
    let lastCenter: Center = { x: 0.5, y: 0.5 };
    let scenes = 0;
    let detectedPersonFrames = 0;
    let scoreTotal = 0;

    for (let index = 0; index < sampleCount; index++) {
      const time = Math.min(duration, index * sampleInterval);
      await seekTo(video, time);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const histogram = readHistogram(image);
      const cutDistance =
        previousHistogram && previousImage
          ? Math.max(histogramDistance(previousHistogram, histogram), imageDifference(previousImage, image))
          : 1;
      const sceneChanged = index === 0 || cutDistance > 0.43;
      if (sceneChanged) scenes++;

      let chosen: SubjectBox | null = null;
      if (detector) {
        try {
          const people = personBoxes(detector.detect(canvas).detections, canvas.width, canvas.height);
          chosen = choosePerson(people, previousPerson, sceneChanged);
        } catch {
          detector.close();
          detector = null;
          onProgress({ progress: 0.1 + (index / sampleCount) * 0.82, message: "Poursuite par mouvement (détection IA interrompue)…" });
        }
      }

      let center = lastCenter;
      let confidence = 0.18;
      if (chosen) {
        center = {
          x: chosen.x + chosen.width / 2,
          y: chosen.y + chosen.height * 0.42,
        };
        lastCenter = center;
        previousPerson = chosen;
        detectedPersonFrames++;
        scoreTotal += chosen.score;
        confidence = chosen.score;
      } else {
        if (sceneChanged) previousPerson = null;
        const movement = motionCenter(image, previousImage);
        if (movement) {
          center = movement;
          lastCenter = movement;
        }
      }

      const camera = toCameraPosition(
        center,
        video.videoWidth,
        video.videoHeight,
        aspect,
        safeBounds
      );
      points.push({
        time,
        x: camera.x,
        y: camera.y,
        confidence,
        scene: scenes,
      });

      previousImage = image;
      previousHistogram = histogram;
      onProgress({
        progress: 0.1 + ((index + 1) / sampleCount) * 0.88,
        message: `Analyse image ${index + 1}/${sampleCount} · ${scenes} plan${scenes > 1 ? "s" : ""}`,
      });
      await yieldToBrowser();
    }

    const method: PanScanData["method"] = detectedPersonFrames > 0 ? "person" : "motion";
    const smoothed = glidePath(points);
    const confidence =
      method === "person" ? Math.max(0, Math.min(1, scoreTotal / detectedPersonFrames)) : 0.25;

    onProgress({
      progress: 1,
      message:
        method === "person"
          ? `Terminé · ${scenes} plans · sujet humain suivi`
          : `Terminé · ${scenes} plans · suivi de mouvement de secours`,
    });

    return {
      version: 1,
      aspect,
      method,
      confidence,
      scenes: Math.max(1, scenes),
      sampleInterval,
      keyframes: smoothed,
    };
  } finally {
    detector?.close();
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function imageDifference(a: ImageData, b: ImageData): number {
  let total = 0;
  let samples = 0;
  for (let i = 0; i < a.data.length; i += 64) {
    total +=
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]);
    samples++;
  }
  return samples ? total / (samples * 3 * 255) : 0;
}

export function getPanScanPosition(
  panScan: PanScanData,
  time: number
): Center {
  const frames = panScan.keyframes;
  if (!frames.length) return { x: 0.5, y: 0.5 };
  if (time <= frames[0].time) return { x: frames[0].x, y: frames[0].y };
  const last = frames[frames.length - 1];
  if (time >= last.time) return { x: last.x, y: last.y };

  let low = 0;
  let high = frames.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (frames[mid].time <= time) low = mid;
    else high = mid;
  }
  const a = frames[low];
  const b = frames[high];
  const t = smoothstep((time - a.time) / Math.max(0.001, b.time - a.time));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function activeSubject(subjects: PanScanSubject[], time: number): PanScanSubject | null {
  let current: PanScanSubject | null = null;
  for (const subject of subjects) {
    if (subject.time <= time + 0.001) current = subject;
    else break;
  }
  return current;
}

function subjectStarted(subjects: PanScanSubject[], time: number, previousTime: number): boolean {
  return subjects.some(
    (subject) => subject.time > previousTime + 0.001 && subject.time <= time + 0.001
  );
}

function boxFromPoint(x: number, y: number, width = 0.18, height = 0.42): SubjectBox {
  const w = Math.min(0.8, width);
  const h = Math.min(0.9, height);
  return {
    x: Math.max(0, Math.min(1 - w, x)),
    y: Math.max(0, Math.min(1 - h, y)),
    width: w,
    height: h,
    score: 0.4,
  };
}

function seedFromSubject(subject: PanScanSubject, people: SubjectBox[]): SubjectBox {
  const cx = subject.x + subject.width / 2;
  const cy = subject.y + subject.height / 2;
  const containing = people.find(
    (person) =>
      cx >= person.x &&
      cx <= person.x + person.width &&
      cy >= person.y &&
      cy <= person.y + person.height
  );
  if (containing) return containing;
  const nearest = people
    .map((person) => ({
      person,
      distance: Math.hypot(person.x + person.width / 2 - cx, person.y + person.height / 2 - cy),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest && nearest.distance < 0.28) return nearest.person;
  return boxFromPoint(subject.x, subject.y, subject.width, subject.height);
}

function trackSubject(people: SubjectBox[], previous: SubjectBox): SubjectBox | null {
  let best: SubjectBox | null = null;
  let bestScore = 0.22;
  for (const person of people) {
    const distance = Math.hypot(
      person.x + person.width / 2 - (previous.x + previous.width / 2),
      person.y + person.height / 2 - (previous.y + previous.height / 2)
    );
    const score = overlap(previous, person) * 1.4 + Math.max(0, 1 - distance / 0.45) + person.score * 0.15;
    if (score > bestScore) {
      best = person;
      bestScore = score;
    }
  }
  return best;
}

let sharedDetector: Promise<ObjectDetector | null> | null = null;

function detectorSingleton(): Promise<ObjectDetector | null> {
  if (!sharedDetector) {
    sharedDetector = createPersonDetector().catch(() => null);
  }
  return sharedDetector;
}

export async function detectPeopleAt(file: Blob, time: number): Promise<DetectedPerson[]> {
  const detector = await detectorSingleton();
  if (!detector) return [];
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    video.src = url;
    await waitForMetadata(video);
    await seekTo(video, Math.max(0, Math.min(time, Math.max(0, video.duration - 0.05))));
    const scale = Math.min(1, ANALYSIS_WIDTH / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(16, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(16, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return personBoxes(detector.detect(canvas).detections, canvas.width, canvas.height);
  } catch {
    return [];
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function trackAssistedPanScan(
  file: File,
  aspect: number,
  subjects: PanScanSubject[],
  onProgress: (progress: PanScanProgress) => void,
  bounds?: ContentBounds | null
): Promise<PanScanData> {
  if (subjects.length === 0) {
    throw new Error("Désignez au moins le sujet d'un plan avant de lancer le suivi.");
  }
  const ordered = [...subjects].sort((a, b) => a.time - b.time);
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    video.src = objectUrl;
    onProgress({ progress: 0.02, message: "Préparation du suivi assisté…" });
    await waitForMetadata(video);
    if (!video.videoWidth || !video.videoHeight || !(video.duration > 0)) {
      throw new Error("Cette vidéo ne peut pas être analysée image par image.");
    }
    const safeBounds = bounds === undefined ? await detectVideoLetterbox(file) : bounds ?? NO_BARS;
    const detector = await detectorSingleton();
    const scale = Math.min(1, ANALYSIS_WIDTH / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(16, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(16, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Impossible de préparer l'analyse vidéo.");

    const duration = video.duration;
    const sampleCount = Math.max(2, Math.floor(duration * PAN_SCAN_FPS) + 1);
    const desired: PanScanKeyframe[] = [];
    let tracked: SubjectBox | null = null;
    let scenes = 1;
    let hits = 0;
    let scoreTotal = 0;
    let previousTime = -1;

    for (let index = 0; index < sampleCount; index++) {
      const time = Math.min(duration, index / PAN_SCAN_FPS);
      await seekTo(video, time);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const people = detector
        ? personBoxes(detector.detect(canvas).detections, canvas.width, canvas.height)
        : [];
      const subject = activeSubject(ordered, time);
      if (subject && (!tracked || subjectStarted(ordered, time, previousTime))) {
        tracked = seedFromSubject(subject, people);
        scenes = ordered.filter((item) => item.time <= time + 0.001).length;
      }
      let chosen = tracked;
      let confidence = 0.35;
      if (tracked) {
        const followed: SubjectBox | null = people.length
          ? trackSubject(people, tracked)
          : null;
        if (followed) {
          tracked = followed;
          chosen = followed;
          confidence = followed.score;
          hits++;
          scoreTotal += followed.score;
        }
      }
      const center = chosen
        ? { x: chosen.x + chosen.width / 2, y: chosen.y + chosen.height * 0.4 }
        : { x: 0.5, y: 0.45 };
      const camera = toCameraPosition(
        center,
        video.videoWidth,
        video.videoHeight,
        aspect,
        safeBounds
      );
      desired.push({ time, x: camera.x, y: camera.y, confidence, scene: scenes });
      previousTime = time;
      if (index % 2 === 0) {
        onProgress({
          progress: 0.08 + ((index + 1) / sampleCount) * 0.9,
          message: `Suivi ${index + 1}/${sampleCount} · 20 img/s · plan ${scenes}`,
        });
        await yieldToBrowser();
      }
    }

    onProgress({ progress: 1, message: "Trajectoire glissée, sans coupe entre les images." });
    return {
      version: 1,
      aspect,
      method: "assisted",
      confidence: hits ? Math.max(0, Math.min(1, scoreTotal / hits)) : 0.35,
      scenes,
      sampleInterval: 1 / PAN_SCAN_FPS,
      keyframes: glidePath(desired),
      subjects: ordered,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

export function buildHumanPanScan(
  aspect: number,
  duration: number,
  keys: PanScanManualKey[]
): PanScanData {
  const sorted = [...keys]
    .filter((key) => Number.isFinite(key.time))
    .sort((a, b) => a.time - b.time);
  const span = Math.max(duration, sorted.at(-1)?.time ?? 0, 1 / PAN_SCAN_FPS);
  const sampleCount = Math.max(2, Math.floor(span * PAN_SCAN_FPS) + 1);
  const desired: PanScanKeyframe[] = [];
  for (let index = 0; index < sampleCount; index++) {
    const time = Math.min(span, index / PAN_SCAN_FPS);
    const position = interpolateManualKeys(sorted, time);
    desired.push({ time, x: position.x, y: position.y, confidence: 1, scene: 1 });
  }
  return {
    version: 1,
    aspect,
    method: "human",
    confidence: 1,
    scenes: 1,
    sampleInterval: 1 / PAN_SCAN_FPS,
    keyframes: glidePath(desired),
    manualKeys: sorted,
  };
}

function interpolateManualKeys(keys: PanScanManualKey[], time: number): Center {
  if (!keys.length) return { x: 0.5, y: 0.5 };
  if (time <= keys[0].time) return { x: keys[0].x, y: keys[0].y };
  const last = keys[keys.length - 1];
  if (time >= last.time) return { x: last.x, y: last.y };
  let index = 0;
  while (index < keys.length - 1 && keys[index + 1].time < time) index++;
  const start = keys[index];
  const end = keys[index + 1];
  const t = smoothstep((time - start.time) / Math.max(0.001, end.time - start.time));
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}