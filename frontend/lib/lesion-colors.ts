/**
 * lesion-colors.ts — single source of truth for lesion label → severity color.
 *
 * Medical convention (Seaborn deep palette): cancer=red, inflammation=orange,
 * ulcer=green. Replaces the duplicated bboxColorFor / colorFor / inline-ternary
 * implementations that previously lived in workspace, report and
 * browser-capture-live (some used .test(), some .includes() — now unified).
 */

export const LESION_COLORS = {
  cancer: '#C44E52', // Ung thư …
  inflam: '#DD8452', // Viêm … (also the default)
  ulcer:  '#55A868', // Loét …
} as const;

/** Map a Vietnamese lesion label to its severity color. */
export function labelToColor(label: string): string {
  if (/ung thư|ung thu/i.test(label)) return LESION_COLORS.cancer;
  if (/loét|loet/i.test(label))       return LESION_COLORS.ulcer;
  return LESION_COLORS.inflam; // viêm + default
}

/** Convert a #rrggbb hex + alpha (0–1) into an rgba() string. */
export function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
