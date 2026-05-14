'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion as framMotion } from 'framer-motion';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleX,
  ClipboardList,
  Clock,
  FileVideo,
  Flag,
  MapPin,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  ScanSearch,
  Sparkles,
  Square,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useRouter } from 'next/navigation';
import MuiDialog from '@mui/material/Dialog';
import MuiDialogContent from '@mui/material/DialogContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { API_BASE } from '@/lib/ws-client';
import { useAnalysis, type Detection, type DetectionStatus } from '@/context/AnalysisContext';
import { useVoiceControl } from '@/hooks/use-voice-control';
import { VideoSourceModal } from '@/components/video-source-modal';
import { LesionReportCard } from '@/components/lesion-report-card';
import { DisclaimerBanner } from '@/components/disclaimer';
import { SessionSummaryPanel } from '@/components/session-summary-panel';

import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { Radio, Wifi } from 'lucide-react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { styled } from '@mui/material/styles';

const MotionBox = framMotion(Box);

// ── Styled video container ───────────────────────────────────────────────────

const VideoContainer = styled(Box)(() => ({
  position: 'relative',
  aspectRatio: '16 / 9',
  width: '100%',
  overflow: 'hidden',
  borderRadius: '16px',
  border: '1px solid rgba(255,255,255,0.08)',
  backgroundColor: '#0D1117',
}));

// ── Bbox styling — modelled after GastroEye `detection_bounding_box` ─────────
//
// Style props match the C++ Qt reference (sample_code/gastroeye/.../configs.yaml):
//   shape: RoundedRect, rounded_rect_radius_ratio: 0.05
//   line_width: 3, fill_alpha: 30/255 (≈12 %), boxed_description: true
//
// Color is severity-aware so doctors can scan for cancers at a glance:
//   - Cancer (Ung thư …)  → red  #C44E52   (Seaborn deep[3])
//   - Inflammation (Viêm) → orange #DD8452 (Seaborn deep[1])
//   - Ulcer (Loét)        → green #55A868 (Seaborn deep[2])

function bboxColorFor(label: string): string {
  if (/ung thư|ung thu/i.test(label)) return '#C44E52';
  if (/loét|loet/i.test(label))       return '#55A868';
  return '#DD8452';  // viêm + default
}

function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const BboxOverlay = styled(MotionBox)(() => ({
  position: 'absolute',
  borderStyle: 'solid',
  borderWidth: '3px',
  // border-color and bg set inline per detection (severity-based palette)
  // 5 % rounded corners + 12 % fill alpha follow GastroEye defaults
  borderRadius: 'min(8px, 0.5vw)',
  pointerEvents: 'none',
}));

interface DetectionLabelChipProps {
  label: string;
  confidence: number;
  timestamp: string;
  color: string;     // class color (hex)
  flipBelow: boolean; // place below bbox if too close to top
}

function DetectionLabelChip({ label, confidence, timestamp, color, flipBelow }: DetectionLabelChipProps) {
  // Solid colored background with white text — matches GastroEye `boxed_description: true`
  return (
    <Box sx={{
      position: 'absolute',
      [flipBelow ? 'top' : 'bottom']: flipBelow ? 'calc(100% + 4px)' : 'calc(100% + 4px)',
      left: 0,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.85,
      px: 1.25, py: 0.5,
      borderRadius: '8px',
      backgroundColor: color,
      color: '#fff',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      fontSize: '0.74rem',
      fontWeight: 700,
      letterSpacing: '0.01em',
    }}>
      <Zap size={11} />
      <span>{label}</span>
      <Box sx={{ width: 1, height: 11, backgroundColor: 'rgba(255,255,255,0.45)' }} />
      <span style={{ fontWeight: 600, opacity: 0.9 }}>{(confidence * 100).toFixed(0)}%</span>
      <Box sx={{ width: 1, height: 11, backgroundColor: 'rgba(255,255,255,0.45)' }} />
      <span style={{ fontWeight: 500, fontFamily: 'monospace', opacity: 0.85 }}>{timestamp}</span>
    </Box>
  );
}

// ── Status dot with pulse animation ─────────────────────────────────────────

function StatusDot({ color }: { color: string }) {
  return (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: `0 0 0 3px ${color}33`,
        animation: color === '#4CAF50' ? 'pulse 2s infinite' : 'none',
        '@keyframes pulse': {
          '0%, 100%': { boxShadow: `0 0 0 3px ${color}33` },
          '50%': { boxShadow: `0 0 0 7px ${color}11` },
        },
      }}
    />
  );
}

// ── Live stream input zone ───────────────────────────────────────────────────

interface LiveInputZoneProps {
  value: string;
  onChange: (v: string) => void;
  onConnect: () => void;
  isConnecting: boolean;
}

function LiveInputZone({ value, onChange, onConnect, isConnecting }: LiveInputZoneProps) {
  return (
    <Box
      sx={{
        aspectRatio: '16 / 9',
        width: '100%',
        borderRadius: '16px',
        border: '2px dashed #C8D8D6',
        backgroundColor: '#FAFCFB',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2.5,
        px: { xs: 3, md: 8 },
      }}
    >
      <Box sx={{ width: 56, height: 56, borderRadius: '16px', backgroundColor: 'rgba(0,96,100,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#006064' }}>
        <Wifi size={28} />
      </Box>
      <Box sx={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          Kết nối nguồn video trực tiếp
        </Typography>
        <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 2 }}>
          Nhập địa chỉ RTSP hoặc đường dẫn thiết bị V4L2
        </Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="rtsp://192.168.1.x:554/stream  hoặc  /dev/video0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onConnect(); }}
          sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
        />
        <MuiButton
          variant="contained"
          fullWidth
          disabled={!value.trim() || isConnecting}
          onClick={onConnect}
          startIcon={isConnecting ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <Radio size={16} />}
          sx={{ borderRadius: '10px', py: 1.25, fontWeight: 700 }}
        >
          {isConnecting ? 'Đang kết nối…' : 'Kết nối & Bắt đầu'}
        </MuiButton>
      </Box>
    </Box>
  );
}

// ── Video picker trigger zone (opens modal) ──────────────────────────────────

function VideoPickerTriggerZone({ onClick }: { onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        aspectRatio: '16 / 9',
        width: '100%',
        borderRadius: '16px',
        border: '2px dashed #C8D8D6',
        backgroundColor: '#FAFCFB',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        '&:hover': { borderColor: '#006064', backgroundColor: 'rgba(0,96,100,0.04)' },
      }}
    >
      <Box sx={{ width: 64, height: 64, borderRadius: '16px', backgroundColor: 'rgba(0,96,100,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#006064' }}>
        <UploadCloud size={30} />
      </Box>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          Tải video lên để phân tích
        </Typography>
        <Typography variant="caption" color="textSecondary">
          Nhấn để chọn file hoặc chọn từ thư viện
        </Typography>
      </Box>
    </Box>
  );
}

// ── Library video ready panel ────────────────────────────────────────────────

// Phase C2 — single skeleton bar with shimmer. Reused for lesion report
// loading state so the doctor sees structured placeholders, not a blank
// spinner. Width/height tune the row to match what's coming.
function SkeletonBar({ width, height = 10 }: { width: string | number; height?: number }) {
  return (
    <Box sx={{
      width, height,
      borderRadius: '4px',
      background: 'linear-gradient(90deg, #E2EAE8 0%, #F0F4F3 50%, #E2EAE8 100%)',
      backgroundSize: '200% 100%',
      animation: 'skeletonShimmer 1.4s ease-in-out infinite',
      '@keyframes skeletonShimmer': {
        '0%':   { backgroundPosition: '200% 0' },
        '100%': { backgroundPosition: '-200% 0' },
      },
    }} />
  );
}

function LibraryReadyPanel({ onReselect }: { onReselect: () => void }) {
  return (
    <Box
      onClick={onReselect}
      sx={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '16px', backgroundColor: '#0D1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'opacity 0.2s', '&:hover': { opacity: 0.85 } }}
    >
      <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, rgba(0,96,100,0.08) 1px, transparent 1px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />
      <FileVideo size={36} color="rgba(0,132,143,0.5)" />
      <Box sx={{ textAlign: 'center', zIndex: 1 }}>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.65)', mb: 0.5 }}>
          Video thư viện đã sẵn sàng
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>
          Nhấn &quot;Bắt đầu phân tích AI&quot; · Nhấn vào đây để chọn video khác
        </Typography>
      </Box>
    </Box>
  );
}

