'use client';

/**
 * print-sections.tsx — MST-structured section components for the print report.
 * Extracted from page.tsx to keep each file under 200 lines.
 *
 * MST flow: Indication → Technique → Findings → Impression → Recommendations → Citations
 */

import type { MstSectionModel } from '@/lib/mst-mapping';
import type { PatientContextData } from '@/components/session-summary/shared';
import type { Detection } from '@/context/AnalysisContext';
import type { Citation } from '@/lib/ws-client';
import { fmtDateTime as fmtDate, fmtClock as fmtTs } from '@/lib/format';

// ── Severity constants (kept local — no MUI in print page) ──────────────────

const SEVERITY = {
  'thấp':       { color: '#2E7D32', label: 'Thấp',       emoji: '🟢' },
  'trung bình': { color: '#ED6C02', label: 'Trung bình', emoji: '🟡' },
  'cao':        { color: '#D32F2F', label: 'Cao',        emoji: '🔴' },
} as const;
type SevKey = keyof typeof SEVERITY;

const CATEGORY = {
  sinh_thiet: 'Sinh thiết', test: 'Xét nghiệm',
  dieu_tri:   'Điều trị',   tai_kham: 'Tái khám',
} as const;

// ── Inline citation label (e.g. "[Paris 2002]") ──────────────────────────────

export function CitationTag({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px',
      backgroundColor: 'rgba(0,96,100,0.09)', color: '#006064',
      border: '1px solid rgba(0,96,100,0.25)', borderRadius: 3,
      marginLeft: 4, verticalAlign: 'middle',
    }}>{label}</span>
  );
}

// ── Patient block (Section 0 — below header) ─────────────────────────────────

