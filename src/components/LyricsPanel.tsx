import { useEffect, useRef } from "react";
import { activeLyricIndex, activeWordIndex, type Lyrics } from "../lyrics";

export function LyricsPanel({
  lyrics,
  time,
  duration,
  compact = false,
  className = "",
}: {
  lyrics: Lyrics;
  time: number;
  duration: number;
  compact?: boolean;
  className?: string;
}) {
  const index = activeLyricIndex(lyrics, time, duration);
  const currentRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [index]);

  return (
    <div
      className={`overflow-y-auto rounded-2xl border border-moka-200 bg-moka-900/40/70 px-4 ${
        compact ? "h-36 py-3" : "h-full py-6"
      } ${className}`}
    >
      <div className="space-y-3 text-center">
        {lyrics.lines.map((line, lineIndex) => {
          const active = lineIndex === index;
          const wordIndex = active ? activeWordIndex(line, time, lyrics.offset) : -1;
          return (
            <p
              key={`${line.time}-${lineIndex}`}
              ref={active ? currentRef : undefined}
              className={`transition ${
                active
                  ? compact
                    ? "text-base font-semibold text-moka-800"
                    : "text-2xl font-semibold text-moka-800"
                  : compact
                    ? "text-sm text-slate-400"
                    : "text-base text-slate-400"
              }`}
            >
              {active && line.words?.length
                ? line.words.map((word, wordPosition) => (
                    <span
                      key={`${word.time}-${wordPosition}`}
                      className={wordPosition === wordIndex ? "font-bold text-moka-950" : "text-moka-500"}
                    >
                      {word.text}
                    </span>
                  ))
                : line.text}
            </p>
          );
        })}
      </div>
      {lyrics.format === "text" && (
        <p className="mt-4 text-center text-[10px] tracking-widest text-slate-400">
          SURALIGNAGE ESTIMÉ
        </p>
      )}
    </div>
  );
}

export function CurrentLyric({
  lyrics,
  time,
  duration,
}: {
  lyrics: Lyrics;
  time: number;
  duration: number;
}) {
  const index = activeLyricIndex(lyrics, time, duration);
  const line = index >= 0 ? lyrics.lines[index] : null;
  if (!line) return null;
  const wordIndex = activeWordIndex(line, time, lyrics.offset);
  return (
    <p className="truncate text-center text-sm text-moka-300">
      {line.words?.length
        ? line.words.map((word, position) => (
            <span key={`${word.time}-${position}`} className={position === wordIndex ? "font-bold text-moka-950" : ""}>
              {word.text}
            </span>
          ))
        : line.text}
    </p>
  );
}
