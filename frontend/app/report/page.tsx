'use client';

import { useMemo, useState } from 'react';
import { motion as framMotion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle, CheckCircle2, CircleX, Clock, Download, FileText,
  ScanSearch, Sparkles, Trash2, Video, X, Zap, Radio, FolderOpen, Upload, ChevronLeft,
} from 'lucide-react';
import { useAnalysis, type Detection, type DetectionStatus, type Session } from '@/context/AnalysisContext';
import { SessionSummaryPanel } from '@/components/session-summary-panel';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import MuiButton from '@mui/material/Button';
import MuiDialog from '@mui/material/Dialog';
import MuiDialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import { PipelineMetricsSection } from '@/components/pipeline-metrics-section';

const MotionBox = framMotion(Box);

const SEVERITY_THRESHOLDS = { high: 0.8, medium: 0.6 } as const;

function getSeverity(confidence: number) {
  if (confidence >= SEVERITY_THRESHOLDS.high)
    return { label: 'Nghiêm trọng', color: '#DC2626', bg: 'rgba(220,38,38,0.1)', light: 'rgba(220,38,38,0.06)' };
  if (confidence >= SEVERITY_THRESHOLDS.medium)
    return { label: 'Trung bình', color: '#D97706', bg: 'rgba(245,158,11,0.12)', light: 'rgba(245,158,11,0.06)' };
  return { label: 'Nhẹ', color: '#059669', bg: 'rgba(5,150,105,0.1)', light: 'rgba(5,150,105,0.05)' };
}

function fmtTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m} phút ${String(s).padStart(2, '0')} giây` : `${s} giây`;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function trimName(name: string, max = 42): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

const STATUS_CFG: Record<DetectionStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  confirmed: { label: 'Xác nhận',     color: '#059669', bg: 'rgba(5,150,105,0.1)',   icon: <CheckCircle2 size={11} /> },
  analyzed:  { label: 'Đã phân tích', color: '#0277BD', bg: 'rgba(2,119,189,0.1)',   icon: <Sparkles size={11} /> },
  ignored:   { label: 'Bỏ qua',       color: '#9AA5B1', bg: 'rgba(154,165,177,0.1)', icon: <CircleX size={11} /> },
  detected:  { label: 'Phát hiện',    color: '#D97706', bg: 'rgba(245,158,11,0.1)',  icon: <AlertTriangle size={11} /> },
};

const SOURCE_CFG: Record<Session['source'], { label: string; icon: React.ReactNode; color: string }> = {
  upload:  { label: 'Upload',     icon: <Upload size={12} />,    color: '#006064' },
  live:    { label: 'Live',       icon: <Radio size={12} />,     color: '#C2185B' },
  library: { label: 'Thư viện',   icon: <FolderOpen size={12} />, color: '#5E35B1' },
};

// ── Confidence ring ──

function ConfidenceRing({ pct, color }: { pct: number; color: string }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <Box sx={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
      <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="5" />
        <circle
          cx="36" cy="36" r={r} fill="none"
          stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: '1rem', fontWeight: 800, color, lineHeight: 1 }}>{pct.toFixed(0)}</Typography>
        <Typography sx={{ fontSize: '0.58rem', fontWeight: 600, color: 'text.disabled', letterSpacing: '0.04em' }}>%</Typography>
      </Box>
    </Box>
  );
}

// ── Detection detail modal ──

function DetectionModal({
  det,
  onClose,
  onBack,
}: {
  det: Detection;
  onClose: () => void;
  onBack: () => void;
}) {
  const sev = getSeverity(det.confidence);
  const pct = det.confidence * 100;

  return (
    <MuiDialog
      open
      onClose={onClose}
      maxWidth={false}
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: '24px', overflow: 'hidden', width: '90vw', maxWidth: 1080, maxHeight: '85vh' } } }}
    >
      <MuiDialogContent sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: 520 }}>

          {/* Left: frame image — uses an inline-flex wrapper sized to the natural image
              so the bbox overlay (positioned in %) lines up regardless of aspect ratio.
              objectFit:contain avoids cropping; letterbox sits on the dark panel. */}
          <Box sx={{ flex: '0 0 52%', backgroundColor: '#0A0F16', position: 'relative', minHeight: { xs: 240, md: 320 }, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {det.frame_b64 ? (
              <Box sx={{ position: 'relative', display: 'inline-flex', maxWidth: '100%', maxHeight: '100%' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${det.frame_b64}`}
                  alt="detection frame"
                  style={{ display: 'block', maxWidth: '100%', maxHeight: '80vh', width: 'auto', height: 'auto' }}
                />
                {(() => {
                  const _c = (/ung thư|ung thu/i.test(det.label) ? '#C44E52'
                            : /loét|loet/i.test(det.label)       ? '#55A868'
                            :                                       '#DD8452');
                  const _flip = det.bbox.y < 6;
                  const _rgba = (a: number) => {
                    const r = parseInt(_c.slice(1,3),16), g = parseInt(_c.slice(3,5),16), b = parseInt(_c.slice(5,7),16);
                    return `rgba(${r},${g},${b},${a})`;
                  };
                  return (
                    <>
                      <Box sx={{
                        position: 'absolute',
                        left: `${det.bbox.x}%`, top: `${det.bbox.y}%`,
                        width: `${det.bbox.width}%`, height: `${det.bbox.height}%`,
                        borderStyle: 'solid', borderWidth: '3px', borderColor: _c,
                        backgroundColor: _rgba(0.12),
                        borderRadius: '6px',
                        pointerEvents: 'none',
                      }} />
                      <Box sx={{
                        position: 'absolute',
                        left: `${det.bbox.x}%`,
                        ...(_flip
                          ? { top: `calc(${det.bbox.y + det.bbox.height}% + 4px)` }
                          : { top: `calc(${det.bbox.y}% - 30px)` }),
                        display: 'inline-flex', alignItems: 'center', gap: 0.6,
                        px: 1.1, py: 0.45, borderRadius: '7px',
                        backgroundColor: _c, color: '#fff',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                        pointerEvents: 'none',
                      }}>
                        <Zap size={10} />
                        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {det.label}
                        </Typography>
                        <Box sx={{ width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.45)' }} />
                        <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.9 }}>
                          {(det.confidence * 100).toFixed(0)}%
                        </Typography>
                      </Box>
                    </>
                  );
                })()}
              </Box>
            ) : (
              <Box sx={{
                height: '100%', minHeight: 280, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 1.5,
                background: 'radial-gradient(ellipse at 50% 40%, rgba(0,96,100,0.12) 0%, transparent 70%)',
              }}>
                <Box sx={{ width: 72, height: 72, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ScanSearch size={32} color="rgba(255,255,255,0.2)" />
                </Box>
                <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.25)', fontWeight: 500 }}>
                  Không có khung hình
                </Typography>
              </Box>
            )}

            <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)', pointerEvents: 'none' }} />
            <Box sx={{ position: 'absolute', bottom: 14, left: 14, display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.6, borderRadius: '8px', backgroundColor: sev.bg, border: `1px solid ${sev.color}35`, backdropFilter: 'blur(10px)' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: sev.color }} />
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: sev.color }}>{sev.label}</Typography>
            </Box>

            <Box sx={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.45, borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Sparkles size={10} color="#00BCD4" />
              <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#80DEEA', letterSpacing: '0.06em', textTransform: 'uppercase' }}>AI Detection</Typography>
            </Box>
          </Box>

          {/* Right: details panel */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'background.paper' }}>
            <Box sx={{ px: 3, pt: 2.5, pb: 2, borderBottom: '1px solid #EEF2F0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#006064', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Kết quả phát hiện
                  </Typography>
                  {(() => { const sc = STATUS_CFG[det.status ?? 'detected']; return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.25, borderRadius: '6px', backgroundColor: sc.bg }}>
                      <Box sx={{ color: sc.color, display: 'flex' }}>{sc.icon}</Box>
                      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: sc.color }}>{sc.label}</Typography>
                    </Box>
                  ); })()}
                </Box>
                <Typography sx={{ fontSize: '1.3rem', fontWeight: 800, color: 'text.primary', lineHeight: 1.25, wordBreak: 'break-word' }}>
                  {det.label}
                </Typography>
              </Box>
              <Box component="button" onClick={onClose} sx={{ background: 'none', border: 'none', cursor: 'pointer', p: 0.75, borderRadius: '8px', flexShrink: 0, transition: 'background 0.15s', '&:hover': { backgroundColor: '#F0F4F3' } }}>
                <X size={17} color="#9AA5B1" />
              </Box>
            </Box>

            <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2.5, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Chip
                  icon={<Clock size={12} />}
                  label={fmtTs(det.timestamp)}
                  size="small"
                  sx={{ backgroundColor: 'rgba(0,0,0,0.04)', color: 'text.secondary', fontWeight: 500, fontSize: '0.78rem', fontFamily: 'monospace', '& .MuiChip-icon': { color: 'text.disabled' }, borderRadius: '8px', height: 28 }}
                />
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, p: 2, borderRadius: '14px', backgroundColor: sev.light, border: `1px solid ${sev.color}18` }}>
                <ConfidenceRing pct={pct} color={sev.color} />
                <Box>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.5 }}>
                    Độ tin cậy
                  </Typography>
                  <Typography sx={{ fontSize: '0.92rem', fontWeight: 700, color: sev.color }}>
                    {pct.toFixed(0)}% — {sev.label}
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', mt: 0.25 }}>
                    Phát hiện tại {fmtTs(det.timestamp)}
                  </Typography>
                </Box>
              </Box>

              {det.llmInsight ? (
                <Box>
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.25 }}>
                    Phân tích AI
                  </Typography>
                  <Box sx={{
                    fontSize: '0.875rem', lineHeight: 1.75, color: 'text.primary',
                    '& p': { margin: '0 0 8px' },
                    '& p:last-child': { marginBottom: 0 },
                    '& strong': { fontWeight: 700, color: '#004D40' },
                    '& p:has(strong:first-of-type)': {
                      borderLeft: '3px solid #00897B',
                      pl: 1.25, mb: 0.75,
                      backgroundColor: 'rgba(0,137,123,0.04)',
                      borderRadius: '0 6px 6px 0',
                    },
                    '& ul, & ol': { pl: '1.1rem', margin: '4px 0 8px' },
                    '& li': { mb: '3px', listStyleType: 'none', pl: 0 },
                    '& li input[type="checkbox"]': { mr: '7px', accentColor: '#006064', width: 13, height: 13, verticalAlign: 'middle' },
                    '& h1, & h2, & h3': { fontSize: '0.88rem', fontWeight: 700, color: '#004D40', margin: '8px 0 3px' },
                    '& code': { backgroundColor: 'rgba(0,96,100,0.08)', borderRadius: '4px', padding: '1px 5px', fontSize: '0.8rem' },
                  }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{det.llmInsight}</ReactMarkdown>
                  </Box>
                </Box>
              ) : (
                <Box sx={{ py: 2, textAlign: 'center', color: 'text.disabled' }}>
                  <Typography sx={{ fontSize: '0.82rem' }}>Chưa có phân tích LLM cho tổn thương này</Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ px: 3, py: 2, borderTop: '1px solid #EEF2F0', display: 'flex', gap: 1.5 }}>
              <MuiButton
                variant="outlined"
                startIcon={<ChevronLeft size={14} />}
                onClick={onBack}
                sx={{ borderRadius: '10px', fontWeight: 700, px: 2.5 }}
              >
                Quay lại
              </MuiButton>
              <MuiButton
                fullWidth
                variant="contained"
                onClick={onClose}
                sx={{ borderRadius: '10px', fontWeight: 700, backgroundColor: '#006064', '&:hover': { backgroundColor: '#004D51' } }}
              >
                Đóng
              </MuiButton>
            </Box>
          </Box>
        </Box>
      </MuiDialogContent>
    </MuiDialog>
  );
}

