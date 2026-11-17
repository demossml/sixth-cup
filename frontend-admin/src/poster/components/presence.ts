import { useEffect, useState } from "react";

/**
 * Всплывающее (меню, дропдаун, подсказка) остаётся в разметке ещё exitMs после закрытия — успевает уйти
 * анимацией, а не пропасть. closing — уже закрыто, но ещё уходит: ставим data-closing, CSS проигрывает уход
 * и отключает клики. При «уменьшить движение» уходит сразу.
 */
export function usePresence(open: boolean, exitMs = 120): { mounted: boolean; closing: boolean } {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => setShown(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: open || shown, closing: !open && shown };
}
