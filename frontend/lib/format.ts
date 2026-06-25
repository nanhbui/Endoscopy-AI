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

/** Byte count → human-readable "KB / MB / GB" (library + recordings lists). */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** ISO timestamp → "dd/mm/yyyy hh:mm" via the vi-VN locale (library + recordings). */
export function fmtIsoDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Duration in ms → "m:ss"; empty string when unknown/zero. */
export function fmtDurationMs(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
