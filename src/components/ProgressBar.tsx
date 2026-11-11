import { useRef, type PointerEvent } from "react";

interface Props {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function ProgressBar({ currentTime, duration, onSeek, disabled, compact }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const seekFromEvent = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !barRef.current || duration <= 0) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div
      ref={barRef}
      onPointerDown={seekFromEvent}
      className={`group relative w-full cursor-pointer ${compact ? "py-1" : "py-2"} ${
        disabled ? "cursor-default opacity-40" : ""
      }`}
    >
      <div className={`${compact ? "h-1" : "h-1.5"} w-full rounded-full bg-stone-800`}>
        <div
          className="relative h-full rounded-full bg-gradient-to-r from-moka-700 to-moka-500"
          style={{ width: `${pct}%` }}
        >
          <span
            className={`absolute -right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-moka-500 shadow ${
              compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"
            } ${disabled ? "hidden" : ""}`}
          />
        </div>
      </div>
    </div>
  );
}