// ── Live stream connected panel ──────────────────────────────────────────────

function LiveStreamPanel({ source, pipelineState }: { source: string; pipelineState: string }) {
  const isActive = pipelineState === 'PLAYING' || pipelineState === 'PAUSED_WAITING_INPUT' || pipelineState === 'PROCESSING_LLM';
  return (
    <Box sx={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '16px', backgroundColor: '#0D1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, position: 'relative', overflow: 'hidden' }}>
      {/* subtle grid bg */}
      <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, rgba(0,96,100,0.08) 1px, transparent 1px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />
      <Box sx={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.4, borderRadius: '6px', backgroundColor: isActive ? 'rgba(220,38,38,0.85)' : 'rgba(100,100,100,0.6)', backdropFilter: 'blur(6px)' }}>
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#fff', animation: isActive ? 'pulse 1.5s infinite' : 'none', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } } }} />
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>{isActive ? 'LIVE' : 'OFFLINE'}</Typography>
      </Box>
      <Radio size={36} color="rgba(0,132,143,0.5)" />
      <Box sx={{ textAlign: 'center', zIndex: 1 }}>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.55)', mb: 0.5 }}>
          {isActive ? 'Đang phân tích luồng trực tiếp' : 'Chưa kết nối'}
        </Typography>
        <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source}
        </Typography>
      </Box>
    </Box>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const STATUS_CONFIG: Record<DetectionStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  confirmed: { label: 'Xác nhận', color: '#059669', bg: 'rgba(5,150,105,0.1)', icon: <CheckCircle2 size={12} /> },
  analyzed:  { label: 'Đã phân tích', color: '#0277BD', bg: 'rgba(2,119,189,0.1)', icon: <Sparkles size={12} /> },
  ignored:   { label: 'Bỏ qua', color: '#9AA5B1', bg: 'rgba(154,165,177,0.1)', icon: <CircleX size={12} /> },
  detected:  { label: 'Phát hiện', color: '#D97706', bg: 'rgba(245,158,11,0.1)', icon: <AlertTriangle size={12} /> },
};

// ── Session Report Modal ──────────────────────────────────────────────────────

interface SessionReportModalProps {
  detections: Detection[];
  onClose: () => void;
  onRestart: () => void;
  onGoReport: () => void;
  isNavigating: boolean;
}

function SessionReportModal({ detections, onClose, onRestart, onGoReport, isNavigating }: SessionReportModalProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const det = detections[activeIdx] ?? null;

  const confirmed = detections.filter(d => d.status === 'confirmed' || d.status === 'analyzed').length;
  const ignored   = detections.filter(d => d.status === 'ignored').length;

  return (
    <MuiDialog
      open
      onClose={onClose}
      maxWidth={false}
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: '20px', overflow: 'hidden', width: '92vw', maxWidth: 1140, maxHeight: '88vh' } } }}
    >
      <MuiDialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', height: '88vh', maxHeight: 760 }}>

        {/* ── Header ── */}
        <Box sx={{ px: 3, py: 2, borderBottom: '1px solid #EEF2F0', display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: '10px', backgroundColor: 'rgba(46,125,50,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <CheckCircle2 size={20} color="#2E7D32" />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: 'text.primary', lineHeight: 1.2 }}>
              Phiên phân tích hoàn tất
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.3 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {detections.length} tổn thương
              </Typography>
              <Box sx={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: 'text.disabled' }} />
              <Typography variant="caption" sx={{ color: '#059669', fontWeight: 600 }}>{confirmed} xác nhận</Typography>
              <Box sx={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: 'text.disabled' }} />
              <Typography variant="caption" sx={{ color: '#9AA5B1' }}>{ignored} bỏ qua</Typography>
            </Box>
          </Box>
          <Box component="button" onClick={onClose} sx={{ background: 'none', border: 'none', cursor: 'pointer', p: 0.75, borderRadius: '8px', '&:hover': { backgroundColor: '#F0F4F3' } }}>
            <X size={18} color="#9AA5B1" />
          </Box>
        </Box>

        {/* ── Body: left list + right detail ── */}
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left: detection list */}
          <Box sx={{ width: 260, flexShrink: 0, borderRight: '1px solid #EEF2F0', overflowY: 'auto', backgroundColor: '#FAFCFB' }}>
            {detections.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center', color: 'text.disabled', pt: 6 }}>
                <ScanSearch size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                <Typography variant="caption" sx={{ display: 'block' }}>Không có tổn thương</Typography>
              </Box>
            ) : detections.map((d, i) => {
              const sc = STATUS_CONFIG[d.status ?? 'detected'];
              const isActive = i === activeIdx;
              return (
                <Box
                  key={`${d.timestamp}-${i}`}
                  onClick={() => setActiveIdx(i)}
                  sx={{
                    display: 'flex', gap: 1.5, px: 1.5, py: 1.25,
                    borderBottom: '1px solid #EEF2F0',
                    cursor: 'pointer',
                    backgroundColor: isActive ? 'rgba(0,96,100,0.06)' : 'transparent',
                    borderLeft: isActive ? '3px solid #006064' : '3px solid transparent',
                    transition: 'all 0.12s',
                    '&:hover': { backgroundColor: isActive ? 'rgba(0,96,100,0.06)' : 'rgba(0,0,0,0.03)' },
                  }}
                >
                  {/* Thumbnail */}
                  <Box sx={{ width: 52, height: 40, borderRadius: '7px', overflow: 'hidden', flexShrink: 0, backgroundColor: '#0D1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {d.frame_b64
                      ? <img src={`data:image/jpeg;base64,${d.frame_b64}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <ScanSearch size={14} color="rgba(255,255,255,0.2)" />}
                  </Box>
                  {/* Info */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.label}
                    </Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', fontFamily: 'monospace' }}>
                      {fmtTimestamp(d.timestamp)}
                    </Typography>
                    {/* Status badge */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, mt: 0.4 }}>
                      <Box sx={{ color: sc.color }}>{sc.icon}</Box>
                      <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: sc.color }}>{sc.label}</Typography>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Right: detection detail */}
          {det ? (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, overflow: 'hidden' }}>

              {/* Frame */}
              <Box sx={{ flex: '0 0 48%', backgroundColor: '#0A0F16', position: 'relative', minHeight: { xs: 200, md: 'auto' } }}>
                {det.frame_b64 ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:image/jpeg;base64,${det.frame_b64}`} alt="frame" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                    <Box sx={{ position: 'absolute', left: `${det.bbox.x}%`, top: `${det.bbox.y}%`, width: `${det.bbox.width}%`, height: `${det.bbox.height}%`, border: '2px solid #F59E0B', borderRadius: '4px', boxShadow: '0 0 0 1px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
                    <Box sx={{ position: 'absolute', left: `${det.bbox.x}%`, top: `calc(${det.bbox.y}% - 26px)`, display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.3, borderRadius: '5px', backgroundColor: 'rgba(0,0,0,0.7)', border: '1px solid rgba(245,158,11,0.4)', pointerEvents: 'none' }}>
                      <Zap size={9} color="#F59E0B" />
                      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#FCD34D', whiteSpace: 'nowrap' }}>{det.label}</Typography>
                    </Box>
                  </>
                ) : (
                  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, background: 'radial-gradient(ellipse at 50% 40%, rgba(0,96,100,0.1) 0%, transparent 70%)' }}>
                    <Box sx={{ width: 60, height: 60, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ScanSearch size={26} color="rgba(255,255,255,0.18)" />
                    </Box>
                    <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.25)' }}>Không có khung hình</Typography>
                  </Box>
                )}
                {/* Status overlay */}
                {(() => { const sc = STATUS_CONFIG[det.status ?? 'detected']; return (
                  <Box sx={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: 0.6, px: 1.25, py: 0.5, borderRadius: '7px', backgroundColor: sc.bg, border: `1px solid ${sc.color}30`, backdropFilter: 'blur(8px)' }}>
                    <Box sx={{ color: sc.color }}>{sc.icon}</Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: sc.color }}>{sc.label}</Typography>
                  </Box>
                ); })()}
              </Box>

              {/* Detail panel */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', p: 3, gap: 2 }}>
                <Box>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#006064', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.5 }}>Kết quả phát hiện</Typography>
                  <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, color: 'text.primary', lineHeight: 1.3 }}>{det.label}</Typography>
                </Box>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  <Chip icon={<Clock size={11} />} label={fmtTimestamp(det.timestamp)} size="small" sx={{ backgroundColor: 'rgba(0,0,0,0.04)', color: 'text.secondary', fontSize: '0.76rem', fontFamily: 'monospace', borderRadius: '7px', height: 26, '& .MuiChip-icon': { color: 'text.disabled' } }} />
                  <Chip label={`${(det.confidence * 100).toFixed(0)}% tin cậy`} size="small" sx={{ backgroundColor: 'rgba(0,0,0,0.04)', color: 'text.secondary', fontWeight: 600, fontSize: '0.76rem', borderRadius: '7px', height: 26 }} />
                </Box>

                <Divider />

                {det.lesionReport ? (
                  <Box>
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.25 }}>Phân tích AI</Typography>
                    <DisclaimerBanner />
                    <LesionReportCard report={det.lesionReport} />
                  </Box>
                ) : det.llmInsight ? (
                  <Box>
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.25 }}>Phân tích AI</Typography>
                    <Box sx={{
                      fontSize: '0.86rem', lineHeight: 1.75, color: 'text.primary',
                      '& p': { margin: '0 0 8px' }, '& p:last-child': { marginBottom: 0 },
                      '& strong': { fontWeight: 700, color: '#004D40' },
                      '& ul, & ol': { pl: '1rem', margin: '3px 0 8px' },
                      '& li': { mb: '3px', listStyleType: 'none', pl: 0 },
                      '& li input[type="checkbox"]': { mr: '6px', accentColor: '#006064', width: 12, height: 12, verticalAlign: 'middle' },
                      '& h1,& h2,& h3': { fontSize: '0.86rem', fontWeight: 700, color: '#004D40', margin: '7px 0 3px' },
                      '& code': { backgroundColor: 'rgba(0,96,100,0.08)', borderRadius: '4px', px: '4px', fontSize: '0.78rem' },
                    }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{det.llmInsight}</ReactMarkdown>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ py: 2, color: 'text.disabled', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Bot size={16} />
                    <Typography sx={{ fontSize: '0.82rem' }}>
                      {det.status === 'ignored' ? 'Tổn thương đã bỏ qua — không có phân tích LLM.' : 'Chưa có phân tích LLM.'}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          ) : (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
              <Typography variant="caption">Chọn một tổn thương để xem chi tiết</Typography>
            </Box>
          )}
        </Box>

        {/* ── Footer ── */}
        <Box sx={{ px: 3, py: 2, borderTop: '1px solid #EEF2F0', display: 'flex', gap: 1.5, flexShrink: 0, justifyContent: 'flex-end' }}>
          <MuiButton variant="outlined" startIcon={<RefreshCw size={15} />} onClick={onRestart} sx={{ borderRadius: '10px', fontWeight: 700 }}>
            Phân tích lại
          </MuiButton>
          <MuiButton
            variant="contained"
            disabled={isNavigating}
            startIcon={isNavigating ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <ClipboardList size={16} />}
            onClick={onGoReport}
            sx={{ borderRadius: '10px', fontWeight: 700, backgroundColor: '#006064', '&:hover': { backgroundColor: '#004D51' } }}
          >
            {isNavigating ? 'Đang tạo...' : 'Tạo báo cáo đầy đủ'}
          </MuiButton>
        </Box>
      </MuiDialogContent>
    </MuiDialog>
  );
}