export function PatientBlock({ ctx }: { ctx: PatientContextData }) {
  const fields: [string, string | number | null | undefined][] = [
    ['Tuổi / Age', ctx.age],
    ['Giới / Sex', ctx.sex],
    ['Lý do nội soi / Indication', ctx.indication],
    ['Tiền sử / History', ctx.history],
    ['Thuốc đang dùng / Meds', ctx.meds],
  ];
  const populated = fields.filter(([, v]) => v != null && v !== '');
  if (!populated.length) return null;

  return (
    <section className="page-section patient-block">
      <h2 className="section-title">Thông tin bệnh nhân (Patient)</h2>
      <table className="patient-table">
        <tbody>
          {populated.map(([k, v]) => (
            <tr key={k}><td className="pt-key">{k}</td><td>{String(v)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── MST Sections 1–6 ─────────────────────────────────────────────────────────

export function MstSections({ model, detections, sessionName, sessionSource, sessionStartedAt, sessionId }: {
  model: MstSectionModel;
  detections: Detection[];
  sessionName: string;
  sessionSource: string;
  sessionStartedAt: number;
  sessionId: string;
}) {
  return (
    <>
      {/* S1 — Chỉ định (Indication) — from patient context / model.indication */}
      {model.overallRisk && (
        <section className="page-section">
          <h2 className="section-title">1. Chỉ định (Indication)</h2>
          <p>Khám nội soi tiêu hóa có AI hỗ trợ — phiên {sessionName} · {fmtDate(sessionStartedAt)} · {sessionSource}</p>
          <p className="muted" style={{ fontSize: 11 }}>Mã phiên: <code>{sessionId}</code></p>
        </section>
      )}

      {/* S2 — Kỹ thuật (Technique) */}
      {model.technique && (
        <section className="page-section">
          <h2 className="section-title">2. Kỹ thuật (Technique)</h2>
          <p><strong>Phương pháp:</strong> {model.technique.method}</p>
          <p><strong>Thiết bị:</strong> {model.technique.device}</p>
        </section>
      )}

      {/* S3 — Mô tả tổn thương (Findings) */}
      {model.findings.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">3. Mô tả tổn thương (Findings)</h2>
          {model.findings.map((f, i) => (
            <div key={i} className="detection-card">
              <div className="det-head">
                <span className="det-num">#{f.idx}</span>
                <span className="frame-ref">
                  {detections[i] ? `Frame ${Math.round(detections[i].timestamp * 30)} · ${fmtTs(detections[i].timestamp)}` : ''}
                </span>
                {SEVERITY[f.severity as SevKey] && (
                  <span className="badge" style={{
                    backgroundColor: SEVERITY[f.severity as SevKey].color + '20',
                    color: SEVERITY[f.severity as SevKey].color,
                    borderColor: SEVERITY[f.severity as SevKey].color + '40',
                  }}>
                    {SEVERITY[f.severity as SevKey].emoji} {SEVERITY[f.severity as SevKey].label}
                  </span>
                )}
                <span className="frame-ref" style={{ marginLeft: 'auto' }}>
                  Vị trí: {f.location}
                </span>
              </div>
              <div className="det-body">
                {f.frame_b64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`data:image/jpeg;base64,${f.frame_b64}`} alt={f.primaryDx} className="det-thumb" />
                ) : <div className="det-thumb" />}
                <div className="det-info">
                  <div className="pdx">{f.primaryDx}</div>
                  <div><dt>Paris:</dt><dd>{f.parisClass}</dd></div>
                  <div><dt>Kích thước:</dt><dd>{f.sizeMm}</dd></div>
                  <div><dt>Bề mặt:</dt><dd>{f.surface}</dd></div>
                  <div><dt>Màu sắc:</dt><dd>{f.color}</dd></div>
                  <div><dt>Bờ:</dt><dd>{f.margin}</dd></div>
                  <div><dt>Mạch máu:</dt><dd>{f.vascular}</dd></div>
                  <div><dt>AI confidence:</dt><dd>{f.aiConfidence}%</dd></div>
                  {f.citationLabels.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {f.citationLabels.map((l) => <CitationTag key={l} label={l} />)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* S4 — Chẩn đoán + phân biệt (Impression) */}
      {model.impressions.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">4. Chẩn đoán + phân biệt (Impression)</h2>
          <ol className="priority-list">
            {model.impressions.map((imp, i) => {
              const sev = SEVERITY[imp.severity as SevKey];
              return (
                <li key={i} className="priority-item">
                  <div className="priority-head">
                    {sev && (
                      <span className="badge" style={{
                        backgroundColor: sev.color + '20', color: sev.color, borderColor: sev.color + '40',
                      }}>{sev.emoji} {sev.label}</span>
                    )}
                    {imp.citationLabels.map((l) => <CitationTag key={l} label={l} />)}
                  </div>
                  <div className="priority-dx">{imp.primaryDx}</div>
                  {imp.differential.length > 0 && (
                    <div className="priority-rationale">
                      Phân biệt: {imp.differential.map((d) => `${d.dx} (${d.probability_pct}%)`).join(' · ')}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* S5 — Khuyến nghị (Recommendations) */}
      {model.recommendations.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">5. Khuyến nghị (Recommendations)</h2>
          <ul className="pattern-list">
            {model.recommendations.map((rec, i) => (
              <li key={i}>{rec.text} <span className="muted" style={{ fontSize: 10 }}>(#{rec.lesionIdx})</span></li>
            ))}
          </ul>
        </section>
      )}

      {/* S6 — Phụ lục trích dẫn (Citations) */}
      {model.allCitations.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">6. Phụ lục trích dẫn (Citations)</h2>
          <ul style={{ fontSize: 11, paddingLeft: 16 }}>
            {model.allCitations.map((c, i) => (
              <li key={i} style={{ marginBottom: 3 }}>
                <strong>{c.label}</strong>
                {c.source_guideline && ` — ${c.source_guideline}`}
                {c.year && ` (${c.year})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Checklist — kept for completeness */}
    </>
  );
}

// ── Per-detection fallback card (used when MST model has no structured data) ─

export function DetectionPrintCard({ det, idx }: { det: Detection; idx: number }) {
  const sev = det.lesionReport?.conclusion?.severity;
  const sevStyle = sev ? SEVERITY[sev] : undefined;
  const r = det.lesionReport;
  return (
    <div className="detection-card">
      <div className="det-head">
        <span className="det-num">#{idx}</span>
        <span className="frame-ref">Frame {Math.round(det.timestamp * 30)} · {fmtTs(det.timestamp)}</span>
        {sevStyle && (
          <span className="badge" style={{
            backgroundColor: sevStyle.color + '20', color: sevStyle.color, borderColor: sevStyle.color + '40',
          }}>{sevStyle.emoji} {sevStyle.label}</span>
        )}
      </div>
      <div className="det-body">
        {det.frame_b64
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`data:image/jpeg;base64,${det.frame_b64}`} alt={det.label} className="det-thumb" />
          : <div className="det-thumb" />}
        <div className="det-info">
          <div className="pdx">{r?.conclusion?.primary_dx ?? det.label}</div>
          {r ? (
            <>
              <div><dt>Paris:</dt><dd>{r.description.paris_class}</dd></div>
              <div><dt>Kích thước:</dt><dd>{r.description.size_mm}</dd></div>
              <div><dt>Bề mặt:</dt><dd>{r.description.surface}</dd></div>
              <div><dt>Màu sắc:</dt><dd>{r.description.color}</dd></div>
              <div><dt>Bờ:</dt><dd>{r.description.margin}</dd></div>
              <div><dt>Mạch máu:</dt><dd>{r.description.vascular}</dd></div>
              <div><dt>AI confidence:</dt><dd>{r.conclusion.ai_confidence}%</dd></div>
            </>
          ) : (
            <>
              <div><dt>Label:</dt><dd>{det.label}</dd></div>
              <div><dt>Confidence:</dt><dd>{(det.confidence * 100).toFixed(0)}%</dd></div>
              <div><dt>Trạng thái:</dt><dd>{det.status ?? 'detected'}</dd></div>
              <div className="muted">(Chưa có phân tích AI cho tổn thương này)</div>
            </>
          )}
        </div>
      </div>
      {r && r.conclusion.recommendations.length > 0 && (
        <div className="det-recs">
          <div className="det-recs-title">Khuyến nghị</div>
          <ul>{r.conclusion.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// Re-export for print page
export { CATEGORY };
export type { Citation };
