'use client';

/**
 * /report/print/[sessionId] — MST-structured browser-print report (Phase 3).
 *
 * MST section order: Patient → Indication → Technique → Findings →
 * Impression → Recommendations → Citations → Signature → Footer.
 *
 * Auto-opens print dialog on mount. Patient context fetched from
 * GET /sessions/{id}/patient-context (best-effort; omitted when absent).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, Printer, X } from 'lucide-react';
import { useAnalysis, sessionFindings } from '@/context/AnalysisContext';
import { fmtDateTime as fmtDate } from '@/lib/format';
import { API_BASE } from '@/lib/ws-client';
import { buildMstModel } from '@/lib/mst-mapping';
import type { PatientContextData } from '@/components/session-summary/shared';
import { PatientBlock, MstSections } from './print-sections';

export default function PrintReportPage() {
  const params  = useParams<{ sessionId: string }>();
  const router  = useRouter();
  const { sessions } = useAnalysis();
  const session = useMemo(
    () => sessions.find((s) => s.id === params.sessionId),
    [sessions, params.sessionId],
  );
  const [patientCtx, setPatientCtx] = useState<PatientContextData | null>(null);
  const didAutoPrintRef = useRef(false);

  // Stamp generation time after mount (pure DOM write avoids react purity warnings).
  useEffect(() => {
    const el = document.getElementById('report-generated-at');
    if (el) el.textContent = fmtDate(Date.now());
  }, []);

  // Fetch patient context (best-effort — old sessions without it render fine).
  useEffect(() => {
    if (!params.sessionId) return;
    let cancelled = false;
    fetch(`${API_BASE}/sessions/${params.sessionId}/patient-context`)
      .then((r) => r.ok ? r.json() as Promise<PatientContextData> : null)
      .then((data) => { if (!cancelled && data && Object.keys(data).length) setPatientCtx(data); })
      .catch(() => {/* silent */});
    return () => { cancelled = true; };
  }, [params.sessionId]);

  // Auto-open print dialog once data is hydrated (single-fire guard for StrictMode).
  useEffect(() => {
    if (!session || didAutoPrintRef.current) return;
    didAutoPrintRef.current = true;
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

  const detections = sessionFindings(session);
  const mstModel   = buildMstModel(
    detections.map((d) => ({ lesionReport: d.lesionReport, frame_b64: d.frame_b64, label: d.label })),
    session.summary ?? null,
  );

  return (
    <div className="print-report">
      {/* On-screen toolbar — hidden in print */}
      <div className="screen-only toolbar">
        <button onClick={() => window.print()} className="btn primary">
          <Printer size={14} /> In / Lưu PDF
        </button>
        <button onClick={() => { window.close(); setTimeout(() => router.back(), 50); }} className="btn">
          <X size={14} /> Đóng
        </button>
      </div>

      {/* Header */}
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

      {/* Patient block — omitted when no context */}
      {patientCtx && <PatientBlock ctx={patientCtx} />}

      {/* MST sections 1–6 (or checklist fallback) */}
      {detections.length > 0 ? (
        <MstSections
          model={mstModel}
          detections={detections}
          sessionName={session.name}
          sessionSource={session.source}
          sessionStartedAt={session.startedAt}
          sessionId={session.id}
        />
      ) : (
        <section className="page-section">
          <h2 className="section-title">Phát hiện</h2>
          <p className="muted">Không có tổn thương nào được phát hiện trong phiên này.</p>
        </section>
      )}

      {/* Checklist from summary (supplementary) */}
      {session.summary?.checklist && session.summary.checklist.length > 0 && (
        <section className="page-section">
          <h2 className="section-title">Checklist hành động</h2>
          <table className="checklist-table">
            <thead><tr><th style={{ width: 120 }}>Phân loại</th><th>Hành động</th></tr></thead>
            <tbody>
              {session.summary.checklist.map((c, i) => (
                <tr key={i}>
                  <td><span className="cat-chip">
                    {{ sinh_thiet: 'Sinh thiết', test: 'Xét nghiệm', dieu_tri: 'Điều trị', tai_kham: 'Tái khám' }[c.category] ?? c.category}
                  </span></td>
                  <td>{c.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Doctor signature block */}
      <section className="page-section signature-block">
        <div className="sig-row">
          <div className="sig-col">
            <div className="sig-label">Bác sĩ thực hiện</div>
            <div className="sig-line" />
            <div className="sig-hint">Họ tên / ký tên</div>
          </div>
          <div className="sig-col">
            <div className="sig-label">Ngày ký</div>
            <div className="sig-line" />
            <div className="sig-hint">DD / MM / YYYY</div>
          </div>
          <div className="sig-col">
            <div className="sig-label">Xác nhận bởi</div>
            <div className="sig-line" />
            <div className="sig-hint">Trưởng khoa / duyệt</div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="report-footer">
        <div className="disclaimer">
          <AlertTriangle size={12} />
          Báo cáo do AI sinh tự động · Không thay thế đánh giá của bác sĩ chuyên khoa ·
          Mọi quyết định lâm sàng (sinh thiết, điều trị) phải do bác sĩ phê duyệt.
        </div>
        <div className="generated">
          Sinh ngày <span id="report-generated-at">…</span> · Powered by MedGemma (AI assist)
        </div>
      </footer>

      <style jsx global>{`
        @page { margin: 14mm 12mm; size: A4 portrait; }
        @media print {
          body { background: white !important; }
          .screen-only { display: none !important; }
          .page-section { break-inside: avoid; }
          .detection-card { break-inside: avoid; page-break-inside: avoid; }
          .signature-block { break-inside: avoid; margin-top: 32px; }
        }
        body { background: #F0F4F3; }
        .print-report {
          max-width: 800px; margin: 24px auto; padding: 36px 40px;
          background: white; color: #0D1B2A;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          font-size: 13px; line-height: 1.6;
          box-shadow: 0 6px 24px rgba(13,27,42,0.08); border-radius: 6px;
        }
        @media print { .print-report { box-shadow: none; max-width: 100%; margin: 0; padding: 0; border-radius: 0; } }
        .toolbar {
          position: sticky; top: 0; z-index: 10; display: flex; gap: 8px;
          margin-bottom: 18px; padding: 10px; background: #FAFCFB;
          border-radius: 8px; border: 1px solid #E2EAE8;
        }
        .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px;
          border: 1px solid #C8D8D6; background: white; border-radius: 7px; cursor: pointer;
          font-size: 13px; font-weight: 600; color: #006064; }
        .btn.primary { background: #006064; color: white; border-color: #006064; }
        .btn:hover { opacity: 0.92; }
        .report-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 16px; padding-bottom: 16px; border-bottom: 2px solid #006064;
        }
        .brand-name { font-size: 18px; font-weight: 800; color: #006064; letter-spacing: 0.04em; }
        .brand-sub  { font-size: 11px; color: #6B7280; margin-top: 2px; }
        .meta       { font-size: 11px; line-height: 1.7; color: #4B5563; text-align: right; }
        .meta code  { font-family: ui-monospace, monospace; background: #F0F4F3; padding: 1px 4px; border-radius: 3px; }
        .page-section { margin-top: 22px; }
        .section-title {
          font-size: 14px; font-weight: 800; color: #004D40;
          text-transform: uppercase; letter-spacing: 0.05em;
          padding-bottom: 4px; border-bottom: 1px solid #C8D8D6; margin-bottom: 10px;
        }
        .muted { color: #9AA5B1; font-style: italic; }
        .patient-block table { width: 100%; font-size: 12px; border-collapse: collapse; }
        .patient-table td { padding: 3px 8px; border-bottom: 1px solid #F0F4F3; }
        .pt-key { font-weight: 700; color: #4B5563; width: 200px; }
        .priority-list { padding-left: 0; counter-reset: pri; list-style: none; }
        .priority-item { counter-increment: pri; padding: 10px 12px; margin-bottom: 8px;
          background: #F8FAFB; border: 1px solid #E2EAE8; border-radius: 6px; }
        .priority-item::before { content: counter(pri) ". "; font-weight: 800; color: #006064; }
        .priority-head { display: inline-flex; gap: 8px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
        .badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px;
          border-radius: 4px; border: 1px solid; }
        .frame-ref { font-size: 10px; color: #6B7280; font-family: ui-monospace, monospace; }
        .priority-dx { font-weight: 700; font-size: 13px; color: #0D1B2A; }
        .priority-rationale { font-size: 12px; color: #4B5563; margin-top: 3px; }
        .pattern-list { padding-left: 18px; }
        .pattern-list li { margin-bottom: 4px; }
        .checklist-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .checklist-table th, .checklist-table td { border: 1px solid #C8D8D6; padding: 6px 10px; text-align: left; vertical-align: top; }
        .checklist-table th { background: #F0F4F3; font-weight: 700; font-size: 11px; }
        .cat-chip { display: inline-block; padding: 1px 7px; font-size: 10px;
          background: rgba(0,96,100,0.1); color: #006064; border-radius: 4px; font-weight: 700; }
        .detection-card { margin-bottom: 14px; border: 1px solid #E2EAE8; border-radius: 6px; overflow: hidden; background: white; }
        .det-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px;
          background: #F8FAFB; border-bottom: 1px solid #E2EAE8; flex-wrap: wrap; }
        .det-num  { font-weight: 800; color: #006064; min-width: 24px; }
        .det-body { display: grid; grid-template-columns: 140px 1fr; gap: 12px; padding: 12px; }
        .det-thumb { width: 140px; height: 105px; object-fit: cover; border-radius: 4px; background: #0D1117; }
        .det-info { font-size: 12px; }
        .det-info dt { font-weight: 700; color: #4B5563; display: inline-block; min-width: 88px; }
        .det-info dd { display: inline; margin-left: 4px; }
        .det-info > div { margin-bottom: 3px; }
        .det-info .pdx { font-weight: 800; font-size: 13px; color: #0D1B2A; margin-bottom: 6px; }
        .det-recs { padding: 0 12px 12px; font-size: 12px; }
        .det-recs-title { font-size: 10px; font-weight: 700; color: #4B5563; text-transform: uppercase; letter-spacing: 0.05em; margin: 8px 0 4px; }
        .det-recs ul { padding-left: 16px; margin: 0; }
        .det-recs li { margin-bottom: 2px; }
        .signature-block { border-top: 1px solid #C8D8D6; padding-top: 16px; }
        .sig-row { display: flex; gap: 32px; justify-content: space-around; }
        .sig-col { flex: 1; text-align: center; }
        .sig-label { font-size: 11px; font-weight: 700; color: #4B5563; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 36px; }
        .sig-line { border-bottom: 1px solid #0D1B2A; margin: 0 12px; }
        .sig-hint  { font-size: 9px; color: #9AA5B1; margin-top: 4px; }
        .report-footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #C8D8D6; font-size: 10px; color: #6B7280; text-align: center; }
        .disclaimer { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px;
          background: rgba(237,108,2,0.08); border: 1px solid rgba(237,108,2,0.2);
          border-radius: 6px; color: #8A4500; margin-bottom: 6px; }
        .generated { font-style: italic; }
      `}</style>
    </div>
  );
}
