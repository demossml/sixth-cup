import { LOGO } from "@/lib/layout/design";

/** Логотип 6.7 — тот же контур, что печатается на листе. */
export function Logo({ height = 16 }: { height?: number }) {
  return (
    <svg className="logo" viewBox="0 0 125 39" height={height} width={(height * 125) / 39} aria-hidden>
      <path d={LOGO} fill="currentColor" />
    </svg>
  );
}
