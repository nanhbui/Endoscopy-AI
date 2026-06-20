import { describe, expect, test } from 'vitest';
import { buildMstModel } from '../lib/mst-mapping';
import type { LesionReport } from '../lib/ws-client';

/**
 * mst-mapping unit tests — pure function, no React, no HTTP.
 * Verifies MST view-model construction + backward-compat guards.
 */

function makeLesionReport(overrides?: Partial<LesionReport>): LesionReport {
  return {
    technique: { method: 'WL', device: 'Olympus CF-H290', timestamp: '00:01:23' },
    description: {
      size_mm: '8', paris_class: '0-IIa', surface: 'nhám',
      color: 'đỏ', margin: 'rõ', vascular: 'NBI tăng sinh mạch', fluid: 'không',
    },
    conclusion: {
      primary_dx: 'Polyp tuyến',
      severity: 'trung bình',
      differential: [{ dx: 'Viêm loét', probability_pct: 20 }],
      recommendations: ['Sinh thiết tức thì', 'Tái khám sau 3 tháng'],
      ai_confidence: 85,
    },
    ...overrides,
  };
}

// ── Location fallback ────────────────────────────────────────────────────────

describe('location fallback', () => {
  test('always "Không xác định" when no location field in LesionReport', () => {
    const model = buildMstModel([{ lesionReport: makeLesionReport() }], null);
    expect(model.findings[0].location).toBe('Không xác định');
  });

  test('uses det.label as primaryDx fallback when no report', () => {
    const model = buildMstModel([{ label: 'Polyp' }], null);
    expect(model.findings[0].primaryDx).toBe('Polyp');
    expect(model.findings[0].location).toBe('Không xác định');
  });
});

// ── Empty / null guards (backward compat) ────────────────────────────────────

describe('backward compatibility', () => {
  test('empty detections + null summary → empty model (no crash)', () => {
    const model = buildMstModel([], null);
    expect(model.findings).toHaveLength(0);
    expect(model.impressions).toHaveLength(0);
    expect(model.recommendations).toHaveLength(0);
    expect(model.allCitations).toHaveLength(0);
    expect(model.overallRisk).toBeUndefined();
  });

  test('detection with null lesionReport → finding with fallback values', () => {
    const model = buildMstModel([{ lesionReport: null, label: 'Unknown' }], null);
    expect(model.findings).toHaveLength(1);
    expect(model.findings[0].parisClass).toBe('—');
    expect(model.impressions).toHaveLength(0);
  });
});

// ── Technique extraction ─────────────────────────────────────────────────────

describe('technique extraction', () => {
  test('takes first report technique', () => {
    const model = buildMstModel([
      { lesionReport: makeLesionReport() },
      { lesionReport: makeLesionReport({ technique: { method: 'NBI', device: 'Other', timestamp: '00:02' } }) },
    ], null);
    expect(model.technique?.method).toBe('WL');
    expect(model.technique?.device).toBe('Olympus CF-H290');
  });

  test('undefined when no reports', () => {
    const model = buildMstModel([{ label: 'Polyp' }], null);
    expect(model.technique).toBeUndefined();
  });
});

// ── Recommendation deduplication ─────────────────────────────────────────────

describe('recommendation deduplication', () => {
  test('same text from two lesions appears once', () => {
    const model = buildMstModel([
      { lesionReport: makeLesionReport() },
      { lesionReport: makeLesionReport() },
    ], null);
    const texts = model.recommendations.map((r) => r.text);
    const unique = new Set(texts);
    expect(texts.length).toBe(unique.size);
  });

  test('different recommendations preserved', () => {
    const r1 = makeLesionReport();
    const r2 = makeLesionReport();
    r2.conclusion.recommendations = ['Chụp CT bụng'];
    const model = buildMstModel([{ lesionReport: r1 }, { lesionReport: r2 }], null);
    expect(model.recommendations.some((r) => r.text === 'Sinh thiết tức thì')).toBe(true);
    expect(model.recommendations.some((r) => r.text === 'Chụp CT bụng')).toBe(true);
  });
});

// ── Citations merging ────────────────────────────────────────────────────────

describe('citations merging', () => {
  test('summary citations propagated to allCitations', () => {
    const model = buildMstModel([], {
      overview: { total_findings: 0, duration_seconds: 0, confirmed_count: 0, ignored_count: 0 },
      priority_findings: [],
      patterns: [],
      checklist: [],
      overall_risk: 'thấp',
      citations: [{ label: 'Paris 2002', source_guideline: 'Paris Classification', year: 2002 }],
    });
    expect(model.allCitations).toHaveLength(1);
    expect(model.allCitations[0].label).toBe('Paris 2002');
  });

  test('lesion citations merged into allCitations, deduped', () => {
    const r = makeLesionReport({ citations: [{ label: 'ESGE 2019', year: 2019 }] });
    const model = buildMstModel(
      [{ lesionReport: r }, { lesionReport: r }],
      {
        overview: { total_findings: 2, duration_seconds: 10, confirmed_count: 2, ignored_count: 0 },
        priority_findings: [],
        patterns: [],
        checklist: [],
        overall_risk: 'cao',
        citations: [{ label: 'ESGE 2019', year: 2019 }],
      },
    );
    // Should be deduplicated across summary + both lesion reports.
    expect(model.allCitations.filter((c) => c.label === 'ESGE 2019')).toHaveLength(1);
  });
});

// ── idx numbering ────────────────────────────────────────────────────────────

describe('idx numbering', () => {
  test('findings are 1-based indexed', () => {
    const model = buildMstModel([
      { lesionReport: makeLesionReport() },
      { lesionReport: makeLesionReport() },
    ], null);
    expect(model.findings[0].idx).toBe(1);
    expect(model.findings[1].idx).toBe(2);
  });
});
