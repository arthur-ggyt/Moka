import { Coffee } from "lucide-react"

export function MokaWatermark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`pointer-events-none absolute bottom-2.5 left-2.5 z-10 flex select-none items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-moka-50 opacity-10 backdrop-blur-[2px] ${className}`}
      style={{
        animation: "mokaIn 600ms ease-out, mokaHold 1s linear, mokaOut 600ms ease-in 0s forwards",
      }}
    >
      <Coffee className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span className="text-[10px] font-black tracking-[0.28em]">MOKA</span>
      <style>{`@keyframes mokaIn{from{opacity:0; transform:translateY(6px) scale(.98)} to{opacity:.10; transform:translateY(0) scale(1)}} @keyframes mokaHold{} @keyframes mokaOut{to{opacity:.10}}`}</style>
    </span>
  )
}
export function MokaWatermarkAnimated({ show }: { show: boolean }) {
  if(!show) return null
  return <MokaWatermark className="animate-[mokaIn_700ms_ease-out]" />
}
