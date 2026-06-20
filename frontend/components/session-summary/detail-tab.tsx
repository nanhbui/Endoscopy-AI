'use client';

/**
 * detail-tab.tsx — "Chi tiết" tab of the session-summary panel.
 *
 * Phase 3 enhancements:
 * - Renders summary.citations as small MUI chips near findings/checklist.
 * - Citation chips show label (e.g. "[Paris 2002]") in teal.
 * - Backward compatible: no citations → renders as before.
 */

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { ChevronRight } from 'lucide-react';
import { RISK_STYLE, CATEGORY_LABEL } from './shared';
import type { SessionSummary, Citation } from '@/lib/ws-client';

interface DetailTabProps {
  summary: SessionSummary;
}

/** Small chip for a single guideline citation. */
function CitationChip({ citation }: { citation: Citation }) {
  const label = citation.year ? `${citation.label} ${citation.year}` : citation.label;
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        fontSize: '0.6rem', height: 17, fontWeight: 700,
        backgroundColor: 'rgba(0,96,100,0.08)', color: '#006064',
        border: '1px solid rgba(0,96,100,0.2)', borderRadius: '4px',
      }}
    />
  );
}

/** Row of citation chips — renders nothing when citations is empty/absent. */
function CitationRow({ citations }: { citations?: Citation[] }) {
  if (!citations?.length) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, mt: 0.5 }}>
      {citations.map((c, i) => <CitationChip key={i} citation={c} />)}
    </Box>
  );
}

export function DetailTab({ summary }: DetailTabProps) {
  const citations = summary.citations ?? [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* All priority findings */}
      {summary.priority_findings.length > 0 && (
        <Box>
          <Typography sx={{
            fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1,
          }}>
            Tất cả phát hiện ưu tiên ({summary.priority_findings.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {summary.priority_findings.map((f, i) => {
              const s = RISK_STYLE[f.severity];
              return (
                <Box key={i} sx={{
                  display: 'flex', gap: 1, px: 1.25, py: 1,
                  borderRadius: '8px', backgroundColor: '#F8FAFB', border: '1px solid #E2EAE8',
                }}>
                  <Box sx={{ width: 3, backgroundColor: s.color, borderRadius: 1, flexShrink: 0 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                      <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: s.color }}>
                        {s.emoji} {f.severity}
                      </Typography>
                      <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', fontFamily: 'monospace' }}>
                        frame {f.frame_index}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary' }}>
                      {f.primary_dx}
                    </Typography>
                    <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary', mt: 0.25, lineHeight: 1.5 }}>
                      {f.rationale}
                    </Typography>
                    {/* Inline citation chips per finding (from summary-level citations) */}
                    <CitationRow citations={citations} />
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Patterns */}
      {summary.patterns.length > 0 && (
        <Box>
          <Typography sx={{
            fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1,
          }}>
            Pattern xuyên suốt
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {summary.patterns.map((p, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                <ChevronRight size={14} style={{ marginTop: 3, flexShrink: 0, color: '#006064' }} />
                <Typography sx={{ fontSize: '0.8rem', color: 'text.primary', lineHeight: 1.5 }}>
                  {p}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Checklist by category */}
      {summary.checklist.length > 0 && (
        <Box>
          <Typography sx={{
            fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1,
          }}>
            Checklist hành động
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            {summary.checklist.map((c, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <Chip
                  label={CATEGORY_LABEL[c.category]}
                  size="small"
                  sx={{
                    fontSize: '0.62rem', height: 18, fontWeight: 700,
                    backgroundColor: 'rgba(0,96,100,0.1)', color: '#006064', flexShrink: 0,
                  }}
                />
                <Typography sx={{ fontSize: '0.8rem', color: 'text.primary', lineHeight: 1.5, flex: 1 }}>
                  {c.action}
                </Typography>
                {/* Citation chips beside each checklist item */}
                <CitationRow citations={citations} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Citations summary block (shown only when citations present) */}
      {citations.length > 0 && (
        <Box>
          <Typography sx={{
            fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary',
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.75,
          }}>
            Trích dẫn hướng dẫn
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {citations.map((c, i) => <CitationChip key={i} citation={c} />)}
          </Box>
        </Box>
      )}
    </Box>
  );
}
