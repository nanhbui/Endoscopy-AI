/**
 * shared.ts — Shared constants for session-summary tab components.
 * Kept in sync with the same constants in session-summary-panel.tsx (DRY by extraction).
 */

export const RISK_STYLE = {
  'thấp':       { color: '#2E7D32', bg: 'rgba(46,125,50,0.10)',  emoji: '🟢' },
  'trung bình': { color: '#ED6C02', bg: 'rgba(237,108,2,0.10)',  emoji: '🟡' },
  'cao':        { color: '#D32F2F', bg: 'rgba(211,47,47,0.10)',  emoji: '🔴' },
} as const;

export const CATEGORY_LABEL = {
  sinh_thiet: 'Sinh thiết',
  test:       'Xét nghiệm',
  dieu_tri:   'Điều trị',
  tai_kham:   'Tái khám',
} as const;

/** PatientContext fields returned by GET /sessions/{id}/patient-context */
export interface PatientContextData {
  age?: number | null;
  sex?: string | null;
  indication?: string | null;
  history?: string | null;
  meds?: string | null;
}
