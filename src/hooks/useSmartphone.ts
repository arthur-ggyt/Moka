import { useEffect, useState } from "react"

/** Vrai quand la fenêtre est en portrait (largeur < hauteur) → mode smartphone. */
export function useSmartphone(): boolean {
  const [is, setIs] = useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < window.innerHeight
  )
  useEffect(() => {
    const update = () => setIs(window.innerWidth < window.innerHeight)
    update()
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
    }
  }, [])
  return is
}
