'use client';

/**
 * Dashboard / route — ported from new-theme/dashboard.jsx.
 *
 * Drops MUI for this page; everything is inline styles + tokens so the
 * visual identity matches new-theme/endoscopy faithfully. Real data
 * comes from useAnalysis() (sessions list + isPlaying); KPI numbers
 * fall back to derived counts when the /analytics endpoint is missing.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Activity, ArrowRight, Brain, ChevronRight, FileBarChart, Mic,
  Play, Radio, ScanSearch, Sparkles, UploadCloud,
} from 'lucide-react';
import { useAnalysis } from '@/context/AnalysisContext';
import { API_BASE } from '@/lib/ws-client';
import { C, HERO_GRADIENT } from '@/lib/ui-tokens';
import { PipelineGraphSection as GstPipelineGraph } from '@/components/pipeline-graph-section';

// ── KPI overview type — mirrors /analytics/overview when available ──────────
// We tolerate the endpoint being missing (Phase E hasn't landed yet on this
// branch) and fall back to whatever we can derive from sessions[].
interface OverviewResp {
  kpis?: {
    sessions?: number;
    findings?: number;
    summaries?: number;
    false_positives?: number;
  };
}

const SOURCE_LABEL: Record<string, { txt: string; icon: React.ReactNode }> = {
  upload:  { txt: 'Tải lên',    icon: <UploadCloud size={11} /> },
  live:    { txt: 'Trực tiếp',  icon: <Radio       size={11} /> },
  library: { txt: 'Thư viện',   icon: <FileBarChart size={11} /> },
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  const { sessions, isPlaying } = useAnalysis();
  const [overview, setOverview] = useState<OverviewResp['kpis'] | null>(null);

  // Pull analytics overview to back the hero stats; if endpoint not yet
  // deployed (404), we derive counts from local sessions list.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/analytics/overview`);
        if (res.ok) {
          const data: OverviewResp = await res.json();
          if (data.kpis) setOverview(data.kpis);
        }
      } catch {
        // network down — derived stats kick in below
      }
    })();
  }, []);

  // Derived from sessions[] — used when /analytics isn't available.
  const totalFindings = sessions.reduce((s, sess) => s + sess.detections.length, 0);
  // Confirmed = detections the doctor accepted (confirmed or analyzed). A real,
  // derivable figure — replaces the old hardcoded "91.4% accuracy" placeholder
  // which was never sourced from the backend.
  const totalConfirmed = sessions.reduce(
    (s, sess) => s + sess.detections.filter((d) => d.status === 'confirmed' || d.status === 'analyzed').length,
    0,
  );
  const heroStats = {
    sessions: overview?.sessions ?? sessions.length,
    findings: overview?.findings ?? totalFindings,
    confirmed: totalConfirmed,
  };

  const recentSessions = sessions.slice(0, 6);
  const currentSession = sessions[0];

  return (
    <div className="theme-fade-up" style={{ minHeight: 'calc(100vh - 64px)' }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <Hero stats={heroStats} hasSessions={sessions.length > 0} />

      <div
        className="dash-inner"
        style={{
          maxWidth: 1440, margin: '0 auto',
          padding: '40px 24px 80px',
          display: 'flex', flexDirection: 'column', gap: 32,
        }}
      >
        <FeatureRow />
        {currentSession && <CurrentSessionPanel session={currentSession} isPlaying={isPlaying} />}
        <SessionsPreview rows={recentSessions} hasMore={sessions.length > recentSessions.length} />

        {/* Real GStreamer DOT graph from backend — restored from the original
            page. The earlier rewrite replaced it with a static 7-node
            conceptual flow which isn't useful for inspecting the live pipeline. */}
        <GstPipelineGraph />
      </div>

      {/* Mobile padding overrides — keeps the hero from looking absurdly
          tall on a phone, and trims the content gutter so cards aren't
          half-cropped at the edges. */}
      <style jsx global>{`
        @media (max-width: 720px) {
          .hero-inner { padding: 36px 16px 28px !important; }
          .dash-inner { padding: 24px 16px 56px !important; gap: 20px !important; }
        }
        @media (max-width: 520px) {
          .hero-inner { padding: 28px 14px 24px !important; }
          .dash-inner { padding: 20px 12px 48px !important; }
        }
      `}</style>
    </div>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero({
  stats, hasSessions,
}: {
  stats: { sessions: number; findings: number; confirmed: number };
  hasSessions: boolean;
}) {
  return (
    <div
      style={{
        background: HERO_GRADIENT,
        color: 'white',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative radial glows */}
      <div
        style={{
          position: 'absolute', top: -200, right: -200, width: 600, height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.12), transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute', bottom: -100, left: '40%', width: 400, height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,131,143,0.4), transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div
        className="hero-inner"
        style={{
          position: 'relative',
          maxWidth: 1440, margin: '0 auto',
          padding: '64px 24px 56px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 48, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 480px', maxWidth: 720 }}>
            <div
              style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
                opacity: 0.7, marginBottom: 16,
              }}
            >
              HỆ THỐNG PHÂN TÍCH NỘI SOI THÔNG MINH
            </div>
            <h1 className="theme-h-display" style={{ margin: 0, color: 'white' }}>
              Phát hiện tổn thương real-time,
              <br />
              <span style={{ color: C.teal100 }}>
                phân tích &amp; báo cáo bằng AI.
              </span>
            </h1>
            <p
              style={{
                marginTop: 20, fontSize: 16, lineHeight: 1.6,
                color: 'rgba(255,255,255,0.78)', maxWidth: 580,
              }}
            >
              YOLO + Whisper + LLM phối hợp dừng video tại điểm phát hiện, đọc nhãn
              lâm sàng, chờ bác sĩ xác nhận bằng lời. Không cần rời tay khỏi endoscope.
            </p>

            <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link
                href="/workspace"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'white', color: C.teal700,
                  padding: '12px 20px', fontSize: 14, fontWeight: 600,
                  borderRadius: 'var(--r-md)', textDecoration: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.20)',
                  transition: 'transform var(--dur-fast)',
                }}
              >
                <Play size={14} /> Bắt đầu phiên mới
              </Link>
              {hasSessions && (
                <Link
                  href="/report"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    color: 'white', borderColor: 'rgba(255,255,255,0.32)',
                    border: '1px solid rgba(255,255,255,0.32)',
                    padding: '12px 20px', fontSize: 14,
                    borderRadius: 'var(--r-md)', textDecoration: 'none',
                  }}
                >
                  Xem báo cáo gần đây <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </div>

          {/* Hero stats — 3 KPIs in a glass card. Auto-fit lets the tiles
              stack into a single column on mobile when there's no horizontal room. */}
          <div style={{ flex: '1 1 280px', maxWidth: 460, width: '100%' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: 1,
                background: 'rgba(255,255,255,0.12)',
                borderRadius: 'var(--r-xl)',
                overflow: 'hidden',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.16)',
              }}
            >
              {[
                { v: stats.sessions.toLocaleString(),  l: 'Phiên đã phân tích',  sub: sessionCountCopy(stats.sessions) },
                { v: stats.findings.toLocaleString(), l: 'Tổn thương phát hiện', sub: 'theo dõi toàn bộ' },
                { v: stats.confirmed.toLocaleString(), l: 'Tổn thương đã xác nhận', sub: 'bác sĩ đã duyệt' },
              ].map((s) => (
                <div key={s.l} style={{ padding: '24px 20px', background: 'rgba(0,40,42,0.35)' }}>
                  <div
                    style={{
                      fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {s.v}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                    {s.l}
                  </div>
                  <div style={{ fontSize: 11, color: C.teal100, marginTop: 8 }}>
                    {s.sub}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// "có N phiên" copy fragment for the sub-line under hero stat #1.
function sessionCountCopy(n: number) {
  return n === 0 ? 'chưa có phiên nào' : `${n.toLocaleString()} phiên đã ghi`;
}

// ── Feature row — 4 cards summarising workflow capabilities ─────────────────

const FEATURES = [
  {
    title: 'Phân tích Real-time',
    body:  'Pipeline GStreamer + YOLOv8 + StrongSORT dừng video chính xác tại frame có tổn thương.',
    icon:  Activity, color: 'var(--st-analyzed)',
  },
  {
    title: 'Smart Ignore & Memory',
    body:  'Backend SQLite ghi nhớ false-positive cross-session; vùng đã báo sai sẽ tự skip ở phiên sau.',
    icon:  Brain, color: C.teal600,
  },
  {
    title: 'Trợ lý LLM y khoa',
    body:  'MedGemma-4B sinh báo cáo 3 phần (Kỹ thuật / Mô tả / Kết luận) theo schema JSON.',
    icon:  Sparkles, color: 'var(--st-processing)',
  },
  {
    title: 'Voice-first',
    body:  'Whisper-VI + intent classifier — bác sĩ điều khiển bằng "bỏ qua / giải thích / xác nhận".',
    icon:  Mic, color: 'var(--st-confirmed)',
  },
];

function FeatureRow() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 16,
      }}
    >
      {FEATURES.map((f) => (
        <div
          key={f.title}
          className="theme-fade-up"
          style={{
            background: C.bgPaper,
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--r-xl)',
            boxShadow: C.shadowSm,
            padding: 24,
          }}
        >
          <div
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: `${f.color}14`, color: f.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <f.icon size={18} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{f.title}</div>
          <div style={{ fontSize: 13, color: C.neutral600, lineHeight: 1.6 }}>
            {f.body}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Current session card — only shown when there's an active session ───────

function CurrentSessionPanel({
  session, isPlaying,
}: {
  session: ReturnType<typeof useAnalysis>['sessions'][number];
  isPlaying: boolean;
}) {
  const n = session.detections.length;
  const confirmed = session.detections.filter(
    (d) => d.status === 'confirmed' || d.status === 'analyzed',
  ).length;
  const avgConf = n > 0
    ? Math.round(session.detections.reduce((s, d) => s + d.confidence, 0) / n * 100)
    : 0;

  const startTs = new Date(session.startedAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      style={{
        background: C.bgPaper,
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--r-xl)',
        boxShadow: C.shadowSm,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="theme-eyebrow">PHIÊN ĐANG HOẠT ĐỘNG</div>
          <h2 className="theme-h-h2" style={{ margin: '4px 0 0' }}>
            {session.name}
          </h2>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 'var(--r-pill)',
            background: isPlaying ? 'rgba(2,119,189,0.08)' : 'rgba(154,165,177,0.10)',
            border: `1px solid ${isPlaying ? 'rgba(2,119,189,0.25)' : 'var(--border-default)'}`,
            color: isPlaying ? 'var(--st-analyzed)' : C.neutral500,
            fontSize: 12, fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'currentColor',
              animation: isPlaying ? 'themePulseRing 2s var(--ease-out) infinite' : 'none',
            }}
          />
          {isPlaying ? 'Đang phân tích' : 'Đã dừng'}
        </div>
        <Link
          href="/workspace"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: C.teal600, color: 'white',
            padding: '8px 14px', fontSize: 13, fontWeight: 550,
            borderRadius: 'var(--r-md)', textDecoration: 'none',
          }}
        >
          Mở Workspace <ArrowRight size={14} />
        </Link>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1, background: C.borderSubtle,
        }}
      >
        <StatCell label="Bắt đầu" value={startTs} mono />
        <StatCell label="Phát hiện" value={String(n)} mono />
        <StatCell label="Đã xác nhận" value={String(confirmed)} mono />
        <StatCell
          label="Độ tin cậy TB"
          value={n > 0 ? `${avgConf}%` : '—'}
          mono
        />
      </div>
    </div>
  );
}

function StatCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ padding: '20px 24px', background: C.bgPaper }}>
      <div className="theme-eyebrow" style={{ fontSize: 11 }}>{label}</div>
      <div
        style={{
          fontSize: 22, fontWeight: 700, marginTop: 4, letterSpacing: '-0.01em',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          color: C.neutral800,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Sessions preview — list of recent sessions ─────────────────────────────

function SessionsPreview({
  rows, hasMore,
}: {
  rows: ReturnType<typeof useAnalysis>['sessions'];
  hasMore: boolean;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 16 }}>
        <h2 className="theme-h-h2" style={{ margin: 0 }}>Phiên gần đây</h2>
        <Link
          href="/report"
          style={{
            marginLeft: 'auto', fontSize: 13, color: C.teal600,
            fontWeight: 550, textDecoration: 'none', display: 'inline-flex',
            alignItems: 'center', gap: 4,
          }}
        >
          Tất cả báo cáo <ArrowRight size={12} />
        </Link>
      </div>

      <div
        style={{
          background: C.bgPaper,
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--r-xl)',
          boxShadow: C.shadowSm,
          overflow: 'hidden',
        }}
      >
        {rows.length === 0 ? (
          <div
            style={{
              padding: '48px 24px', textAlign: 'center',
              color: C.neutral500,
            }}
          >
            <ScanSearch size={28} style={{ marginBottom: 8, color: C.neutral300 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Chưa có phiên nào</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Tải video lên ở Workspace để bắt đầu phân tích đầu tiên.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.bgSubtle }}>
                {['Phiên', 'Tên', 'Thời gian', 'Phát hiện', 'Nguồn', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left', padding: '10px 16px',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                      textTransform: 'uppercase', color: C.neutral500,
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr
                  key={s.id}
                  style={{
                    borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                  }}
                >
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {s.id.slice(0, 12)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 550 }}>{s.name}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: C.neutral500, fontSize: 12 }}>
                      {new Date(s.startedAt).toLocaleString('vi-VN', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {s.detections.length > 0 ? (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                        {s.detections.length}
                      </span>
                    ) : (
                      <span style={{ color: C.neutral400 }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span
                      className="theme-chip theme-chip--ignored"
                      style={{ background: C.bgSubtle, color: C.neutral600 }}
                    >
                      {SOURCE_LABEL[s.source]?.icon}
                      {SOURCE_LABEL[s.source]?.txt ?? s.source}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <Link
                      href="/report"
                      aria-label="Mở chi tiết"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, borderRadius: 'var(--r-sm)',
                        color: C.neutral500, textDecoration: 'none',
                      }}
                    >
                      <ChevronRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {hasMore && (
          <div
            style={{
              padding: '12px 24px',
              borderTop: '1px solid var(--border-subtle)',
              background: C.bgSubtle,
              fontSize: 12, color: C.neutral500, textAlign: 'center',
            }}
          >
            Hiển thị {rows.length} phiên gần nhất —{' '}
            <Link href="/report" style={{ color: C.teal600, fontWeight: 600 }}>
              xem tất cả
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

const tdStyle: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: 13,
  color: C.neutral700,
  verticalAlign: 'middle',
};