// ── Session detail modal — grid of detections ──

function SessionDetailModal({
  session,
  onClose,
  onSelectDetection,
  onSendSessionQA,
  onDeleteSession,
}: {
  session: Session;
  onClose: () => void;
  onSelectDetection: (d: Detection) => void;
  onSendSessionQA: (text: string, sessionId?: string) => void;
  onDeleteSession: () => void;
}) {
  const sourceCfg = SOURCE_CFG[session.source];
  const confirmed = session.detections.filter(d => d.status === 'confirmed' || d.status === 'analyzed').length;
  const ignored   = session.detections.filter(d => d.status === 'ignored').length;
  const total     = session.detections.length;

  // Phase B — tab switch between detection grid and AI summary panel.
  const [tab, setTab] = useState<'detections' | 'summary'>('detections');
  const hasSummary = !!session.summary;

  return (
    <MuiDialog
      open
      onClose={onClose}
      maxWidth={false}
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: '20px', overflow: 'hidden', width: '94vw', maxWidth: 1280, maxHeight: '90vh' } } }}
    >
      <MuiDialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>

        <Box sx={{ px: 3.5, py: 2.5, borderBottom: '1px solid #E2EAE8', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, backgroundColor: '#F8FAFB' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.1, py: 0.35, borderRadius: '6px', backgroundColor: `${sourceCfg.color}15`, color: sourceCfg.color }}>
                {sourceCfg.icon}
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{sourceCfg.label}</Typography>
              </Box>
              <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace' }}>
                {fmtDate(session.startedAt)}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: 'text.primary', lineHeight: 1.3, wordBreak: 'break-all', mb: 0.5 }}>
              {session.name}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                <strong style={{ color: '#0D1B2A' }}>{total}</strong> tổn thương
              </Typography>
              {confirmed > 0 && (
                <Typography variant="caption" sx={{ color: '#059669' }}>
                  <CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {confirmed} xác nhận / phân tích
                </Typography>
              )}
              {ignored > 0 && (
                <Typography variant="caption" sx={{ color: '#9AA5B1' }}>
                  <CircleX size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {ignored} bỏ qua
                </Typography>
              )}
            </Box>
          </Box>
          <IconButton onClick={onClose} sx={{ flexShrink: 0 }} aria-label="Đóng">
            <X size={18} />
          </IconButton>
        </Box>

        {/* Phase B — tab toggle. Detection grid hoặc AI summary panel.
            Chỉ show tab "Tổng hợp AI" khi summary đã có hoặc đang chờ generate. */}
        <Box sx={{ px: 3.5, pt: 2, borderBottom: '1px solid #E2EAE8', backgroundColor: '#FAFCFB' }}>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <MuiButton
              size="small"
              onClick={() => setTab('detections')}
              sx={{
                borderRadius: '8px 8px 0 0', fontSize: '0.78rem', fontWeight: 700, textTransform: 'none',
                px: 2, py: 1, minWidth: 0,
                color: tab === 'detections' ? '#006064' : 'text.secondary',
                borderBottom: tab === 'detections' ? '2px solid #006064' : '2px solid transparent',
                '&:hover': { backgroundColor: 'rgba(0,96,100,0.04)' },
              }}
            >
              Tổn thương ({total})
            </MuiButton>
            <MuiButton
              size="small"
              onClick={() => setTab('summary')}
              startIcon={<Sparkles size={13} />}
              sx={{
                borderRadius: '8px 8px 0 0', fontSize: '0.78rem', fontWeight: 700, textTransform: 'none',
                px: 2, py: 1, minWidth: 0,
                color: tab === 'summary' ? '#006064' : 'text.secondary',
                borderBottom: tab === 'summary' ? '2px solid #006064' : '2px solid transparent',
                '&:hover': { backgroundColor: 'rgba(0,96,100,0.04)' },
              }}
            >
              Tổng hợp AI {hasSummary ? '' : '(chờ)'}
            </MuiButton>
          </Box>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', px: tab === 'summary' ? 0 : 3.5, py: tab === 'summary' ? 0 : 3, backgroundColor: 'background.default' }}>
          {tab === 'summary' ? (
            // AI summary + chat — full-height inline (not a nested dialog).
            // Bind the session id explicitly so HTTP fallback addresses the
            // right backend row even when user browses an older session.
            <Box sx={{ height: '100%', p: 2 }}>
              <SessionSummaryPanel
                summary={session.summary}
                qaMessages={session.qaMessages ?? []}
                qaStreaming={session.qaStreaming ?? false}
                onSendQA={(text) => onSendSessionQA(text, session.id)}
                onClose={onClose}
              />
            </Box>
          ) : total === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
              <ScanSearch size={40} color="#C8D8D6" />
              <Typography sx={{ mt: 1.5, fontSize: '0.9rem' }}>Phiên này không có tổn thương nào được phát hiện</Typography>
            </Box>
          ) : (
            <Grid container spacing={2.5}>
              {session.detections.map((det, idx) => {
                const sev = getSeverity(det.confidence);
                const sc = STATUS_CFG[det.status ?? 'detected'];
                return (
                  <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={`${session.id}-d-${idx}`}>
                    <MotionBox
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: Math.min(idx * 0.04, 0.4) }}
                      onClick={() => onSelectDetection(det)}
                      sx={{
                        height: '100%',
                        backgroundColor: 'background.paper',
                        borderRadius: '14px',
                        border: '1px solid #E2EAE8',
                        boxShadow: '0 1px 6px rgba(13,27,42,0.05)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        cursor: 'pointer',
                        opacity: det.status === 'ignored' ? 0.7 : 1,
                        transition: 'box-shadow 0.2s, transform 0.2s, opacity 0.2s',
                        '&:hover': { boxShadow: '0 6px 18px rgba(13,27,42,0.1)', transform: 'translateY(-2px)', opacity: 1 },
                      }}
                    >
                      <Box sx={{ height: 130, backgroundColor: '#0D1117', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {det.frame_b64 ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`data:image/jpeg;base64,${det.frame_b64}`} alt="detection frame" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <ScanSearch size={28} color="rgba(255,255,255,0.15)" />
                        )}
                        <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.3, borderRadius: '6px', backgroundColor: sc.bg, backdropFilter: 'blur(8px)', border: `1px solid ${sc.color}25` }}>
                          <Box sx={{ color: sc.color, display: 'flex' }}>{sc.icon}</Box>
                          <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: sc.color }}>{sc.label}</Typography>
                        </Box>
                        <Box sx={{ position: 'absolute', bottom: 8, left: 8, px: 1.1, py: 0.35, borderRadius: '6px', backgroundColor: sev.bg, border: `1px solid ${sev.color}30`, backdropFilter: 'blur(8px)' }}>
                          <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: sev.color }}>{sev.label}</Typography>
                        </Box>
                      </Box>
                      <Box sx={{ p: 1.75, flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: 'text.primary', mb: 0.25, lineHeight: 1.3, wordBreak: 'break-word' }}>
                          {det.label}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace' }}>
                          {fmtTs(det.timestamp)} · {(det.confidence * 100).toFixed(0)}%
                        </Typography>
                      </Box>
                    </MotionBox>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </Box>

        <Box sx={{ px: 3.5, py: 2, borderTop: '1px solid #E2EAE8', display: 'flex', justifyContent: 'space-between', gap: 1.5, backgroundColor: '#F8FAFB' }}>
          <MuiButton
            variant="outlined"
            startIcon={<Trash2 size={14} />}
            onClick={onDeleteSession}
            sx={{ borderRadius: '10px', fontWeight: 700, borderColor: 'rgba(220,38,38,0.3)', color: '#DC2626', px: 2.5, '&:hover': { backgroundColor: 'rgba(220,38,38,0.06)', borderColor: '#DC2626' } }}
          >
            Xoá phiên
          </MuiButton>
          <MuiButton
            variant="contained"
            onClick={onClose}
            sx={{ borderRadius: '10px', fontWeight: 700, backgroundColor: '#006064', px: 3, '&:hover': { backgroundColor: '#004D51' } }}
          >
            Đóng
          </MuiButton>
        </Box>
      </MuiDialogContent>
    </MuiDialog>
  );
}