// ── Detection action bar (shared across video / live / library views) ────────

interface DetectionBarProps {
  detection: Detection;
  llmInsight: string;
  voiceSupported: boolean;
  isVoiceListening: boolean;
  onExplain: () => void;
  onIgnore: () => void;
  onConfirm: () => void;
  // Phase D — 3 doctor actions exposed during the pre-LLM review window.
  onQuickConfirm: () => void;       // skip Giải thích, mark confirmed, resume
  onReportFalsePositive: () => void; // persist (label+bbox) for cross-session auto-skip
  onRecheck: () => void;             // re-run YOLO on this frame at lower conf
}

// Shared button styling factory — keeps the row visually consistent and
// makes color the only thing that varies per action.
function actionBtnSx(bg: string, hoverBg: string, text: string = '#000') {
  return {
    borderRadius: '7px',
    backgroundColor: bg,
    color: text,
    fontWeight: 700,
    fontSize: '0.72rem',
    py: 0.4, px: 1,
    whiteSpace: 'nowrap',
    minWidth: 0,
    '&:hover': { backgroundColor: hoverBg },
  };
}

function DetectionBar({
  detection, llmInsight, voiceSupported, isVoiceListening,
  onExplain, onIgnore, onConfirm,
  onQuickConfirm, onReportFalsePositive, onRecheck,
}: DetectionBarProps) {
  return (
    <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 4, px: 2, py: 1.25, backdropFilter: 'blur(14px)', backgroundColor: 'rgba(13,17,23,0.82)', borderTop: '1px solid rgba(245,158,11,0.25)', display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: 1, minWidth: 0 }}>
        <AlertTriangle size={14} color="#F59E0B" />
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#FCD34D', whiteSpace: 'nowrap' }}>{detection.label}</Typography>
        <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.55)' }}>{(detection.confidence * 100).toFixed(0)}%</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.38)', fontFamily: 'monospace', ml: 0.25 }}>
          @ {fmtTimestamp(detection.timestamp)}
        </Typography>
      </Box>
      {voiceSupported && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: isVoiceListening ? '#4FC3F7' : 'rgba(255,255,255,0.35)' }}>
          {isVoiceListening ? <Mic size={14} /> : <MicOff size={14} />}
          {isVoiceListening && <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)', maxWidth: 140 }}>đang nghe…</Typography>}
        </Box>
      )}
      {llmInsight ? (
        // Post-LLM: doctor read the AI report — only Confirm / Ignore matter now.
        <>
          <MuiButton size="small" variant="contained" onClick={onConfirm}
            sx={actionBtnSx('rgba(34,197,94,0.85)', '#16A34A')}>Xác nhận</MuiButton>
          <MuiButton size="small" variant="outlined" onClick={onIgnore}
            sx={{ borderRadius: '7px', borderColor: 'rgba(255,255,255,0.2)', color: '#fff', fontWeight: 600, fontSize: '0.72rem', py: 0.4, px: 1, whiteSpace: 'nowrap', '&:hover': { borderColor: '#EF4444', color: '#FCA5A5' } }}>Bỏ qua</MuiButton>
        </>
      ) : (
        // Pre-LLM: 2 primary text-buttons (Giải thích / Xác nhận luôn) + 3
        // secondary icon-only buttons (Kiểm tra lại / Báo sai / Bỏ qua).
        // Icons keep the bar compact and let primary actions stay visually dominant.
        <>
          <MuiButton size="small" variant="contained" onClick={onExplain}
            startIcon={<Sparkles size={12} />}
            sx={actionBtnSx('rgba(2,119,189,0.9)', '#0277BD', '#fff')}>Giải thích</MuiButton>
          <MuiButton size="small" variant="contained" onClick={onQuickConfirm}
            startIcon={<CheckCircle2 size={12} />}
            sx={actionBtnSx('rgba(34,197,94,0.85)', '#16A34A')}>Xác nhận luôn</MuiButton>

          {/* Divider between primary and secondary actions */}
          <Box sx={{ width: '1px', height: 18, backgroundColor: 'rgba(255,255,255,0.15)', mx: 0.25 }} />

          <Tooltip title="Kiểm tra lại — AI dò thêm với ngưỡng thấp hơn" arrow>
            <IconButton size="small" onClick={onRecheck}
              aria-label="Kiểm tra lại với ngưỡng thấp hơn"
              sx={{ color: 'rgba(216,180,254,0.85)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '7px', p: 0.6, '&:hover': { backgroundColor: 'rgba(168,85,247,0.15)', borderColor: '#A855F7' } }}>
              <RefreshCw size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Báo sai — đánh dấu false positive (persist)" arrow>
            <IconButton size="small" onClick={onReportFalsePositive}
              aria-label="Báo false positive (lưu lâu dài)"
              sx={{ color: 'rgba(252,165,165,0.9)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '7px', p: 0.6, '&:hover': { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: '#EF4444' } }}>
              <Flag size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Bỏ qua — chỉ session hiện tại" arrow>
            <IconButton size="small" onClick={onIgnore}
              aria-label="Bỏ qua detection trong session hiện tại"
              sx={{ color: 'rgba(252,211,77,0.85)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '7px', p: 0.6, '&:hover': { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: '#F59E0B' } }}>
              <X size={14} />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Box>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Workspace() {
  const router = useRouter();

  const {
    isPlaying,
    isConnected,
    pipelineState,
    videoId,
    currentDetection,
    isListeningVoice,
    llmInsight,
    detections,
    sessions,
    currentSessionId,
    startMockAnalysis,
    resetPipeline,
    ignoreDetection,
    explainMore,
    followUpChat,
    confirmDetection,
    quickConfirm,
    reportFalsePositive,
    recheck,
    sendSessionQA,
    lastError,
    dismissError,
    uploadOnly,
    prepareFromLibrary,
    connectLive,
    selectFromLibrary,
    resetAnalysis,
  } = useAnalysis();

  // Phase B — pull the active session's Phase B state (summary + chat).
  const currentSession = sessions.find((s) => s.id === currentSessionId);

  // Source mode
  const [sourceMode, setSourceMode] = useState<'video' | 'live'>('video');
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [liveSource, setLiveSource] = useState('');
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);

  // Local video state (object URL for <video> preview)
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoUnsupported, setVideoUnsupported] = useState(false);
  // True when a library video is prepared (video_id set) but analysis not yet started
  const [libraryReady, setLibraryReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [transcriptLog, setTranscriptLog] = useState<{ text: string; ts: number }[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const prevBackendReachable = useRef<boolean | null>(null);
  const [backendJustCameBack, setBackendJustCameBack] = useState(false);

  // Health check on mount and every 10s when not connected
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
        const ok = res.ok;
        // Detect offline → online transition
        if (ok && prevBackendReachable.current === false) {
          setBackendJustCameBack(true);
        }
        prevBackendReachable.current = ok;
        setBackendReachable(ok);
      } catch {
        prevBackendReachable.current = false;
        setBackendReachable(false);
        setBackendJustCameBack(false);
      }
    };
    check();
    const id = setInterval(() => { if (!isConnected) check(); }, 10000);
    return () => clearInterval(id);
  }, [isConnected]);

  // On mount: if context still holds a stale PLAYING/PAUSED state from a previous
  // navigation but there's no actual video source here, reset to IDLE.
  useEffect(() => {
    if (pipelineState !== 'IDLE' && pipelineState !== 'EOS_SUMMARY' && !isConnected) {
      resetPipeline();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  // When videoId is cleared (e.g. "Session not found" error), reset library state
  // so the picker shows instead of a broken panel with no session.
  useEffect(() => {
    if (!videoId) {
      if (libraryReady) setLibraryReady(false);
      // Clear backend stream URLs (not blob: object URLs managed separately)
      if (videoUrl && !videoUrl.startsWith('blob:')) {
        setVideoUrl(null);
        setVideoFile(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Pause/resume the local video preview in sync with pipeline state.
  useEffect(() => {
    if (!videoRef.current || !videoUrl) return;
    if (pipelineState === 'PAUSED_WAITING_INPUT' || pipelineState === 'PROCESSING_LLM' || pipelineState === 'EOS_SUMMARY') {
      videoRef.current.pause();
    } else if (pipelineState === 'PLAYING') {
      videoRef.current.play().catch(() => {});
    }
  }, [pipelineState, videoUrl]);

  // SEEK video to detection timestamp on every new detection. This eliminates
  // any backend↔frontend drift accumulated over multiple pause-resume cycles —
  // user always sees the EXACT frame the AI flagged (matches the bbox & label),
  // not the frame the browser happened to be playing when the WS event arrived.
  useEffect(() => {
    if (!videoRef.current || !videoUrl || !currentDetection) return;
    if (pipelineState !== 'PAUSED_WAITING_INPUT') return;
    const targetTime = currentDetection.timestamp;
    // Only seek if drift > 100ms — avoids constant micro-seeks for in-sync events.
    if (Math.abs(videoRef.current.currentTime - targetTime) > 0.1) {
      videoRef.current.currentTime = targetTime;
    }
  }, [currentDetection, pipelineState, videoUrl]);

  // Refs so onIntent callback always reads current state without stale closure
  const pipelineStateRef = useRef(pipelineState);
  pipelineStateRef.current = pipelineState;
  const llmInsightRef = useRef(llmInsight);
  llmInsightRef.current = llmInsight;

  const { isListening: isVoiceListening, audioLevel, supported: voiceSupported, micError, startListening, stopListening } =
    useVoiceControl({
      onIntent: useCallback((intent: import('@/hooks/use-voice-control').VoiceIntent, transcript: string) => {
        console.log("[Workspace] onIntent:", { intent, transcript, pipelineState: pipelineStateRef.current });
        if (transcript) {
          setTranscriptLog(prev => [...prev, { text: transcript, ts: Date.now() }]);
          transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        // Only act on commands when the pipeline is waiting for a response
        if (pipelineStateRef.current !== 'PAUSED_WAITING_INPUT') {
          console.log("[Workspace] Ignoring intent — pipelineState not PAUSED_WAITING_INPUT");
          return;
        }
        if (intent === 'BO_QUA') ignoreDetection();
        else if (intent === 'GIAI_THICH') explainMore();
        else if (intent === 'XAC_NHAN') confirmDetection();
        else if (intent === 'UNKNOWN' && llmInsightRef.current) followUpChat(transcript);
      }, [ignoreDetection, explainMore, confirmDetection, followUpChat]),
    });

  // Auto-activate mic when pipeline pauses on a detection (hands-free workflow)
  useEffect(() => {
    if (pipelineState === 'PAUSED_WAITING_INPUT' && voiceSupported && !isVoiceListening) {
      startListening();
    }
  }, [pipelineState, voiceSupported, isVoiceListening, startListening]);

  /** Upload only — modal stays open with progress bar; background keeps VideoPickerTriggerZone.
   *  Video is shown in the player only after upload finishes and modal closes. */
  const handleUploadAndConnect = useCallback(async (file: File, onProgress: (pct: number) => void) => {
    await uploadOnly(file, onProgress);
    const localUrl = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(localUrl);
    setVideoUnsupported(false);
    setLibraryReady(false);
  }, [uploadOnly]);

  const handleLiveConnect = useCallback(async () => {
    if (!liveSource.trim()) return;
    setIsLiveConnecting(true);
    try {
      await connectLive(liveSource.trim());
      if (voiceSupported) startListening();
    } catch (err) {
      console.warn('[workspace] live connect failed:', err);
    } finally {
      setIsLiveConnecting(false);
    }
  }, [liveSource, connectLive, voiceSupported, startListening]);

  const handleStop = useCallback(() => {
    stopListening();
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
    setTranscriptLog([]);
    setLibraryReady(false);
    resetAnalysis();
  }, [stopListening, resetAnalysis]);

  const handleLibrarySelectFromModal = useCallback(async (libraryId: string, localFile?: File, filename?: string) => {
    try {
      const vid = await prepareFromLibrary(libraryId, filename ?? localFile?.name);
      if (localFile) {
        const localUrl = URL.createObjectURL(localFile);
        setVideoFile(localFile);
        setVideoUrl(localUrl);
        setVideoUnsupported(false);
        setLibraryReady(false);
      } else {
        // Stream library video from backend so browser can play it like an uploaded file
        setVideoUrl(`${API_BASE}/session/${vid}/video`);
        setVideoFile(null);
        setVideoUnsupported(false);
        setLibraryReady(true);  // keeps "Video từ thư viện" label in header
      }
    } catch (err) {
      console.warn('[workspace] library prepare failed:', err);
    }
  }, [prepareFromLibrary]);

  const handleRemoveVideo = useCallback(() => {
    if (videoRef.current) videoRef.current.pause();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl(null);
    setLibraryReady(false);
    setTranscriptLog([]);
    resetAnalysis();
  }, [videoUrl, resetAnalysis]);

  // ── Status badge config ────────────────────────────────────────────────────

  const statusConfig =
    pipelineState === 'PLAYING' && (videoUrl || libraryReady || isConnected)
      ? { text: (isConnected && sourceMode === 'live') ? 'Đang phân tích (Live)' : 'Đang phân tích', color: '#4CAF50', bg: 'rgba(46,125,50,0.1)', textColor: '#2E7D32' }
      : pipelineState === 'PAUSED_WAITING_INPUT'
        ? { text: 'AI phát hiện bất thường', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', textColor: '#D97706' }
        : pipelineState === 'PROCESSING_LLM'
          ? { text: 'Đang phân tích LLM', color: '#0277BD', bg: 'rgba(2,119,189,0.1)', textColor: '#0277BD' }
          : pipelineState === 'EOS_SUMMARY'
            ? { text: 'Hoàn tất', color: '#2E7D32', bg: 'rgba(46,125,50,0.08)', textColor: '#2E7D32' }
            : videoUrl
              ? { text: isConnected ? 'Đã kết nối BE' : 'Video đã tải', color: '#006064', bg: 'rgba(0,96,100,0.1)', textColor: '#006064' }
              : { text: 'Chờ video', color: '#9AA5B1', bg: 'rgba(154,165,177,0.1)', textColor: '#4A5568' };

  return (
    <Box sx={{ minHeight: 'calc(100vh - 130px)', py: 3, px: { xs: 1.5, lg: 3 }, backgroundColor: 'background.default' }}>
      <Box sx={{ maxWidth: '1440px', mx: 'auto' }}>

        {/* Session top bar — ported from new-theme/workspace.jsx SessionTopBar.
            Left: page title + active video/session label. Middle: pipeline
            state pill with pulsing dot (greens when streaming, orange when
            paused on detection, etc). Right: future slot for voice/settings. */}
        <Box
          sx={{
            mb: 3, px: 2.5, py: 1.75,
            borderRadius: '12px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2EAE9',
            boxShadow: '0 1px 2px rgba(13,27,42,0.04)',
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
          }}
        >
          <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.12em',
                color: '#6E7C7B', textTransform: 'uppercase', mb: 0.25,
              }}
            >
              WORKSPACE PHÂN TÍCH
            </Typography>
            <Typography
              sx={{
                fontSize: '1.05rem', fontWeight: 700, color: '#222B2A',
                lineHeight: 1.3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {videoFile?.name ?? (libraryReady
                ? 'Video từ thư viện'
                : sourceMode === 'live'
                  ? (isConnected ? `Live: ${liveSource}` : 'Live stream — chờ kết nối')
                  : 'Chưa chọn video')}
            </Typography>
          </Box>

          {/* Pipeline state pill */}
          <Box
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75,
              px: 1.5, py: 0.75,
              borderRadius: '999px',
              backgroundColor: statusConfig.bg,
              border: `1px solid ${statusConfig.color}40`,
              color: statusConfig.textColor,
              fontSize: '0.78rem', fontWeight: 600,
              flexShrink: 0,
            }}
          >
            <Box
              sx={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: statusConfig.color,
                boxShadow: `0 0 0 3px ${statusConfig.color}33`,
                animation: (pipelineState === 'PLAYING' || pipelineState === 'PROCESSING_LLM')
                  ? 'workspacePulseDot 1.6s ease-in-out infinite' : 'none',
                '@keyframes workspacePulseDot': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.45 },
                },
              }}
            />
            {statusConfig.text}
          </Box>
        </Box>

        {/* Backend offline banner */}
        {backendReachable === false && (
          <Box sx={{ mb: 2, px: 2, py: 1.25, borderRadius: '12px', backgroundColor: 'rgba(211,47,47,0.08)', border: '1px solid rgba(211,47,47,0.3)', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <AlertTriangle size={16} color="#D32F2F" />
            <Typography sx={{ fontSize: '0.85rem', color: '#D32F2F', fontWeight: 500, flex: 1 }}>
              Backend offline ({(process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8001')}). Đang chờ kết nối lại…
            </Typography>
          </Box>
        )}

        {/* Backend came back online — offer to reconnect without page reload */}
        {backendJustCameBack && !isConnected && videoFile && (
          <Box sx={{ mb: 2, px: 2, py: 1.25, borderRadius: '12px', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <AlertTriangle size={16} color="#D97706" />
            <Typography sx={{ fontSize: '0.85rem', color: '#92400E', fontWeight: 500, flex: 1 }}>
              Backend đã khởi động lại — session cũ bị mất.
            </Typography>
            <MuiButton
              size="small"
              variant="contained"
              onClick={async () => {
                setBackendJustCameBack(false);
                resetAnalysis();
                setTranscriptLog([]);
                if (videoUrl) URL.revokeObjectURL(videoUrl);
                setVideoUrl(null);
                if (videoFile) await handleUploadAndConnect(videoFile, () => {});
              }}
              sx={{ borderRadius: '8px', backgroundColor: '#D97706', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap', '&:hover': { backgroundColor: '#B45309' } }}
            >
              Phân tích lại
            </MuiButton>
            <MuiButton
              size="small"
              onClick={() => setBackendJustCameBack(false)}
              sx={{ borderRadius: '8px', color: '#92400E', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap' }}
            >
              Bỏ qua
            </MuiButton>
          </Box>
        )}

        {/* ── Session Report Modal (replaces the small EOS dialog) ── */}
        {pipelineState === 'EOS_SUMMARY' && (
          <SessionReportModal
            detections={detections}
            onClose={() => {
              stopListening();
              setTranscriptLog([]);
              if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
              resetPipeline();
            }}
            onRestart={() => {
              stopListening();
              setTranscriptLog([]);
              if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
              resetPipeline();
            }}
            onGoReport={() => {
              setIsNavigating(true);
              router.push('/report');
            }}
            isNavigating={isNavigating}
          />
        )}

        {/* Phase C1 — LLM error banner. Only renders when there's an active
            error (timeout / crash / unavailable / bad JSON). Doctor clicks ×
            to dismiss. Auto-clears when a fresh LLM event arrives. */}
        {lastError && (
          <Box sx={{
            mb: 2, px: 2, py: 1.25, borderRadius: '12px',
            backgroundColor: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.3)',
            display: 'flex', alignItems: 'flex-start', gap: 1,
          }}>
            <AlertTriangle size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: 2 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#991B1B', mb: 0.25 }}>
                Lỗi AI {lastError.code ? `(${lastError.code})` : ''}
              </Typography>
              <Typography sx={{ fontSize: '0.78rem', color: '#7F1D1D', lineHeight: 1.5 }}>
                {lastError.message}
              </Typography>
            </Box>
            <IconButton size="small" onClick={dismissError} sx={{ color: '#991B1B' }}>
              <X size={14} />
            </IconButton>
          </Box>
        )}

        <Grid container spacing={3}>

          {/* ── Video Panel ────────────────────────────────────────────────── */}
          <Grid size={{ xs: 12, lg: 8 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
            <Box
              sx={{
                backgroundColor: 'background.paper',
                borderRadius: '20px',
                border: '1px solid #E2EAE8',
                boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
                overflow: 'hidden',
              }}
            >
              {/* Panel header */}
              <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid #E2EAE8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.25 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
                      Luồng video nội soi
                    </Typography>
                    <ToggleButtonGroup
                      value={sourceMode}
                      exclusive
                      size="small"
                      onChange={(_, v) => { if (v && v !== sourceMode) { resetAnalysis(); setVideoFile(null); setVideoUrl(null); setSourceMode(v); } }}
                      sx={{ '& .MuiToggleButton-root': { py: 0.3, px: 1.25, fontSize: '0.72rem', fontWeight: 600, textTransform: 'none', borderRadius: '6px !important', border: '1px solid #E2EAE8 !important', '&.Mui-selected': { backgroundColor: 'rgba(0,96,100,0.1)', color: '#006064' } } }}
                    >
                      <ToggleButton value="video"><FileVideo size={12} style={{ marginRight: 4 }} />Tải video</ToggleButton>
                      <ToggleButton value="live"><Wifi size={12} style={{ marginRight: 4 }} />Trực tiếp</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  {sourceMode === 'video' ? (
                    videoFile ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <FileVideo size={12} color="#006064" />
                        <Typography variant="caption" sx={{ color: '#006064', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                          {videoFile.name}
                        </Typography>
                        <Typography variant="caption" color="textDisabled">
                          · {(videoFile.size / 1024 / 1024).toFixed(1)} MB
                        </Typography>
                      </Box>
                    ) : libraryReady ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <FileVideo size={12} color="#006064" />
                        <Typography variant="caption" sx={{ color: '#006064', fontWeight: 600 }}>
                          Video từ thư viện
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="caption" color="textSecondary">Nhấn để chọn file hoặc chọn từ thư viện</Typography>
                    )
                  ) : (
                    <Typography variant="caption" color="textSecondary">
                      {isConnected ? `Đang kết nối: ${liveSource}` : 'Nhập địa chỉ RTSP hoặc thiết bị V4L2'}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  {(videoUrl || libraryReady) && (
                    <MuiButton
                      size="small"
                      onClick={handleRemoveVideo}
                      startIcon={<CircleX size={14} />}
                      sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.8rem', textTransform: 'none', borderRadius: '8px', '&:hover': { color: '#DC2626', backgroundColor: 'rgba(220,38,38,0.06)' } }}
                    >
                      Xóa
                    </MuiButton>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.5, borderRadius: '20px', backgroundColor: statusConfig.bg, flexShrink: 0 }}>
                    <StatusDot color={statusConfig.color} />
                    <Typography variant="caption" sx={{ fontWeight: 600, color: statusConfig.textColor, whiteSpace: 'nowrap' }}>
                      {statusConfig.text}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Video content area */}
              <Box sx={{ p: 1.5 }}>
                {sourceMode === 'live' && !isConnected ? (
                  <LiveInputZone value={liveSource} onChange={setLiveSource} onConnect={handleLiveConnect} isConnecting={isLiveConnecting} />
                ) : sourceMode === 'live' && isConnected ? (
                  <VideoContainer>
                    <LiveStreamPanel source={liveSource} pipelineState={pipelineState} />
                    {pipelineState === 'PAUSED_WAITING_INPUT' && currentDetection && (
                      <DetectionBar detection={currentDetection} llmInsight={llmInsight} voiceSupported={voiceSupported} isVoiceListening={isVoiceListening} onExplain={explainMore} onIgnore={ignoreDetection} onConfirm={confirmDetection} onQuickConfirm={quickConfirm} onReportFalsePositive={reportFalsePositive} onRecheck={() => recheck(0.4)} />
                    )}
                  </VideoContainer>
                ) : libraryReady && !videoUrl && pipelineState === 'IDLE' ? (
                  /* Library selected but videoUrl not ready yet (fetch in-flight) */
                  <LibraryReadyPanel onReselect={() => setIsSourceModalOpen(true)} />
                ) : libraryReady && !videoUrl ? (
                  /* Library video active but stream URL not yet set — show spinner fallback */
                  <VideoContainer>
                    {currentDetection?.frame_b64 ? (
                      <Box
                        component="img"
                        src={`data:image/jpeg;base64,${currentDetection.frame_b64}`}
                        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 1 }}
                      />
                    ) : (
                      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, zIndex: 1 }}>
                        <CircularProgress size={32} thickness={3} sx={{ color: '#006064' }} />
                        <Typography sx={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.45)' }}>Đang phân tích video…</Typography>
                      </Box>
                    )}
                    {pipelineState === 'PAUSED_WAITING_INPUT' && currentDetection && (
                      <DetectionBar detection={currentDetection} llmInsight={llmInsight} voiceSupported={voiceSupported} isVoiceListening={isVoiceListening} onExplain={explainMore} onIgnore={ignoreDetection} onConfirm={confirmDetection} onQuickConfirm={quickConfirm} onReportFalsePositive={reportFalsePositive} onRecheck={() => recheck(0.4)} />
                    )}
                    {currentDetection && (() => {
                      const _c = bboxColorFor(currentDetection.label);
                      const _flip = currentDetection.bbox.y < 6;
                      return (
                        <BboxOverlay
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.2 }}
                          sx={{
                            zIndex: 2,
                            left: `${currentDetection.bbox.x}%`,
                            top: `${currentDetection.bbox.y}%`,
                            width: `${currentDetection.bbox.width}%`,
                            height: `${currentDetection.bbox.height}%`,
                            borderColor: _c,
                            backgroundColor: rgba(_c, 0.12),
                          }}
                        >
                          <DetectionLabelChip
                            label={currentDetection.label}
                            confidence={currentDetection.confidence}
                            timestamp={fmtTimestamp(currentDetection.timestamp)}
                            color={_c}
                            flipBelow={_flip}
                          />
                        </BboxOverlay>
                      );
                    })()}
                  </VideoContainer>
                ) : videoUrl ? (
                  // Real video player with detection overlay — controls disabled so the user
                  // cannot pause/seek midway. Backend pipeline is authoritative: video plays
                  // only when pipelineState=PLAYING and pauses on AI detection. User-driven
                  // pause would desync frontend video time from backend detection timeline.
                  <VideoContainer>
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      controlsList="nodownload nofullscreen noremoteplayback"
                      disablePictureInPicture
                      onContextMenu={(e) => e.preventDefault()}
                      onError={() => setVideoUnsupported(true)}
                      onCanPlay={() => setVideoUnsupported(false)}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        zIndex: 1,
                        opacity: videoUnsupported ? 0 : 1,
                        pointerEvents: 'none',  // block click-to-pause + scrub
                      }}
                    />
                    {videoUnsupported && (
                      <Box sx={{
                        position: 'absolute', inset: 0, zIndex: 2,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 1,
                        bgcolor: 'rgba(0,0,0,0.85)',
                      }}>
                        <Typography sx={{ color: '#FFA726', fontWeight: 700, fontSize: '0.95rem' }}>
                          Trình duyệt không hỗ trợ xem trước video này
                        </Typography>
                        <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', textAlign: 'center', px: 2 }}>
                          Codec {videoFile?.name?.endsWith('.mp4') ? 'MPEG-4 Part 2' : ''} không được hỗ trợ trong trình duyệt.
                          Phân tích AI vẫn chạy bình thường — hãy dùng H.264 để xem trước.
                        </Typography>
                      </Box>
                    )}
                    {pipelineState === 'PAUSED_WAITING_INPUT' && currentDetection && (
                      <DetectionBar detection={currentDetection} llmInsight={llmInsight} voiceSupported={voiceSupported} isVoiceListening={isVoiceListening} onExplain={explainMore} onIgnore={ignoreDetection} onConfirm={confirmDetection} onQuickConfirm={quickConfirm} onReportFalsePositive={reportFalsePositive} onRecheck={() => recheck(0.4)} />
                    )}

                    {/* AI bbox overlay on top of video */}
                    {currentDetection && (() => {
                      const _c = bboxColorFor(currentDetection.label);
                      const _flip = currentDetection.bbox.y < 6;
                      return (
                        <BboxOverlay
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.2 }}
                          sx={{
                            zIndex: 2,
                            left: `${currentDetection.bbox.x}%`,
                            top: `${currentDetection.bbox.y}%`,
                            width: `${currentDetection.bbox.width}%`,
                            height: `${currentDetection.bbox.height}%`,
                            borderColor: _c,
                            backgroundColor: rgba(_c, 0.12),
                          }}
                        >
                          <DetectionLabelChip
                            label={currentDetection.label}
                            confidence={currentDetection.confidence}
                            timestamp={fmtTimestamp(currentDetection.timestamp)}
                            color={_c}
                            flipBelow={_flip}
                          />
                        </BboxOverlay>
                      );
                    })()}
                  </VideoContainer>
                ) : (
                  <VideoPickerTriggerZone onClick={() => setIsSourceModalOpen(true)} />
                )}
              </Box>
            </Box>

            {/* ── Voice / Whisper Transcript Panel ──────────────────────────── */}
            <Box
              sx={{
                backgroundColor: 'background.paper',
                borderRadius: '16px',
                border: '1px solid #E2EAE8',
                boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
                overflow: 'hidden',
              }}
            >
              <Box sx={{ px: 2.5, py: 1.25, borderBottom: '1px solid #E2EAE8', display: 'flex', flexDirection: 'column', gap: 1, backgroundColor: '#F8FAFB' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, height: 28, borderRadius: '8px', backgroundColor: isVoiceListening ? 'rgba(2,119,189,0.12)' : 'rgba(154,165,177,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isVoiceListening ? '#0277BD' : '#9AA5B1', transition: 'all 0.2s' }}>
                    {isVoiceListening ? <Mic size={14} /> : <MicOff size={14} />}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', display: 'block' }}>
                      Voice Transcript
                    </Typography>
                    <Typography variant="caption" sx={{ color: micError ? '#EF4444' : 'text.secondary', fontSize: '0.7rem' }}>
                      {micError
                        ? `Lỗi mic: ${micError}`
                        : isVoiceListening
                          ? 'Đang nghe…'
                          : !voiceSupported
                            ? 'Trình duyệt không hỗ trợ SpeechRecognition'
                            : 'Bấm "Bắt đầu AI" để kích hoạt mic'}
                    </Typography>
                  </Box>
                </Box>
                {/* Audio level meter — single bar showing RMS amplitude */}
                <Box sx={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                  <Box sx={{
                    height: '100%',
                    borderRadius: 2,
                    width: `${audioLevel * 100}%`,
                    backgroundColor: audioLevel > 0.6 ? '#EF4444' : audioLevel > 0.25 ? '#22C55E' : '#9AA5B1',
                    transition: 'width 80ms linear, background-color 150ms',
                  }} />
                </Box>
              </Box>
              <Box sx={{ p: 2, maxHeight: 130, overflowY: 'auto' }}>
                {transcriptLog.length === 0 ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.disabled', py: 1 }}>
                    <MicOff size={14} />
                    <Typography variant="caption">
                      Chưa có transcript. Nói &quot;bỏ qua&quot; hoặc &quot;giải thích&quot; khi AI dừng.
                    </Typography>
                  </Box>
                ) : (
                  transcriptLog.map((entry, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 0.75, '&:last-child': { mb: 0 } }}>
                      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', fontFamily: 'monospace', flexShrink: 0 }}>
                        {new Date(entry.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </Typography>
                      <Box sx={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: '#0277BD', flexShrink: 0, mt: 0.5 }} />
                      <Typography sx={{ fontSize: '0.8rem', color: 'text.primary', lineHeight: 1.5 }}>
                        {entry.text}
                      </Typography>
                    </Box>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </Box>
            </Box>

            </Box>
          </Grid>

          {/* ── Control Panel ───────────────────────────────────────────────── */}
          <Grid size={{ xs: 12, lg: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, height: '100%' }}>

              {/* Upload / Playback controls */}
              <Box
                sx={{
                  backgroundColor: 'background.paper',
                  borderRadius: '16px',
                  border: '1px solid #E2EAE8',
                  boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
                  p: 2.5,
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: '0.05em', textTransform: 'uppercase', mb: 2, display: 'block' }}>
                  {(videoUrl || libraryReady) ? 'Điều khiển phân tích' : 'Tải video lên'}
                </Typography>

                {!videoUrl && !libraryReady ? (
                  /* Upload CTA when no video */
                  <MuiButton
                    variant="outlined"
                    fullWidth
                    startIcon={<UploadCloud size={18} />}
                    onClick={() => setIsSourceModalOpen(true)}
                    sx={{
                      borderRadius: '10px',
                      py: 1.5,
                      fontWeight: 700,
                      borderColor: '#006064',
                      color: '#006064',
                      '&:hover': { backgroundColor: 'rgba(0,96,100,0.06)', borderColor: '#004044' },
                    }}
                  >
                    Chọn file video
                  </MuiButton>
                ) : (
                  /* Playback controls after upload */
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <MuiButton
                      variant="contained"
                      fullWidth
                      disabled={pipelineState !== 'IDLE' || (libraryReady && !videoId)}
                      onClick={() => {
                        startMockAnalysis();
                        videoRef.current?.play().catch(() => {});
                        if (voiceSupported) startListening();
                      }}
                      startIcon={<Play size={17} />}
                      sx={{ borderRadius: '10px', py: 1.25, fontWeight: 700, fontSize: '0.875rem' }}
                    >
                      {isPlaying ? 'Đang phân tích…' : 'Bắt đầu phân tích AI'}
                    </MuiButton>
                    <MuiButton
                      variant="outlined"
                      fullWidth
                      disabled={!isPlaying && pipelineState === 'IDLE'}
                      onClick={handleStop}
                      startIcon={<Square size={17} />}
                      sx={{
                        borderRadius: '10px',
                        py: 1.25,
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        borderColor: '#E2EAE8',
                        color: 'text.secondary',
                        '&:hover': { borderColor: '#006064', color: 'primary.main', backgroundColor: 'rgba(0,96,100,0.04)' },
                      }}
                    >
                      Dừng hẳn
                    </MuiButton>
                  </Box>
                )}
              </Box>

              {/* ── AI Detection Notification ─────────────────────────────────
                  Pops up below the control panel when the pipeline pauses on a
                  detection. Mirrors the on-video DetectionBar but gives a calm
                  side-panel surface so the doctor can read details without the
                  bbox overlay obstruction. */}
              {currentDetection && (pipelineState === 'PAUSED_WAITING_INPUT' || pipelineState === 'PROCESSING_LLM') && (
                <MotionBox
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  sx={{
                    backgroundColor: '#FFFBEB',
                    borderRadius: '16px',
                    border: '1px solid rgba(245,158,11,0.4)',
                    boxShadow: '0 4px 16px rgba(245,158,11,0.18)',
                    overflow: 'hidden',
                    position: 'relative',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      top: 0, left: 0, right: 0,
                      height: 3,
                      background: 'linear-gradient(90deg, #F59E0B, #EF4444, #F59E0B)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 2s linear infinite',
                      '@keyframes shimmer': {
                        '0%':   { backgroundPosition: '0% 0%' },
                        '100%': { backgroundPosition: '200% 0%' },
                      },
                    },
                  }}
                >
                  {/* Header */}
                  <Box sx={{ px: 2.5, py: 1.75, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{
                      width: 38, height: 38, borderRadius: '10px',
                      backgroundColor: 'rgba(245,158,11,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#D97706', flexShrink: 0,
                      animation: 'pulseRing 1.6s ease-in-out infinite',
                      '@keyframes pulseRing': {
                        '0%, 100%': { boxShadow: '0 0 0 0 rgba(245,158,11,0.45)' },
                        '50%':      { boxShadow: '0 0 0 8px rgba(245,158,11,0)' },
                      },
                    }}>
                      <AlertTriangle size={20} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#92400E', letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.68rem', display: 'block' }}>
                        AI phát hiện bất thường
                      </Typography>
                      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: '#7C2D12', mt: 0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {currentDetection.label}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Meta info row */}
                  <Box sx={{ px: 2.5, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#92400E' }}>
                      <Zap size={12} />
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>
                        {(currentDetection.confidence * 100).toFixed(0)}%
                      </Typography>
                    </Box>
                    <Box sx={{ width: 1, height: 12, backgroundColor: 'rgba(146,64,14,0.25)' }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#92400E' }}>
                      <Clock size={12} />
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, fontFamily: 'monospace' }}>
                        {fmtTimestamp(currentDetection.timestamp)}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Action buttons.
                      Column layout because pre-LLM state stacks 2 rows
                      (primary CTAs + secondary icons). Post-LLM state uses
                      a row inside (2 buttons), so the wrapping flex-column
                      doesn't visually change the post-LLM look. */}
                  <Box sx={{ px: 2.5, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {llmInsight ? (
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <MuiButton
                          variant="contained" fullWidth size="small" onClick={confirmDetection}
                          sx={{ borderRadius: '8px', backgroundColor: '#16A34A', color: '#fff', fontWeight: 700, fontSize: '0.78rem', py: 0.85, boxShadow: '0 3px 10px rgba(22,163,74,0.3)', '&:hover': { backgroundColor: '#15803D' } }}
                        >
                          Xác nhận
                        </MuiButton>
                        <MuiButton
                          variant="outlined" fullWidth size="small" onClick={ignoreDetection}
                          sx={{ borderRadius: '8px', borderColor: 'rgba(146,64,14,0.3)', color: '#92400E', fontWeight: 700, fontSize: '0.78rem', py: 0.85, '&:hover': { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: '#D97706' } }}
                        >
                          Bỏ qua
                        </MuiButton>
                      </Box>
                    ) : pipelineState === 'PROCESSING_LLM' ? (
                      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 0.85, color: '#0277BD' }}>
                        <CircularProgress size={14} thickness={5} sx={{ color: '#0277BD' }} />
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600 }}>
                          LLM đang phân tích…
                        </Typography>
                      </Box>
                    ) : (
                      // Phase D — pre-LLM. Row 1: 2 primary CTAs full-width.
                      // Row 2: 3 icon tools centered. Column flex on the parent
                      // makes them stack vertically.
                      <>
                        <Box sx={{ display: 'flex', gap: 0.75 }}>
                          <MuiButton
                            variant="contained" fullWidth size="small" onClick={explainMore}
                            startIcon={<Sparkles size={13} />}
                            sx={{ borderRadius: '8px', backgroundColor: '#D97706', color: '#fff', fontWeight: 700, fontSize: '0.76rem', py: 0.75, boxShadow: '0 2px 8px rgba(217,119,6,0.25)', '&:hover': { backgroundColor: '#B45309' } }}
                          >
                            Giải thích
                          </MuiButton>
                          <MuiButton
                            variant="contained" fullWidth size="small" onClick={quickConfirm}
                            startIcon={<CheckCircle2 size={13} />}
                            sx={{ borderRadius: '8px', backgroundColor: '#16A34A', color: '#fff', fontWeight: 700, fontSize: '0.76rem', py: 0.75, boxShadow: '0 2px 8px rgba(22,163,74,0.25)', '&:hover': { backgroundColor: '#15803D' } }}
                          >
                            Xác nhận luôn
                          </MuiButton>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.75 }}>
                          <Tooltip title="Kiểm tra lại — AI dò với ngưỡng thấp hơn" arrow>
                            <IconButton size="small" onClick={() => recheck(0.4)}
                              aria-label="Kiểm tra lại với ngưỡng thấp hơn"
                              sx={{ color: '#7C3AED', border: '1px solid rgba(124,58,237,0.35)', borderRadius: '8px', p: 0.7, '&:hover': { backgroundColor: 'rgba(124,58,237,0.08)', borderColor: '#7C3AED' } }}>
                              <RefreshCw size={15} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Báo sai — lưu vào DB, các phiên sau auto-skip vùng này" arrow>
                            <IconButton size="small" onClick={reportFalsePositive}
                              aria-label="Báo false positive (lưu lâu dài)"
                              sx={{ color: '#DC2626', border: '1px solid rgba(220,38,38,0.35)', borderRadius: '8px', p: 0.7, '&:hover': { backgroundColor: 'rgba(220,38,38,0.08)', borderColor: '#DC2626' } }}>
                              <Flag size={15} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Bỏ qua — chỉ session hiện tại" arrow>
                            <IconButton size="small" onClick={ignoreDetection}
                              aria-label="Bỏ qua detection trong session hiện tại"
                              sx={{ color: '#92400E', border: '1px solid rgba(146,64,14,0.3)', borderRadius: '8px', p: 0.7, '&:hover': { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: '#D97706' } }}>
                              <X size={15} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </>
                    )}
                  </Box>
                </MotionBox>
              )}

              {/* LLM Smart Log */}
              <Box
                sx={{
                  backgroundColor: 'background.paper',
                  borderRadius: '16px',
                  border: '1px solid #E2EAE8',
                  boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  minHeight: 200,
                }}
              >
                <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid #E2EAE8', display: 'flex', alignItems: 'center', gap: 1.5, backgroundColor: '#F8FAFB' }}>
                  <Box sx={{ width: 30, height: 30, borderRadius: '8px', backgroundColor: 'rgba(0,96,100,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'primary.main' }}>
                    <Bot size={16} />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', display: 'block' }}>
                      LLM Smart Log
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                      Phân tích ngữ nghĩa theo thời gian thực
                    </Typography>
                  </Box>
                  {isListeningVoice && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#0277BD' }}>
                      <CircularProgress size={12} thickness={5} sx={{ color: '#0277BD' }} />
                      <Typography variant="caption" sx={{ fontWeight: 600, color: '#0277BD', fontSize: '0.7rem' }}>
                        Đang phân tích
                      </Typography>
                    </Box>
                  )}
                </Box>

                <Box sx={{ p: 2.5, flex: 1, overflowY: 'auto' }}>
                  {isListeningVoice && !llmInsight ? (
                    // Phase C2 — skeleton instead of a single spinner. Gives
                    // the doctor a sense of what's coming and feels less like
                    // the page is frozen during the ~5s LLM call.
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CircularProgress size={14} thickness={5} sx={{ color: '#0277BD' }} />
                        <Typography variant="caption" sx={{ color: '#0277BD', fontWeight: 600 }}>
                          AI đang phân tích tổn thương…
                        </Typography>
                      </Box>
                      {/* Hero placeholder — severity stripe + title row */}
                      <Box sx={{ borderRadius: '10px', border: '1px solid #E2EAE8', overflow: 'hidden' }}>
                        <Box sx={{ height: 8, backgroundColor: 'rgba(0,96,100,0.15)' }} />
                        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                          <SkeletonBar width="35%" height={10} />
                          <SkeletonBar width="75%" height={14} />
                          <SkeletonBar width="100%" height={4} />
                        </Box>
                      </Box>
                      {/* 3 section placeholders matching LesionReportCard layout */}
                      {[0, 1, 2].map((i) => (
                        <Box key={i} sx={{ borderRadius: '8px', border: '1px solid #E2EAE8', p: 1 }}>
                          <SkeletonBar width="40%" height={10} />
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, mt: 0.75 }}>
                            <SkeletonBar width="90%" height={8} />
                            <SkeletonBar width="80%" height={8} />
                            <SkeletonBar width="60%" height={8} />
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : currentDetection?.lesionReport ? (
                    <MotionBox initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                      <DisclaimerBanner />
                      <LesionReportCard report={currentDetection.lesionReport} />
                    </MotionBox>
                  ) : llmInsight ? (
                    <MotionBox initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                      <Box sx={{
                        fontSize: '0.875rem',
                        lineHeight: 1.75,
                        color: 'text.primary',
                        '& p': { margin: '0 0 10px' },
                        '& p:last-child': { marginBottom: 0 },
                        '& strong': { fontWeight: 700, color: '#004D40' },
                        // Each **Bold:** line gets a subtle section divider
                        '& p:has(strong:first-of-type)': {
                          borderLeft: '3px solid #00897B',
                          paddingLeft: '10px',
                          margin: '0 0 6px',
                          backgroundColor: 'rgba(0,137,123,0.04)',
                          borderRadius: '0 6px 6px 0',
                        },
                        '& ul, & ol': { paddingLeft: '1.1rem', margin: '4px 0 10px' },
                        '& li': { marginBottom: '4px', listStyleType: 'none', paddingLeft: 0 },
                        '& li input[type="checkbox"]': {
                          marginRight: '7px', accentColor: '#006064',
                          width: 14, height: 14, verticalAlign: 'middle',
                          cursor: 'default',
                        },
                        '& h1, & h2, & h3': { fontSize: '0.9rem', fontWeight: 700, color: '#004D40', margin: '10px 0 4px' },
                        '& code': { backgroundColor: 'rgba(0,96,100,0.1)', borderRadius: '4px', padding: '1px 5px', fontSize: '0.82rem' },
                      }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{llmInsight}</ReactMarkdown>
                      </Box>
                    </MotionBox>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4, gap: 1.5, color: 'text.disabled' }}>
                      <MicOff size={28} />
                      <Typography variant="caption" sx={{ textAlign: 'center', maxWidth: 180 }}>
                        Chưa có phân tích. Nhấn &quot;Giải thích thêm&quot; để kích hoạt.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Box>

      <VideoSourceModal
        open={isSourceModalOpen}
        onClose={() => setIsSourceModalOpen(false)}
        onUploadAndConnect={handleUploadAndConnect}
        onLibrarySelect={handleLibrarySelectFromModal}
      />
    </Box>
  );
}
