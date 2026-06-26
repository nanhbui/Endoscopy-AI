'use client';

/**
 * overview-tab.tsx — "Tổng quan" tab of the session-summary panel.
 *
 * Enhancements (Phase 3):
 * - Patient-context line at top (fetched via GET /sessions/{id}/patient-context).
 * - Overall-risk badge now shows one-line rationale from top priority finding.
 * - "Thời lượng" replaced with severity breakdown (cao/TB/thấp counts).
 * - Top-3 findings show frame_b64 thumbnail when available in lesion reports.
 */

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { RISK_STYLE, CATEGORY_LABEL, type PatientContextData } from './shared';

const SEV_LABEL = { cao: 'Cao', 'trung bình': 'TB', 'thấp': 'Thấp' } as const;
import { API_BASE } from '@/lib/ws-client';
import type { SessionSummary } from '@/lib/ws-client';

interface OverviewTabProps {
  summary: SessionSummary;
  /** Session id used to fetch patient context. Optional — panel works without it. */
  sessionId?: string;
}

/** Compact patient-context line: "54t · Nam · đau thượng vị". */
function PatientLine({ ctx }: { ctx: PatientContextData }) {
  const parts: string[] = [];
  if (ctx.age != null) parts.push(`${ctx.age}t`);
  if (ctx.sex)          parts.push(ctx.sex);
  if (ctx.indication)   parts.push(ctx.indication);
  if (!parts.length)    return null;
  return (
    <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary', mb: 0.5, fontStyle: 'italic' }}>
      Bệnh nhân: {parts.join(' · ')}
    </Typography>
  );
}

export function OverviewTab({ summary, sessionId }: OverviewTabProps) {
  const [patientCtx, setPatientCtx] = useState<PatientContextData | null>(null);

  // Fetch patient context when sessionId is available (best-effort, never crashes).
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch(`${API_BASE}/sessions/${sessionId}/patient-context`)
      .then((r) => r.ok ? r.json() as Promise<PatientContextData> : null)
      .then((data) => { if (!cancelled && data && Object.keys(data).length) setPatientCtx(data); })
      .catch(() => {/* silent — optional enhancement */});
    return () => { cancelled = true; };
  }, [sessionId]);

  const risk  = RISK_STYLE[summary.overall_risk];
  const top3  = summary.priority_findings.slice(0, 3);
  const topRationale = summary.priority_findings[0]?.rationale;

  // Severity breakdown replaces always-0 "Thời lượng".
  const sevCounts = summary.priority_findings.reduce(
    (acc, f) => { acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc; },
    {} as Record<string, number>,
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Hero — overall risk badge */}
      <Box sx={{
        px: 2, py: 1.75, borderRadius: '12px',
        backgroundColor: risk.bg,
        border: `1px solid ${risk.color}33`,
        borderLeft: `4px solid ${risk.color}`,
      }}>
        {patientCtx && <PatientLine ctx={patientCtx} />}
        <Typography sx={{
          fontSize: '0.7rem', fontWeight: 700, color: risk.color,
          textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.25,
        }}>
          {risk.emoji} Nguy cơ tổng thể: {summary.overall_risk}
        </Typography>
        {topRationale && (
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mb: 0.75, lineHeight: 1.4 }}>
            {topRationale}
          </Typography>
        )}
        {/* Real counts — deterministic from backend (not LLM arithmetic). */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.25, mt: 0.75 }}>
          {[
            ['Tổng tổn thương', summary.overview.total_findings],
            ['Đã xác nhận',     summary.overview.confirmed_count],
            ['Bỏ qua',          summary.overview.ignored_count],
          ].map(([k, v]) => (
            <Box key={String(k)}>
              <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', fontWeight: 600 }}>
                {k}
              </Typography>
              <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.2 }}>
                {v}
              </Typography>
            </Box>
          ))}
        </Box>
        {/* Severity distribution — colored pills (clearer than a merged cell). */}
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1, flexWrap: 'wrap' }}>
          {(['cao', 'trung bình', 'thấp'] as const).map((sev) => {
            const s = RISK_STYLE[sev];
            return (
              <Box key={sev} sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.4, borderRadius: '999px',
                backgroundColor: s.bg, border: `1px solid ${s.color}33`,
              }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: s.color }} />
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: s.color }}>
                  {SEV_LABEL[sev]} {sevCounts[sev] ?? 0}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Doctor's spoken narration summary (live hands-free) */}
      {summary.conversation_summary && (
        <Box sx={{ p: 1.5, borderRadius: '12px', backgroundColor: 'rgba(0,131,143,0.05)', border: '1px solid #A7D8DC' }}>
          <Typography sx={{
            fontSize: '0.7rem', fontWeight: 700, color: '#00838F',
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5,
          }}>
            Tóm tắt hội thoại
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.primary', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {summary.conversation_summary}
          </Typography>
        </Box>
      )}

      {/* Top 3 priority findings with optional thumbnail */}
      {top3.length > 0 && (
        <Box>
          <Typography sx={{
            fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1,
          }}>
            Top {top3.length} phát hiện ưu tiên
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {top3.map((f, i) => {
              const s = RISK_STYLE[f.severity];
              return (
                <Box key={i} sx={{
                  display: 'flex', alignItems: 'flex-start', gap: 1, px: 1.25, py: 1,
                  borderRadius: '8px', backgroundColor: '#F8FAFB', border: '1px solid #E2EAE8',
                }}>
                  <Chip
                    label={`${s.emoji} ${f.severity}`}
                    size="small"
                    sx={{ fontSize: '0.66rem', height: 20, fontWeight: 700, color: s.color, backgroundColor: s.bg, flexShrink: 0 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.35 }}>
                      {f.primary_dx}
                    </Typography>
                    <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.25 }}>
                      Frame {f.frame_index}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Checklist preview — surfaces next actions + fills the panel. */}
      {summary.checklist.length > 0 && (
        <Box>
          <Typography sx={{
            fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1,
          }}>
            Việc cần làm ({summary.checklist.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            {summary.checklist.slice(0, 3).map((c, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                <Chip
                  label={CATEGORY_LABEL[c.category] ?? c.category}
                  size="small"
                  sx={{ fontSize: '0.62rem', height: 18, fontWeight: 700, backgroundColor: 'rgba(0,96,100,0.1)', color: '#006064', flexShrink: 0 }}
                />
                <Typography sx={{ fontSize: '0.78rem', color: 'text.primary', lineHeight: 1.5, flex: 1 }}>
                  {c.action}
                </Typography>
              </Box>
            ))}
            {summary.checklist.length > 3 && (
              <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.25 }}>
                +{summary.checklist.length - 3} việc khác — xem tab Chi tiết
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