// ── Session card on the report grid ──

function SessionCard({ session, idx, onClick }: { session: Session; idx: number; onClick: () => void }) {
  const sourceCfg = SOURCE_CFG[session.source];
  const total = session.detections.length;
  const confirmed = session.detections.filter(d => d.status === 'confirmed' || d.status === 'analyzed').length;
  const ignored = session.detections.filter(d => d.status === 'ignored').length;
  const thumbs = session.detections.filter(d => d.frame_b64).slice(0, 3);
  const peakConfidence = session.detections.reduce((max, d) => Math.max(max, d.confidence), 0);
  const sev = getSeverity(peakConfidence);

  return (
    <MotionBox
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: idx * 0.06 }}
      onClick={onClick}
      sx={{
        height: '100%',
        backgroundColor: 'background.paper',
        borderRadius: '18px',
        border: '1px solid #E2EAE8',
        boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s, transform 0.2s',
        '&:hover': { boxShadow: '0 10px 32px rgba(13,27,42,0.12)', transform: 'translateY(-3px)' },
      }}
    >
      <Box sx={{ height: 160, backgroundColor: '#0D1117', position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {thumbs.length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
            <Video size={32} color="rgba(255,255,255,0.18)" />
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>
              {total === 0 ? 'Không có tổn thương' : 'Không có khung hình'}
            </Typography>
          </Box>
        ) : (
          thumbs.map((det, i) => (
            <Box
              key={`t-${i}`}
              sx={{
                flex: 1,
                position: 'relative',
                borderRight: i < thumbs.length - 1 ? '2px solid #0D1117' : 'none',
                overflow: 'hidden',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/jpeg;base64,${det.frame_b64}`}
                alt={`detection ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </Box>
          ))
        )}

        <Box sx={{ position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.1, py: 0.4, borderRadius: '7px', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}>
          {sourceCfg.icon}
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{sourceCfg.label}</Typography>
        </Box>

        <Box sx={{ position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.4, borderRadius: '7px', backgroundColor: 'rgba(0,96,100,0.95)', color: '#fff' }}>
          <ScanSearch size={11} />
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 800 }}>{total}</Typography>
        </Box>

        {total > 0 && (
          <Box sx={{ position: 'absolute', bottom: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.1, py: 0.35, borderRadius: '6px', backgroundColor: sev.bg, border: `1px solid ${sev.color}30`, backdropFilter: 'blur(8px)' }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: sev.color }} />
            <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: sev.color }}>{sev.label}</Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ p: 2.25, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, color: 'text.primary', mb: 0.5, lineHeight: 1.35, wordBreak: 'break-all' }}>
          {trimName(session.name)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace', mb: 1.5 }}>
          {fmtDate(session.startedAt)}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, mt: 'auto', flexWrap: 'wrap' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
            <ScanSearch size={12} color="#006064" />
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>{total}</Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>tổn thương</Typography>
          </Box>
          {confirmed > 0 && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
              <CheckCircle2 size={12} color="#059669" />
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#059669' }}>{confirmed}</Typography>
            </Box>
          )}
          {ignored > 0 && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
              <CircleX size={12} color="#9AA5B1" />
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#9AA5B1' }}>{ignored}</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </MotionBox>
  );
}

