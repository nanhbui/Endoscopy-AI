/**
 * format.ts — shared Vietnamese date/time formatters.
 *
 * Consolidates the fmtDate/fmtTs copies that were duplicated in the Report page
 * and the print route. (Workspace keeps its own "m:ss" clock — a different
 * format — on purpose.)
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Unix ms → "dd/mm/yyyy hh:mm". */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Seconds → "m phút ss giây" (or "ss giây" when under a minute). */
export function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m} phút ${pad(s)} giây` : `${s} giây`;
}
