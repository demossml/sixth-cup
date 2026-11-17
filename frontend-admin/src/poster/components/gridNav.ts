import type { KeyboardEvent } from "react";

// Навигация по таблицам стрелками, как в электронной таблице.
// Строка — элемент с [data-nav-row], ячейка — с [data-nav="<номер колонки>"].
// Номера колонок общие для всех таблиц, поэтому ↑/↓ переходят и между таблицами.
//   ↑ ↓      — строка выше/ниже, та же колонка (или ближайшая)
//   ← →      — соседняя ячейка; в тексте — только когда курсор у края
//   Enter    — вниз (в поле ввода)

const rowsOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-nav-row]")];
const cellsOf = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>("[data-nav]")].filter((c) => c.closest("[data-nav-row]") === row && !(c as HTMLButtonElement).disabled);
const colOf = (c: HTMLElement) => Number(c.dataset.nav);

export function focusCell(el: HTMLElement | undefined) {
  if (!el) return false;
  el.focus();
  if (el instanceof HTMLInputElement && el.type !== "checkbox") el.select();
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

function nearest(cells: HTMLElement[], col: number) {
  let best: HTMLElement | undefined;
  let d = Infinity;
  for (const c of cells) {
    const k = Math.abs(colOf(c) - col);
    if (k < d) {
      d = k;
      best = c;
    }
  }
  return best;
}

export function gridKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.nativeEvent.isComposing) return;
  const el = e.target as HTMLElement;
  const cell = el.closest<HTMLElement>("[data-nav]");
  const row = el.closest<HTMLElement>("[data-nav-row]");
  if (!cell || !row || cell !== el) return; // внутри открытого меню строки — своя навигация
  const isText = el instanceof HTMLInputElement && el.type === "text" && !("navFree" in el.dataset);
  const input = el instanceof HTMLInputElement ? el : null;

  const vertical = (dir: 1 | -1) => {
    const rows = rowsOf(e.currentTarget);
    const i = rows.indexOf(row);
    for (let j = i + dir; j >= 0 && j < rows.length; j += dir) {
      const target = nearest(cellsOf(rows[j]), colOf(cell));
      if (target) return focusCell(target);
    }
    return false;
  };
  const horizontal = (dir: 1 | -1) => {
    const cells = cellsOf(row);
    return focusCell(cells[cells.indexOf(cell) + dir]);
  };

  switch (e.key) {
    case "ArrowUp":
    case "ArrowDown":
      if (vertical(e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
      break;
    case "ArrowLeft":
    case "ArrowRight": {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      if (isText && input) {
        const len = input.value.length;
        const collapsed = input.selectionStart === input.selectionEnd;
        const atEdge = dir < 0 ? input.selectionStart === 0 && collapsed : input.selectionEnd === len && collapsed;
        const all = input.selectionStart === 0 && input.selectionEnd === len && len > 0;
        if (!atEdge && !all) return;
      }
      if (horizontal(dir)) e.preventDefault();
      break;
    }
    case "Enter":
      if (input) {
        e.preventDefault();
        vertical(1);
      }
      break;
  }
}
