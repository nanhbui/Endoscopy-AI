/**
 * lesion-report-edits.ts — helpers for "Báo sai phân tích" (flag the AI analysis
 * as wrong). Three doctor choices, all producing a new LesionReport:
 *   - reanalyzeReport  → re-run the VLM on the same frame
 *   - withEditedText   → keep the doctor's manual rewrite (sent verbatim to summary)
 *   - clearedReport    → drop the analysis but keep the lesion as a finding
 * Distinct from detect "Báo sai" (which marks the detection itself a false positive).
 */

import type { LesionReport } from '@/lib/ws-client';
import { API_BASE } from '@/lib/ws-client';
import { lesionReportToMarkdown } from '@/context/AnalysisContext';

/** base64 (no data: prefix) → JPEG Blob. Shared by live capture + re-analyze. */
export function b64ToJpegBlob(b64: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

export function isClearedReport(r?: LesionReport | null): boolean {
  return !!r?.analysis_cleared;
}

/** Text the "Tự sửa" editor opens with: the doctor's prior edit, else the
 *  current AI analysis rendered as markdown. */
export function reportToEditableText(r: LesionReport): string {
  return r.edited_text ?? lesionReportToMarkdown(r);
}

/** "Tự sửa" — attach the doctor's text; supersedes any prior "cleared" flag. */
export function withEditedText(r: LesionReport, text: string): LesionReport {
  return { ...r, edited_text: text, analysis_cleared: false };
}

/** "Để trống" — keep the lesion as a finding (label + severity) but drop the
 *  detailed AI analysis. */
export function clearedReport(
  label: string,
  severity: LesionReport['conclusion']['severity'] = 'trung bình',
): LesionReport {
  return {
    technique: { method: '', device: '', timestamp: '' },
    description: { size_mm: '', paris_class: '', surface: '', color: '', margin: '', vascular: '', fluid: '' },
    conclusion: { primary_dx: label, severity, differential: [], recommendations: [], ai_confidence: 0 },
    analysis_cleared: true,
  };
}

/** "Phân tích lại" — re-run the VLM on the same frame (reuses /live/explain, the
 *  shared report path). Returns the new structured report. */
export async function reanalyzeReport(frameB64: string, label: string, confidence: number): Promise<LesionReport> {
  const qs = new URLSearchParams({ label, conf: String(confidence) });
  const r = await fetch(`${API_BASE}/live/explain?${qs.toString()}`, { method: 'POST', body: b64ToJpegBlob(frameB64) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  const data = await r.json();
  if (!data.report) throw new Error('Không nhận được phân tích mới');
  return data.report as LesionReport;
}