// ── Page ──

export default function ReportPage() {
  const { sessions, removeSession, clearSessions, sendSessionQA } = useAnalysis();
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [openDetection, setOpenDetection] = useState<Detection | null>(null);

  const openSession = useMemo(
    () => sessions.find((s) => s.id === openSessionId) ?? null,
    [sessions, openSessionId],
  );

  const totalDetections = useMemo(
    () => sessions.reduce((acc, s) => acc + s.detections.length, 0),
    [sessions],
  );

  if (sessions.length === 0) {
    return (
      <Box sx={{ minHeight: 'calc(100vh - 130px)', py: 5, px: { xs: 2, lg: 4 }, backgroundColor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ textAlign: 'center', maxWidth: 360 }}>
          <ScanSearch size={48} color="#C8D8D6" style={{ marginBottom: 16 }} />
          <Typography variant="h3" sx={{ fontSize: '1.25rem', fontWeight: 700, color: 'text.primary', mb: 1 }}>
            Chưa có phiên nội soi nào
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Hoàn tất một phiên phân tích trong Workspace để xem báo cáo tổng kết.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: 'calc(100vh - 130px)', py: 5, px: { xs: 2, lg: 4 }, backgroundColor: 'background.default' }}>
      <Container maxWidth="lg" sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { md: 'flex-start' }, justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, px: 1.5, py: 0.4, borderRadius: '6px', backgroundColor: 'rgba(0,96,100,0.1)', width: 'fit-content' }}>
              <FileText size={12} color="#006064" />
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#006064', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Báo cáo tổng kết
              </Typography>
            </Box>
            <Typography variant="h3" sx={{ fontSize: '1.5rem', fontWeight: 800, color: 'text.primary', mb: 0.5 }}>
              Lịch sử phiên nội soi
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {sessions.length} phiên · {totalDetections} tổn thương · Lưu cục bộ tối đa 10 phiên gần nhất
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <MuiButton
              variant="outlined"
              startIcon={<Trash2 size={16} />}
              onClick={() => {
                if (window.confirm('Xoá toàn bộ lịch sử phiên?')) clearSessions();
              }}
              sx={{ borderRadius: '10px', fontWeight: 700, borderColor: 'rgba(220,38,38,0.3)', color: '#DC2626', px: 2.5, '&:hover': { backgroundColor: 'rgba(220,38,38,0.06)', borderColor: '#DC2626' } }}
            >
              Xoá tất cả
            </MuiButton>
            <Dialog>
              <DialogTrigger asChild>
                <MuiButton variant="contained" startIcon={<Download size={18} />} sx={{ borderRadius: '10px', px: 3, py: 1.25, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  Xuất báo cáo PDF
                </MuiButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Xuất báo cáo PDF</DialogTitle>
                  <DialogDescription>Chức năng xuất file sẽ được kết nối sau.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <MuiButton variant="outlined" sx={{ borderRadius: '8px' }}>Đóng</MuiButton>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Box>
        </Box>

        <Grid container spacing={2.5}>
          {sessions.map((session, idx) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={session.id}>
              <SessionCard
                session={session}
                idx={idx}
                onClick={() => setOpenSessionId(session.id)}
              />
            </Grid>
          ))}
        </Grid>

        <PipelineMetricsSection />

      </Container>

      {openSession && !openDetection && (
        <SessionDetailModal
          session={openSession}
          onClose={() => setOpenSessionId(null)}
          onSelectDetection={(d) => setOpenDetection(d)}
          onSendSessionQA={sendSessionQA}
          onDeleteSession={() => {
            if (window.confirm(`Xoá phiên "${openSession.name}"?`)) {
              removeSession(openSession.id);
              setOpenSessionId(null);
            }
          }}
        />
      )}

      {openSession && openDetection && (
        <DetectionModal
          det={openDetection}
          onClose={() => { setOpenDetection(null); setOpenSessionId(null); }}
          onBack={() => setOpenDetection(null)}
        />
      )}
    </Box>
  );
}
