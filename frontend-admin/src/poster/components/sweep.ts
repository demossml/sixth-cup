import { useRef, type PointerEvent } from "react";

/**
 * Выбор галочек протяжкой: зажать кнопку мыши на галочке и провести по строкам — все они отметятся
 * (или снимутся, если начали с отмеченной). Касание и клавиатура — обычное переключение.
 * start вешается на ячейку с галочкой (onPointerDown), over — на строку (onPointerEnter), click — на ячейку (onClick).
 */
export function useSweep(isOn: (id: string) => boolean, set: (id: string, on: boolean) => void) {
  const paint = useRef<boolean | null>(null);
  return {
    start(id: string, e: PointerEvent) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      e.preventDefault(); // чтобы при протяжке не выделялся текст
      paint.current = !isOn(id);
      set(id, paint.current);
      const stop = () => {
        window.removeEventListener("pointerup", stop);
        setTimeout(() => (paint.current = null), 0); // после click, который придёт следом за отпусканием
      };
      window.addEventListener("pointerup", stop);
    },
    over(id: string) {
      if (paint.current !== null) set(id, paint.current);
    },
    click(id: string) {
      if (paint.current === null) set(id, !isOn(id));
    },
  };
}
export type Sweep = ReturnType<typeof useSweep>;
