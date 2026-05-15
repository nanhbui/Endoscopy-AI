'use client';

/**
 * /analytics — Phase E (replaces the empty /train placeholder).
 *
 * Aggregates from /analytics/overview rendered as KPI cards + 3 charts +
 * recent-sessions table. Single round-trip backend call keeps the page
 * snappy. No chart library — all viz is SVG + MUI primitives so we don't
 * pay a bundle hit for one dashboard.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, BarChart3, FileBarChart, Flag,
  MessageSquare, RefreshCw, ScanLine, Trash2,
} from 'lucide-react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import LinearProgress from '@mui/material/LinearProgress';
import MuiButton from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { API_BASE } from '@/lib/ws-client';

// ── Types matching backend payload ──────────────────────────────────────────

interface AnalyticsKpis {
  sessions: number;
  findings: number;
  summaries: number;
  false_positives: number;
  qa_messages: number;
}
interface RecentSession {
  session_id: string;
  n_findings: number;
  last_at: number;
  overall_risk: string | null;
}
interface FalsePositive {
  id: number;
  label: string;
  bbox: [number, number, number, number];
  reported_at: number;
  session_id_source: string;
  frame_b64?: string;  // cropped thumbnail, may be null for rows reported before v2
}
interface AnalyticsOverview {
  kpis: AnalyticsKpis;
  severity_dist: Record<string, number>;
  top_labels: { label: string; count: number }[];
  paris_dist: { class: string; count: number }[];
  recent_sessions: RecentSession[];
}

// Severity palette — kept in one place so charts and chips stay consistent.
const SEV_COLORS: Record<string, string> = {
  'thấp':       '#2E7D32',
  'trung bình': '#ED6C02',
  'cao':        '#D32F2F',
  '—':          '#9AA5B1',
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [fps, setFps] = useState<FalsePositive[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      // Two parallel fetches — both cheap, no point sequencing.
      const [overviewRes, fpRes] = await Promise.all([
        fetch(`${API_BASE}/analytics/overview`),
        fetch(`${API_BASE}/analytics/false-positives`),
      ]);
      if (!overviewRes.ok) throw new Error(`HTTP ${overviewRes.status}`);
      setData(await overviewRes.json() as AnalyticsOverview);
      if (fpRes.ok) {
        const fpData = await fpRes.json() as { items: FalsePositive[] };
        setFps(fpData.items);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const deleteFp = async (id: number) => {
    if (!confirm('Xoá entry này khỏi danh sách "case sai"?\nModel sẽ KHÔNG còn auto-skip vùng đó nữa.')) return;
    try {
      const res = await fetch(`${API_BASE}/analytics/false-positives/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Optimistic local removal + KPI decrement so UI feels instant.
      setFps((prev) => prev?.filter((f) => f.id !== id) ?? null);
      setData((prev) => prev ? {
        ...prev,
        kpis: { ...prev.kpis, false_positives: Math.max(0, prev.kpis.false_positives - 1) },
      } : prev);
    } catch (e) {
      alert(`Xoá thất bại: ${e}`);
    }
  };

  return (
    <Box sx={{ minHeight: 'calc(100vh - 130px)', py: 4, px: { xs: 2, lg: 4 }, backgroundColor: '#FAFCFB' }}>
      <Container maxWidth="lg">
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0D1B2A', display: 'flex', alignItems: 'center', gap: 1 }}>
              <BarChart3 size={24} color="#006064" /> Thống kê hệ thống
            </Typography>
            <Typography variant="caption" color="textSecondary">
              Tổng hợp dữ liệu từ tất cả phiên đã chạy
            </Typography>
          </Box>
          <MuiButton
            onClick={load} disabled={loading}
            startIcon={<RefreshCw size={14} className={loading ? 'spin' : ''} />}
            variant="outlined"
            sx={{ borderRadius: '10px', fontWeight: 700, borderColor: '#006064', color: '#006064', textTransform: 'none' }}
          >
            Làm mới
          </MuiButton>
        </Box>

        {err && (
          <Box sx={{ p: 1.5, mb: 2, borderRadius: '8px', backgroundColor: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', display: 'flex', alignItems: 'center', gap: 1 }}>
            <AlertTriangle size={14} color="#DC2626" />
            <Typography sx={{ fontSize: '0.82rem', color: '#7F1D1D' }}>Lỗi tải: {err}</Typography>
          </Box>
        )}

        {!data ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 6, justifyContent: 'center' }}>
            <CircularProgress size={22} sx={{ color: '#006064' }} />
            <Typography sx={{ color: '#006064', fontWeight: 600 }}>Đang tải thống kê…</Typography>
          </Box>
        ) : (
          <>
            {/* KPI grid */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' }, gap: 1.5, mb: 3 }}>
              <KpiCard icon={<ScanLine size={16} />}     label="Phiên đã chạy"   value={data.kpis.sessions} />
              <KpiCard icon={<Activity size={16} />}     label="Tổn thương"      value={data.kpis.findings} />
              <KpiCard icon={<FileBarChart size={16} />} label="Tổng hợp AI"     value={data.kpis.summaries} />
              <KpiCard icon={<AlertTriangle size={16} />} label="False positive" value={data.kpis.false_positives} accent="#D32F2F" />
              <KpiCard icon={<MessageSquare size={16} />} label="Tin nhắn Q&A"   value={data.kpis.qa_messages} />
            </Box>

            {/* Charts row 1: Severity pie + Top labels bars */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr' }, gap: 2, mb: 2.5 }}>
              <PanelCard title="Phân bố mức độ nghiêm trọng">
                <SeverityPie dist={data.severity_dist} />
              </PanelCard>
              <PanelCard title="Top label phát hiện nhiều nhất">
                <BarList
                  items={data.top_labels.map(l => ({ label: l.label, value: l.count }))}
                  emptyText="Chưa có tổn thương nào"
                  color="#006064"
                />
              </PanelCard>
            </Box>

            {/* Charts row 2: Paris distribution + Recent sessions */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr' }, gap: 2, mb: 2.5 }}>
              <PanelCard title="Phân bố Paris classification">
                <BarList
                  items={data.paris_dist.map(p => ({ label: p.class, value: p.count }))}
                  emptyText="Chưa có dữ liệu Paris"
                  color="#7C3AED"
                />
              </PanelCard>
              <PanelCard title="Phiên gần nhất">
                <RecentTable rows={data.recent_sessions} />
              </PanelCard>
            </Box>

            {/* False positives management — full-width panel below the charts */}
            <Box sx={{ mb: 2.5 }}>
              <PanelCard title={`Quản lý case sai (${fps?.length ?? 0})`}>
                <FalsePositivesTable items={fps} onDelete={deleteFp} />
              </PanelCard>
            </Box>

            <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', textAlign: 'center', mt: 2 }}>
              Dữ liệu lấy từ SQLite — cập nhật mỗi lần "Làm mới". Không bao gồm session chưa có lesion_report nào.
            </Typography>
          </>
        )}
      </Container>

      <style jsx global>{`
        .spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
      `}</style>
    </Box>
  );
}

// ── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, accent,
}: { icon: React.ReactNode; label: string; value: number; accent?: string }) {
  return (
    <Box sx={{
      p: 1.5, borderRadius: '10px', border: '1px solid #E2EAE8',
      backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(13,27,42,0.04)',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: accent ?? '#006064', mb: 0.5 }}>
        {icon}
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: accent ?? '#0D1B2A', lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  );
}

// ── Panel wrapper ───────────────────────────────────────────────────────────

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{
      p: 2, borderRadius: '12px', border: '1px solid #E2EAE8',
      backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(13,27,42,0.04)',
    }}>
      <Typography sx={{
        fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        pb: 1, mb: 1.5, borderBottom: '1px solid #E2EAE8',
      }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

// ── Severity pie — inline SVG, no dep ───────────────────────────────────────

function SeverityPie({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total === 0) {
    return (
      <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', textAlign: 'center', py: 3 }}>
        Chưa có dữ liệu
      </Typography>
    );
  }

  // SVG arc math: walk the perimeter accumulating angles, emit one path per slice.
  const R = 56, CX = 70, CY = 70;
  let cumulative = 0;
  const slices = entries.map(([key, val]) => {
    const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += val;
    const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    const x1 = CX + R * Math.cos(startAngle);
    const y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle);
    const y2 = CY + R * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    // Edge case: only one slice → draw full circle as 2 half-circles.
    const path = entries.length === 1
      ? `M ${CX - R} ${CY} A ${R} ${R} 0 1 1 ${CX + R} ${CY} A ${R} ${R} 0 1 1 ${CX - R} ${CY} Z`
      : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return { key, val, path, color: SEV_COLORS[key] ?? '#9AA5B1' };
  });

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth={1.5} />
        ))}
      </svg>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
        {slices.map((s) => (
          <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: s.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.78rem', color: 'text.primary', flex: 1 }}>
              {s.key}
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.primary' }}>
              {s.val} <Box component="span" sx={{ color: 'text.disabled', fontWeight: 500 }}>
                ({Math.round((s.val / total) * 100)}%)
              </Box>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ── Horizontal bar list — reuses MUI LinearProgress ─────────────────────────

function BarList({
  items, emptyText, color,
}: { items: { label: string; value: number }[]; emptyText: string; color: string }) {
  if (items.length === 0) {
    return (
      <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', textAlign: 'center', py: 3 }}>
        {emptyText}
      </Typography>
    );
  }
  const max = Math.max(...items.map(i => i.value));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((it, i) => (
        <Box key={i}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.primary', flex: 1, mr: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.label}
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color }}>
              {it.value}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={(it.value / max) * 100}
            sx={{
              height: 6, borderRadius: 3,
              backgroundColor: `${color}14`,
              '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 3 },
            }}
          />
        </Box>
      ))}
    </Box>
  );
}

