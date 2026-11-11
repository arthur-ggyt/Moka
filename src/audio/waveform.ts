// Extraction du spectre audio (forme d'onde) d'un fichier audio OU vidéo.
// Web Audio API : decodeAudioData sait extraire la piste audio d'un MP4.

export interface Waveform {
  peaks: Float32Array;
  duration: number;
  bucketsPerSec: number;
}

export async function extractWaveform(
  file: Blob,
  bucketsPerSec = 50
): Promise<Waveform> {
  const Ctx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctx();
  try {
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    const duration = audioBuf.duration;
    const n = Math.max(1, Math.ceil(duration * bucketsPerSec));
    const peaks = new Float32Array(n);
    const samplesPerBucket = Math.max(
      1,
      Math.floor(audioBuf.sampleRate / bucketsPerSec)
    );

    for (let c = 0; c < audioBuf.numberOfChannels; c++) {
      const data = audioBuf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        let max = 0;
        const start = i * samplesPerBucket;
        const end = Math.min(start + samplesPerBucket, data.length);
        // pas de 4 échantillons : largement suffisant pour un affichage
        for (let j = start; j < end; j += 4) {
          const v = Math.abs(data[j]);
          if (v > max) max = v;
        }
        if (max > peaks[i]) peaks[i] = max;
      }
    }

    return { peaks, duration, bucketsPerSec };
  } finally {
    void ctx.close();
  }
}

/** Dessine une forme d'onde sur un canvas (largeur = durée × pxPerSec). */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  wf: Waveform,
  pxPerSec: number,
  color: string,
  gridColor = "rgba(19,27,51,0.10)"
): void {
  const width = Math.max(1, Math.min(32000, Math.ceil(wf.duration * pxPerSec)));
  const height = 88;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, width, height);

  // Grille : une ligne par seconde (aide à l'alignement)
  g.fillStyle = gridColor;
  for (let s = 0; s <= wf.duration; s++) {
    g.fillRect(Math.floor(s * pxPerSec), 0, 1, height);
  }

  // Forme d'onde
  const mid = height / 2;
  g.fillStyle = color;
  for (let x = 0; x < width; x++) {
    const idx = Math.floor((x / pxPerSec) * wf.bucketsPerSec);
    const p = wf.peaks[idx] ?? 0;
    const h = Math.max(1, p * (mid - 4));
    g.fillRect(x, mid - h, 1, h * 2);
  }
}
