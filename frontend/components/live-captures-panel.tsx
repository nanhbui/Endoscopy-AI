'use client';

/**
 * live-captures-panel.tsx — right-hand panel for the Trực tiếp (live) flow.
 *
 * Every time the live detector flags a lesion, BrowserCaptureLive snapshots the
 * frame and appends a LiveCapture here (newest first); in parallel it calls the
 * VLM (/live/explain) and fills in `report`. Each card shows the thumbnail, a
 * compact LLM conclusion, and a "Xem chi tiết / Thu gọn" toggle that expands the
 * full structured LesionReportCard.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { Image as ImageIcon, Sparkles, X, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { LesionReport } from '@/lib/ws-client';
import { LesionReportCard } from '@/components/lesion-report-card';

export interface LiveCapture {
  id: number;
  frameB64: string;          // jpeg base64 (no data: prefix) — thumbnail + report image
  label: string;
  confidence: number;
  ts: number;                // capture time, ms epoch
  report: LesionReport | null;
  explaining: boolean;       // VLM call in flight
  error?: string;
}

const sevColor = (s?: string) =>
  s === 'cao' ? '#DC2626' : s === 'trung bình' ? '#D97706' : '#059669';

function CaptureCard({ c, onRemove }: { c: LiveCapture; onRemove?: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ borderRadius: '12px', border: '1px solid #ECF1F0', overflow: 'hidden' }}>
      <Box sx={{ position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/jpeg;base64,${c.frameB64}`} alt={c.label} style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'cover' }} />
        <Box sx={{ position: 'absolute', bottom: 6, left: 6, px: 0.8, py: 0.25, borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '0.68rem', fontWeight: 700 }}>
          {c.label} {(c.confidence * 100).toFixed(0)}%
        </Box>
        {onRemove && (
          <Box component="button" onClick={() => onRemove(c.id)}
            sx={{ position: 'absolute', top: 6, right: 6, p: 0.4, borderRadius: '6px', border: 'none', cursor: 'pointer', backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff', display: 'inline-flex', '&:hover': { backgroundColor: 'rgba(220,38,38,0.85)' } }}>
            <X size={13} />
          </Box>
        )}
      </Box>

      <Box sx={{ px: 1.25, py: 1 }}>
        {c.explaining ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
            <CircularProgress size={13} /> <Typography sx={{ fontSize: '0.76rem' }}>Đang giải thích…</Typography>
          </Box>
        ) : c.error ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, color: '#DC2626' }}>
            <AlertCircle size={13} /> <Typography sx={{ fontSize: '0.76rem' }}>{c.error}</Typography>
          </Box>
        ) : c.report ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            {/* compact conclusion */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Sparkles size={13} color="#0277BD" style={{ flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#004D40' }}>{c.report.conclusion.primary_dx}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: sevColor(c.report.conclusion.severity), flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
                Mức độ {c.report.conclusion.severity} · AI {c.report.conclusion.ai_confidence}%
              </Typography>
            </Box>

            {/* expand / collapse full report */}
            <Box component="button" onClick={() => setOpen((v) => !v)}
              sx={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 0.4, mt: 0.25, px: 0, border: 'none', background: 'transparent', cursor: 'pointer', color: '#0277BD', fontSize: '0.74rem', fontWeight: 700 }}>
              {open ? <>Thu gọn <ChevronUp size={14} /></> : <>Xem chi tiết <ChevronDown size={14} /></>}
            </Box>
            {open && (
              <Box sx={{ mt: 0.5 }}>
                <LesionReportCard report={c.report} />
              </Box>
            )}
          </Box>
        ) : (
          <Typography sx={{ fontSize: '0.74rem', color: 'text.disabled' }}>Chưa có giải thích</Typography>
        )}
      </Box>
    </Box>
  );
}

export function LiveCapturesPanel({
  captures,
  onRemove,
}: {
  captures: LiveCapture[];
  onRemove?: (id: number) => void;
}) {
  return (
    <Box sx={{ width: { xs: '100%', md: 340 }, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: '16px', border: '1px solid #E2EAE8', backgroundColor: '#fff', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid #EEF2F1', backgroundColor: '#F8FAFB', display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <ImageIcon size={15} color="#006064" />
        <Typography sx={{ fontWeight: 800, fontSize: '0.82rem', color: '#004D40' }}>Ảnh tổn thương</Typography>
        <Box sx={{ ml: 'auto', minWidth: 22, textAlign: 'center', px: 0.9, py: 0.15, borderRadius: '999px', backgroundColor: '#006064', color: '#fff', fontSize: '0.7rem', fontWeight: 800 }}>
          {captures.length}
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: captures.length ? 1.25 : 0, display: 'flex', flexDirection: 'column', gap: 1.25, maxHeight: { xs: 420, md: 640 } }}>
        {captures.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center', color: 'text.disabled' }}>
            <Typography sx={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
              Chưa ghi lại tổn thương nào. Khi AI phát hiện, ảnh sẽ tự xuất hiện ở đây kèm phần giải thích.
            </Typography>
          </Box>
        ) : captures.map((c) => (
          <CaptureCard key={c.id} c={c} onRemove={onRemove} />
        ))}
      </Box>
    </Box>
  );
}