// ── False positives table — list + delete ──────────────────────────────────

function FalsePositivesTable({
  items, onDelete,
}: { items: FalsePositive[] | null; onDelete: (id: number) => void }) {
  if (!items) return (
    <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', textAlign: 'center', py: 3 }}>
      Đang tải…
    </Typography>
  );
  if (items.length === 0) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, py: 3, color: 'text.disabled' }}>
      <Flag size={24} />
      <Typography sx={{ fontSize: '0.82rem', textAlign: 'center', maxWidth: 380 }}>
        Chưa có "case sai" nào. Bác sĩ bấm <strong>Báo sai</strong> trong workspace để
        đánh dấu detection nhầm — vùng đó sẽ auto-skip ở các phiên sau.
      </Typography>
    </Box>
  );

  const fmt = (ms: number) => new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  // Bbox xyxy → readable WxH @ position (rounded for display only).
  const fmtBbox = (b: [number, number, number, number]) =>
    `${Math.round(b[2] - b[0])}×${Math.round(b[3] - b[1])} px @ (${Math.round(b[0])}, ${Math.round(b[1])})`;

  return (
    <Box component="table" sx={{
      width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem',
      '& th': { textAlign: 'left', fontWeight: 700, fontSize: '0.7rem',
                color: 'text.secondary', textTransform: 'uppercase',
                letterSpacing: '0.05em', pb: 0.75, borderBottom: '1px solid #E2EAE8' },
      '& td': { py: 1, borderBottom: '1px solid #F0F4F3', verticalAlign: 'middle' },
      '& tr:last-child td': { borderBottom: 'none' },
    }}>
      <thead>
        <tr>
          <th style={{ width: 40 }}>#</th>
          <th style={{ width: 92 }}>Ảnh</th>
          <th>Label</th>
          <th>Vùng bbox</th>
          <th>Báo từ session</th>
          <th>Thời gian</th>
          <th style={{ width: 80, textAlign: 'right' }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {items.map((fp) => (
          <tr key={fp.id}>
            <td style={{ fontFamily: 'ui-monospace, monospace', color: '#6B7280' }}>{fp.id}</td>
            <td>
              {fp.frame_b64 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/jpeg;base64,${fp.frame_b64}`}
                  alt={fp.label}
                  style={{
                    width: 80, height: 56, objectFit: 'cover',
                    borderRadius: 4, border: '1px solid #E2EAE8', backgroundColor: '#0D1117',
                  }}
                />
              ) : (
                <Box sx={{
                  width: 80, height: 56, borderRadius: '4px',
                  border: '1px dashed #C8D8D6', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: 'text.disabled', fontSize: '0.62rem', textAlign: 'center', px: 0.5,
                }}>
                  Không có ảnh
                </Box>
              )}
            </td>
            <td>
              <Box component="span" sx={{
                display: 'inline-block', px: 0.75, py: 0.2, borderRadius: '4px',
                backgroundColor: 'rgba(220,38,38,0.08)', color: '#991B1B',
                fontSize: '0.74rem', fontWeight: 700,
              }}>{fp.label}</Box>
            </td>
            <td style={{ fontFamily: 'ui-monospace, monospace', color: '#4B5563', fontSize: '0.72rem' }}>
              {fmtBbox(fp.bbox)}
            </td>
            <td style={{ fontFamily: 'ui-monospace, monospace', color: '#6B7280', fontSize: '0.72rem' }}>
              {fp.session_id_source?.slice(0, 8) ?? '—'}
            </td>
            <td style={{ color: '#6B7280' }}>{fmt(fp.reported_at)}</td>
            <td style={{ textAlign: 'right' }}>
              <MuiButton
                onClick={() => onDelete(fp.id)}
                size="small"
                startIcon={<Trash2 size={12} />}
                sx={{
                  textTransform: 'none', fontSize: '0.72rem', fontWeight: 700,
                  color: '#DC2626', borderRadius: '6px', minWidth: 0,
                  px: 1, py: 0.25,
                  '&:hover': { backgroundColor: 'rgba(220,38,38,0.06)' },
                }}
              >
                Xoá
              </MuiButton>
            </td>
          </tr>
        ))}
      </tbody>
    </Box>
  );
}

// ── Recent sessions table ───────────────────────────────────────────────────

function RecentTable({ rows }: { rows: RecentSession[] }) {
  if (rows.length === 0) {
    return (
      <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', textAlign: 'center', py: 3 }}>
        Chưa có phiên nào
      </Typography>
    );
  }

  const fmt = (ms: number) => new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <Box component="table" sx={{
      width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem',
      '& th': { textAlign: 'left', fontWeight: 700, fontSize: '0.7rem',
                color: 'text.secondary', textTransform: 'uppercase',
                letterSpacing: '0.05em', pb: 0.75, borderBottom: '1px solid #E2EAE8' },
      '& td': { py: 0.75, borderBottom: '1px solid #F0F4F3', verticalAlign: 'middle' },
      '& tr:last-child td': { borderBottom: 'none' },
    }}>
      <thead>
        <tr>
          <th>Session</th><th>Findings</th><th>Risk</th><th>Thời gian</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.session_id}>
            <td>
              <Link href={`/report`} style={{ color: '#006064', textDecoration: 'none', fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>
                {r.session_id.slice(0, 8)}
              </Link>
            </td>
            <td>{r.n_findings}</td>
            <td>
              {r.overall_risk ? (
                <Box component="span" sx={{
                  display: 'inline-block', px: 1, py: 0.2, borderRadius: '4px',
                  fontSize: '0.7rem', fontWeight: 700,
                  color: SEV_COLORS[r.overall_risk] ?? '#9AA5B1',
                  backgroundColor: (SEV_COLORS[r.overall_risk] ?? '#9AA5B1') + '20',
                }}>{r.overall_risk}</Box>
              ) : (
                <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>—</Typography>
              )}
            </td>
            <td style={{ color: '#6B7280' }}>{fmt(r.last_at)}</td>
          </tr>
        ))}
      </tbody>
    </Box>
  );
}
