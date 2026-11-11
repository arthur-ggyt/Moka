// ============================================================
// IA MOKA — calibration automatique de la synchronisation
// (100 % locale : aucune donnée n'est envoyée)
//
// Étape 1 : corrélation croisée rapide par FFT à 20 Hz sur la
//           totalité des deux pistes → position grossière du
//           décalage + parabolisation sub-échantillon.
// Étape 2 : raffinement par corrélation directe à 50 Hz dans
//           une fenêtre de ±0,5 s autour du pic (précision ~ms).
// ============================================================

import type { Waveform } from "./waveform";

export interface AutoCalibResult {
  /** Secondes — convention : videoTime = musicTime + offset */
  offset: number;
  /** 0..1 — fiabilité de l'alignement détecté */
  confidence: number;
}

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** FFT radix-2 itérative (tablées complexes séparées). */
function fft(re: Float32Array, im: Float32Array, invert: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (invert ? -1 : 1);
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const i1 = i + k;
        const i2 = i1 + half;
        const br = re[i2] * cr - im[i2] * ci;
        const bi = re[i2] * ci + im[i2] * cr;
        re[i2] = re[i1] - br;
        im[i2] = im[i1] - bi;
        re[i1] += br;
        im[i1] += bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function resample(src: Float32Array, srcHz: number, dstHz: number): Float32Array {
  if (Math.abs(srcHz - dstHz) < 0.01) return src;
  const n = Math.max(2, Math.round(src.length * (dstHz / srcHz)));
  const out = new Float32Array(n);
  const ratio = src.length / n;
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const i0 = Math.min(Math.floor(p), src.length - 1);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const f = p - Math.floor(p);
    out[i] = src[i0] * (1 - f) + src[i1] * f;
  }
  return out;
}

function normalize(a: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < a.length; i++) mean += a[i];
  mean /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - mean;
    v += d * d;
  }
  const sd = Math.sqrt(v / a.length) || 1;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - mean) / sd;
  return out;
}

export function autoDetectOffset(music: Waveform, video: Waveform): AutoCalibResult {
  /* ---------- ÉTAPE 1 : FFT 20 Hz ---------- */
  const FS1 = 20;
  const m1 = normalize(resample(music.peaks, music.bucketsPerSec, FS1));
  const v1 = normalize(resample(video.peaks, video.bucketsPerSec, FS1));

  const N = nextPow2(m1.length + v1.length);
  const mR = new Float32Array(N);
  const mI = new Float32Array(N);
  const vR = new Float32Array(N);
  const vI = new Float32Array(N);
  mR.set(m1);
  vR.set(v1);
  fft(mR, mI, false);
  fft(vR, vI, false);

  // Corrélation circulaire : z[k] = Σ m[n]·v[(n−k) mod N]
  for (let i = 0; i < N; i++) {
    const ar = mR[i] * vR[i] + mI[i] * vI[i];
    const ai = mI[i] * vR[i] - mR[i] * vI[i];
    mR[i] = ar;
    mI[i] = ai;
  }
  fft(mR, mI, true);

  // s(k) = Σ m[n]·v[n+k] = z[(N−k) mod N]
  const s = (k: number) => mR[(((N - k) % N) + N) % N];

  const maxLag = Math.min(m1.length, v1.length) - 1;
  const minOverlap = Math.floor(4 * FS1); // au moins 4 s de recouvrement
  let bestK = 0;
  let bestScore = -Infinity;
  for (let k = -maxLag; k <= maxLag; k++) {
    const overlap = Math.min(m1.length, v1.length + k) - Math.max(0, k);
    if (overlap < minOverlap) continue;
    const score = s(k) / overlap;
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
    }
  }

  // Parabolisation autour du pic
  const y0 = s(bestK - 1);
  const y1 = s(bestK);
  const y2 = s(bestK + 1);
  const denom1 = y0 - 2 * y1 + y2;
  const delta1 =
    Math.abs(denom1) > 1e-9 ? clamp((0.5 * (y0 - y2)) / denom1, -0.5, 0.5) : 0;

  let offset = (bestK + delta1) / FS1;
  let confidence = clamp(bestScore, 0, 1);

  /* ---------- ÉTAPE 2 : raffinement 50 Hz ± 0,5 s ---------- */
  const FS2 = 50;
  const STEP = 0.005;
  const m2 = resample(music.peaks, music.bucketsPerSec, FS2);
  const v2 = resample(video.peaks, video.bucketsPerSec, FS2);

  const mStart = Math.max(0, Math.floor(-offset * FS2));
  const baseV = mStart + Math.max(0, Math.round(offset * FS2));
  const maxL = Math.min(
    m2.length - mStart,
    v2.length - baseV,
    Math.floor(60 * FS2) // fenêtre de 60 s max
  );

  const scoreAt = (dk: number): number => {
    const vStart = baseV + Math.round(dk * FS2);
    if (vStart < 0 || vStart + maxL > v2.length) return -Infinity;
    let sum = 0;
    for (let i = 0; i < maxL; i++) sum += m2[mStart + i] * v2[vStart + i];
    return sum / maxL;
  };

  if (maxL >= 250) {
    let bestDk = 0;
    let bestS2 = -Infinity;
    for (let dk = -0.5; dk <= 0.5001; dk += STEP) {
      const sc = scoreAt(dk);
      if (sc > bestS2) {
        bestS2 = sc;
        bestDk = dk;
      }
    }
    const p = scoreAt(bestDk - STEP);
    const c0 = scoreAt(bestDk);
    const nx = scoreAt(bestDk + STEP);
    const denom2 = p - 2 * c0 + nx;
    const dd =
      Math.abs(denom2) > 1e-12
        ? clamp((0.5 * (p - nx)) / denom2, -STEP, STEP)
        : 0;
    offset += bestDk + dd;
    if (isFinite(c0)) confidence = clamp(c0, 0, 1);
  }

  return { offset: Math.round(offset * 1000) / 1000, confidence };
}
