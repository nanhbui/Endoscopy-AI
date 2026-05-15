'use client';

/**
 * /report/print/[sessionId] — print-friendly full session report (Phase C4).
 *
 * Strategy: render a single long page that contains the AI summary + every
 * lesion report inline (with thumbnails). User hits Ctrl+P / Cmd+P → browser
 * "Save as PDF". This avoids server-side PDF generation deps (weasyprint,
 * reportlab) and gets perfect Vietnamese font rendering for free.
 *
 * The page auto-opens the print dialog on first render so the doctor doesn't
 * have to hunt for the shortcut.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, Printer, X } from 'lucide-react';
import { useAnalysis, type Detection } from '@/context/AnalysisContext';

// ── Severity → label/color mapping (kept inline to avoid component deps) ────

const SEVERITY = {
  'thấp':       { color: '#2E7D32', label: 'Thấp',       emoji: '🟢' },
  'trung bình': { color: '#ED6C02', label: 'Trung bình', emoji: '🟡' },
  'cao':        { color: '#D32F2F', label: 'Cao',        emoji: '🔴' },
} as const;

const CATEGORY = {
  sinh_thiet: 'Sinh thiết',
  test:       'Xét nghiệm',
  dieu_tri:   'Điều trị',
  tai_kham:   'Tái khám',
} as const;

// Format helpers — kept local since this page is self-contained.
function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtTs(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m} phút ${s} giây` : `${s} giây`;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function PrintReportPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const { sessions } = useAnalysis();
  const session = useMemo(
    () => sessions.find((s) => s.id === params.sessionId),
    [sessions, params.sessionId],
  );
  const didAutoPrintRef = useRef(false);

  // Auto-open browser print dialog once data is hydrated. Single-fire guard
  // because StrictMode in dev mounts twice.
  useEffect(() => {
    if (!session || didAutoPrintRef.current) return;
    didAutoPrintRef.current = true;
    // Slight delay so MUI/fonts finish rendering before print preview.
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [session]);

  if (!session) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
        <h2>Không tìm thấy phiên</h2>
        <p>Session id <code>{params.sessionId}</code> không tồn tại trong lịch sử.</p>
        <a href="/report">← Quay lại trang báo cáo</a>
      </div>
    );
  }

  const summary = session.summary;
  const detections = session.detections;
  const sevTotals = detections.reduce(
    (acc, d) => {
      const k = (d.lesionReport?.conclusion?.severity ?? '—') as string;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="print-report">
      {/* On-screen toolbar — hidden in print via CSS */}
      <div className="screen-only toolbar">
        <button onClick={() => window.print()} className="btn primary">
          <Printer size={14} /> In / Lưu PDF
        </button>
        {/* This page is opened in a fresh tab via window.open() so there's
            no history to navigate back to. window.close() succeeds on the
            tab the script opened; router.back() is the fallback if the
            user landed here directly via URL. */}
        <button
          onClick={() => {
            window.close();
            // If close failed (page wasn't script-opened), fall back to
            // browser back. Tiny delay so close() has a chance to actually
            // close before back() fires.
            setTimeout(() => router.back(), 50);
          }}
          className="btn"
        >
          <X size={14} /> Đóng
        </button>
      </div>

      {/* ── HEADER ── */}
      <header className="report-header">
        <div className="brand">
          <div className="brand-name">AI ENDOSCOPY SUITE</div>
          <div className="brand-sub">Hệ thống nội soi tiêu hóa hỗ trợ chẩn đoán AI</div>
        </div>
        <div className="meta">
          <div><strong>Phiên:</strong> {session.name}</div>
          <div><strong>Bắt đầu:</strong> {fmtDate(session.startedAt)}</div>
          <div><strong>Nguồn:</strong> {session.source}</div>
          <div><strong>Mã phiên:</strong> <code>{session.id}</code></div>
        </div>
      </header>

      {/* ── SECTION 1 — Overview ── */}
      <section className="page-section">
        <h2 className="section-title">1. Tổng quan phiên</h2>
        {summary ? (
          <>
            <div className="overall-risk" style={{
              borderLeftColor: SEVERITY[summary.overall_risk]?.color ?? '#9AA5B1',
              backgroundColor: (SEVERITY[summary.overall_risk]?.color ?? '#9AA5B1') + '14',
            }}>
              <div className="risk-label">Nguy cơ tổng thể</div>
              <div className="risk-value" style={{ color: SEVERITY[summary.overall_risk]?.color }}>
                {SEVERITY[summary.overall_risk]?.emoji} {SEVERITY[summary.overall_risk]?.label ?? summary.overall_risk}
              </div>
            </div>

            <div className="counts-grid">
              <div className="count-item">
                <div className="count-label">Tổng tổn thương</div>
                <div className="count-value">{summary.overview.total_findings}</div>
              </div>
              <div className="count-item">
                <div className="count-label">Đã xác nhận</div>
                <div className="count-value" style={{ color: '#2E7D32' }}>{summary.overview.confirmed_count}</div>
              </div>
              <div className="count-item">
                <div className="count-label">Bỏ qua / báo sai</div>
                <div className="count-value" style={{ color: '#9AA5B1' }}>{summary.overview.ignored_count}</div>
              </div>
              <div className="count-item">
                <div className="count-label">Thời lượng</div>
                <div className="count-value">{summary.overview.duration_seconds}s</div>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">Chưa có tổng hợp AI cho phiên này. Mở phiên trong workspace và đợi tổng hợp hoàn tất.</p>
        )}
      </section>

      {/* ── SECTION 2 — Priority findings ── */}
      {summary && summary.priority_findings.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">2. Phát hiện ưu tiên</h2>
          <ol className="priority-list">
            {summary.priority_findings.map((f, i) => (
              <li key={i} className="priority-item">
                <div className="priority-head">
                  <span className="badge" style={{
                    backgroundColor: SEVERITY[f.severity]?.color + '20',
                    color: SEVERITY[f.severity]?.color,
                    borderColor: SEVERITY[f.severity]?.color + '40',
                  }}>
                    {SEVERITY[f.severity]?.emoji} {SEVERITY[f.severity]?.label ?? f.severity}
                  </span>
                  <span className="frame-ref">Frame {f.frame_index}</span>
                </div>
                <div className="priority-dx">{f.primary_dx}</div>
                <div className="priority-rationale">{f.rationale}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── SECTION 3 — Patterns ── */}
      {summary && summary.patterns.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">3. Pattern xuyên suốt phiên</h2>
          <ul className="pattern-list">
            {summary.patterns.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </section>
      )}

      {/* ── SECTION 4 — Checklist ── */}
      {summary && summary.checklist.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">4. Checklist hành động</h2>
          <table className="checklist-table">
            <thead>
              <tr><th style={{ width: 120 }}>Phân loại</th><th>Hành động</th></tr>
            </thead>
            <tbody>
              {summary.checklist.map((c, i) => (
                <tr key={i}>
                  <td><span className="cat-chip">{CATEGORY[c.category] ?? c.category}</span></td>
                  <td>{c.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── SECTION 5 — All detection reports ── */}
      <section className="page-section">
        <h2 className="section-title">5. Chi tiết từng tổn thương ({detections.length})</h2>
        {Object.keys(sevTotals).length > 0 && (
          <p className="sev-summary">
            Tỷ lệ severity: {Object.entries(sevTotals).map(([k, n]) => `${k} (${n})`).join(' · ')}
          </p>
        )}
        {detections.length === 0 ? (
          <p className="muted">Không có tổn thương nào được phát hiện.</p>
        ) : (
          detections.map((det, idx) => <DetectionPrintCard key={idx} det={det} idx={idx + 1} />)
        )}
      </section>

      {/* ── DISCLAIMER FOOTER ── */}
      <footer className="report-footer">
        <div className="disclaimer">
          <AlertTriangle size={12} />
          Báo cáo do AI sinh tự động · Không thay thế đánh giá của bác sĩ chuyên khoa ·
          Mọi quyết định lâm sàng (sinh thiết, điều trị) phải do bác sĩ phê duyệt.
        </div>
        <div className="generated">
          Sinh ngày {fmtDate(Date.now())} · Powered by Qwen2.5-VL 7B
        </div>
      </footer>

      {/* ── Print stylesheet — kept inline so the route is self-contained ── */}
      <style jsx global>{`
        @page { margin: 14mm 12mm; size: A4 portrait; }
        @media print {
          body { background: white !important; }
          .screen-only { display: none !important; }
          .page-section { break-inside: avoid; }
          .detection-card { break-inside: avoid; page-break-inside: avoid; }
        }
        body { background: #F0F4F3; }
        .print-report {
          max-width: 800px;
          margin: 24px auto;
          padding: 36px 40px;
          background: white;
          color: #0D1B2A;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          font-size: 13px;
          line-height: 1.6;
          box-shadow: 0 6px 24px rgba(13,27,42,0.08);
          border-radius: 6px;
        }
        @media print {
          .print-report { box-shadow: none; max-width: 100%; margin: 0; padding: 0; border-radius: 0; }
        }

        .toolbar {
          position: sticky; top: 0; z-index: 10;
          display: flex; gap: 8px; margin-bottom: 18px;
          padding: 10px; background: #FAFCFB;
          border-radius: 8px; border: 1px solid #E2EAE8;
        }
        .btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 14px; border: 1px solid #C8D8D6; background: white;
          border-radius: 7px; cursor: pointer; font-size: 13px; font-weight: 600;
          color: #006064;
        }
        .btn.primary { background: #006064; color: white; border-color: #006064; }
        .btn:hover { opacity: 0.92; }

        .report-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 16px; padding-bottom: 16px;
          border-bottom: 2px solid #006064;
        }
        .brand-name {
          font-size: 18px; font-weight: 800; color: #006064; letter-spacing: 0.04em;
        }
        .brand-sub { font-size: 11px; color: #6B7280; margin-top: 2px; }
        .meta { font-size: 11px; line-height: 1.7; color: #4B5563; text-align: right; }
        .meta code { font-family: ui-monospace, monospace; background: #F0F4F3; padding: 1px 4px; border-radius: 3px; }

        .page-section { margin-top: 22px; }
        .section-title {
          font-size: 14px; font-weight: 800; color: #004D40;
          text-transform: uppercase; letter-spacing: 0.05em;
          padding-bottom: 4px; border-bottom: 1px solid #C8D8D6;
          margin-bottom: 10px;
        }
        .muted { color: #9AA5B1; font-style: italic; }

        .overall-risk {
          padding: 12px 16px; border-radius: 8px; border-left: 4px solid;
          margin-bottom: 10px;
        }
        .risk-label { font-size: 10px; font-weight: 700; color: #4B5563; text-transform: uppercase; letter-spacing: 0.06em; }
        .risk-value { font-size: 18px; font-weight: 800; margin-top: 2px; }

        .counts-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
        }
        .count-item {
          padding: 10px; background: #F8FAFB; border: 1px solid #E2EAE8; border-radius: 6px;
        }
        .count-label { font-size: 10px; color: #6B7280; font-weight: 600; }
        .count-value { font-size: 20px; font-weight: 800; color: #0D1B2A; line-height: 1.2; margin-top: 2px; }

        .priority-list { padding-left: 0; counter-reset: pri; list-style: none; }
        .priority-item {
          counter-increment: pri;
          padding: 10px 12px; margin-bottom: 8px;
          background: #F8FAFB; border: 1px solid #E2EAE8; border-radius: 6px;
        }
        .priority-item::before {
          content: counter(pri) ". "; font-weight: 800; color: #006064;
        }
        .priority-head { display: inline-flex; gap: 8px; align-items: center; margin-bottom: 4px; }
        .badge {
          display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px;
          border-radius: 4px; border: 1px solid;
        }
        .frame-ref { font-size: 10px; color: #6B7280; font-family: ui-monospace, monospace; }
        .priority-dx { font-weight: 700; font-size: 13px; color: #0D1B2A; }
        .priority-rationale { font-size: 12px; color: #4B5563; margin-top: 3px; }

        .pattern-list { padding-left: 18px; }
        .pattern-list li { margin-bottom: 4px; }

        .checklist-table {
          width: 100%; border-collapse: collapse; font-size: 12px;
        }
        .checklist-table th, .checklist-table td {
          border: 1px solid #C8D8D6; padding: 6px 10px; text-align: left;
          vertical-align: top;
        }
        .checklist-table th { background: #F0F4F3; font-weight: 700; font-size: 11px; }
        .cat-chip {
          display: inline-block; padding: 1px 7px; font-size: 10px;
          background: rgba(0,96,100,0.1); color: #006064;
          border-radius: 4px; font-weight: 700;
        }

        .sev-summary { font-size: 11px; color: #6B7280; margin: -4px 0 12px; }

        .detection-card {
          margin-bottom: 14px; border: 1px solid #E2EAE8; border-radius: 6px;
          overflow: hidden; background: white;
        }
        .det-head {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; background: #F8FAFB;
          border-bottom: 1px solid #E2EAE8;
        }
        .det-num {
          font-weight: 800; color: #006064; min-width: 24px;
        }
        .det-body { display: grid; grid-template-columns: 140px 1fr; gap: 12px; padding: 12px; }
        .det-thumb {
          width: 140px; height: 105px; object-fit: cover;
          border-radius: 4px; background: #0D1117;
        }
        .det-info { font-size: 12px; }
        .det-info dt { font-weight: 700; color: #4B5563; display: inline-block; min-width: 88px; }
        .det-info dd { display: inline; margin-left: 4px; }
        .det-info > div { margin-bottom: 3px; }
        .det-info .pdx { font-weight: 800; font-size: 13px; color: #0D1B2A; margin-bottom: 6px; }

        .det-recs { padding: 0 12px 12px; font-size: 12px; }
        .det-recs-title {
          font-size: 10px; font-weight: 700; color: #4B5563;
          text-transform: uppercase; letter-spacing: 0.05em; margin: 8px 0 4px;
        }
        .det-recs ul { padding-left: 16px; margin: 0; }
        .det-recs li { margin-bottom: 2px; }

        .report-footer {
          margin-top: 28px; padding-top: 14px;
          border-top: 1px solid #C8D8D6;
          font-size: 10px; color: #6B7280; text-align: center;
        }
        .disclaimer {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 10px; background: rgba(237,108,2,0.08);
          border: 1px solid rgba(237,108,2,0.2); border-radius: 6px;
          color: #8A4500; margin-bottom: 6px;
        }
        .generated { font-style: italic; }
      `}</style>
    </div>
  );
}

// ── DetectionPrintCard ──────────────────────────────────────────────────────

function DetectionPrintCard({ det, idx }: { det: Detection; idx: number }) {
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
            backgroundColor: sevStyle.color + '20',
            color: sevStyle.color,
            borderColor: sevStyle.color + '40',
          }}>{sevStyle.emoji} {sevStyle.label}</span>
        )}
      </div>
      <div className="det-body">
        {det.frame_b64 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`data:image/jpeg;base64,${det.frame_b64}`} alt={det.label} className="det-thumb" />
        ) : (
          <div className="det-thumb" />
        )}
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
