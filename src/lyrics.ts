export interface LyricWord {
  time: number;
  text: string;
}

export interface LyricLine {
  time: number;
  text: string;
  words?: LyricWord[];
}

export interface Lyrics {
  format: "text" | "lrc";
  text: string;
  offset: number;
  lines: LyricLine[];
}

const STAMP = /^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/;

export function stampToSeconds(value: string): number | null {
  const match = STAMP.exec(value.trim());
  if (!match) return null;
  const fraction = match[3];
  const decimals = fraction ? Number(fraction) / 10 ** fraction.length : 0;
  return Number(match[1]) * 60 + Number(match[2]) + decimals;
}

export function parseLyrics(raw: string, format: "text" | "lrc"): Lyrics {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (format === "text") {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ time: -1, text: line }));
    return { format, text, offset: 0, lines };
  }

  let offset = 0;
  const lines: LyricLine[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const offsetMatch = /^\[offset:([+-]?\d+)\]$/i.exec(line);
    if (offsetMatch) {
      offset = Number(offsetMatch[1]) / 1000;
      continue;
    }
    if (/^\[[a-z]+:.*\]$/i.test(line)) continue;

    const times: number[] = [];
    const body = line.replace(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g, (_, stamp: string) => {
      const seconds = stampToSeconds(stamp);
      if (seconds !== null) times.push(seconds);
      return "";
    }).trim();
    if (!times.length) continue;

    const words: LyricWord[] = [];
    const plain = body.replace(/<(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)>/g, "\u0000$1\u0000");
    if (plain.includes("\u0000")) {
      const parts = plain.split("\u0000");
      for (let i = 1; i < parts.length; i += 2) {
        const time = stampToSeconds(parts[i]);
        const word = (parts[i + 1] ?? "").replace(/\s+/g, " ");
        if (time !== null && word.trim()) words.push({ time, text: word });
      }
    }
    const textBody =
      body.replace(/<(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)>/g, "").replace(/\s+/g, " ").trim() ||
      "♪";
    for (const time of times) {
      lines.push({
        time,
        text: textBody,
        ...(words.length ? { words: words.map((word) => ({ ...word, time: word.time })) } : {}),
      });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return { format: "lrc", text, offset, lines };
}

export function activeLyricIndex(lyrics: Lyrics, time: number, duration = 0): number {
  if (!lyrics.lines.length) return -1;
  if (lyrics.format === "lrc") {
    const now = time - lyrics.offset;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (lyrics.lines[i].time <= now) index = i;
      else break;
    }
    return index;
  }
  if (duration <= 0) return -1;
  const slot = duration / lyrics.lines.length;
  return Math.max(0, Math.min(lyrics.lines.length - 1, Math.floor(time / slot)));
}

export function activeWordIndex(line: LyricLine, time: number, offset = 0): number {
  if (!line.words?.length) return -1;
  const now = time - offset;
  let index = -1;
  for (let i = 0; i < line.words.length; i++) {
    if (line.words[i].time <= now) index = i;
    else break;
  }
  return index;
}
