/**
 * mst-mapping.ts — Pure helper: maps LesionReport + SessionSummary data into
 * an MST (Minimal Standard Terminology) structured view-model for the print page.
 *
 * No React, no side effects — fully unit-testable.
 * MST flow: Indication → Technique → Findings → Impression → Recommendations → Citations
 */

import type { LesionReport, SessionSummary, Citation } from './ws-client';

// ── Public view-model types ───────────────────────────────────────────────────

export interface MstFinding {
  /** Index in the original detections array (1-based for display). */
  idx: number;
  /** Anatomical location; "Không xác định" when missing — never fabricated. */
  location: string;
  primaryDx: string;
  severity: string;
  parisClass: string;
  sizeMm: string;
  surface: string;
  color: string;
  margin: string;
  vascular: string;
  aiConfidence: number;
  frame_b64?: string;
  /** Citation labels associated with this lesion (e.g. "[Paris 2002]"). */
  citationLabels: string[];
}

export interface MstImpression {
  primaryDx: string;
  severity: string;
  differential: { dx: string; probability_pct: number }[];
  citationLabels: string[];
}

export interface MstRecommendation {
  text: string;
  /** Index of source lesion (1-based). */
  lesionIdx: number;
}

export interface MstSectionModel {
  /** Section 1 — populated by PatientContext (handled separately by caller). */
  indication?: string;
  /** Section 2 — technique summary from first available lesion report. */
  technique?: { method: string; device: string };
  /** Section 3 — Findings per lesion. */
  findings: MstFinding[];
  /** Section 4 — Impression / diagnoses. */
  impressions: MstImpression[];
  /** Section 5 — Recommendations (deduplicated). */
  recommendations: MstRecommendation[];
  /** Section 6 — All citations (from summary + lesion reports). */
  allCitations: Citation[];
  /** Overall risk from session summary. */
  overallRisk?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCitationLabels(citations?: Citation[]): string[] {
  return (citations ?? []).map((c) => c.label).filter(Boolean);
}

// ── Main mapping function ─────────────────────────────────────────────────────

/**
 * Build an MST section view-model from detection reports + session summary.
 *
 * @param detections - array of {lesionReport, frame_b64, label} objects (from print page).
 * @param summary - SessionSummary or null (old sessions without summary).
 * @returns MstSectionModel — all fields safe to render; empty arrays/undefined for missing data.
 */
export function buildMstModel(
  detections: Array<{
    lesionReport?: LesionReport | null;
    frame_b64?: string;
    label?: string;
  }>,
  summary: SessionSummary | null | undefined,
): MstSectionModel {
  const findings: MstFinding[] = [];
  const impressions: MstImpression[] = [];
  const recommendations: MstRecommendation[] = [];
  let technique: MstSectionModel['technique'] | undefined;
  const citationSet = new Set<string>();
  const allCitationsMap = new Map<string, Citation>();

  // Collect summary-level citations first.
  for (const c of summary?.citations ?? []) {
    if (c.label && !allCitationsMap.has(c.label)) {
      allCitationsMap.set(c.label, c);
    }
  }

  detections.forEach((det, i) => {
    const r = det.lesionReport;
    const idx = i + 1;

    // Technique: use first report's technique (all share the same scope/device).
    if (!technique && r?.technique) {
      technique = { method: r.technique.method, device: r.technique.device };
    }

    // Lesion-level citations.
    const lesionCitationLabels = extractCitationLabels(r?.citations);
    for (const c of r?.citations ?? []) {
      if (c.label && !allCitationsMap.has(c.label)) {
        allCitationsMap.set(c.label, c);
      }
      citationSet.add(c.label);
    }

    findings.push({
      idx,
      // Location is not in the current LesionReport schema → fallback required by spec.
      location: 'Không xác định',
      primaryDx: r?.conclusion?.primary_dx ?? det.label ?? '—',
      severity: r?.conclusion?.severity ?? '—',
      parisClass: r?.description?.paris_class ?? '—',
      sizeMm: r?.description?.size_mm ?? '—',
      surface: r?.description?.surface ?? '—',
      color: r?.description?.color ?? '—',
      margin: r?.description?.margin ?? '—',
      vascular: r?.description?.vascular ?? '—',
      aiConfidence: r?.conclusion?.ai_confidence ?? 0,
      frame_b64: det.frame_b64 ?? undefined,
      citationLabels: lesionCitationLabels,
    });

    if (r) {
      impressions.push({
        primaryDx: r.conclusion.primary_dx,
        severity: r.conclusion.severity,
        differential: r.conclusion.differential ?? [],
        citationLabels: lesionCitationLabels,
      });

      r.conclusion.recommendations.forEach((text) => {
        recommendations.push({ text, lesionIdx: idx });
      });
    }
  });

  // Deduplicate recommendations by text.
  const seenRecs = new Set<string>();
  const dedupedRecs = recommendations.filter((rec) => {
    if (seenRecs.has(rec.text)) return false;
    seenRecs.add(rec.text);
    return true;
  });

  return {
    technique,
    findings,
    impressions,
    recommendations: dedupedRecs,
    allCitations: Array.from(allCitationsMap.values()),
    overallRisk: summary?.overall_risk,
  };
}
