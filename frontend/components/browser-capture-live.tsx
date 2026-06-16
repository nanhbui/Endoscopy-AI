'use client';

/**
 * browser-capture-live.tsx — Trực tuyến (live) via the browser.
 *
 * The browser captures the HDMI-capture device (it appears as a normal webcam)
 * and mirrors it locally — so the doctor sees the other machine's screen live,
 * smoothly, with no typing (just pick the device). Detection runs ONLY after
 * "Bắt đầu AI": frames are JPEG-encoded and streamed to /ws/live-detect, the
 * backend runs YOLO and returns boxes which we overlay on the live <video>.
 *
 * No GStreamer / no server-side device path — works with the deployed web app
 * regardless of which machine the capture dongle is plugged into.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { Radio, Cpu, Square, Video as VideoIcon, Sparkles, X, Info, Maximize2 } from 'lucide-react';
import { WS_BASE, API_BASE, type LesionReport } from '@/lib/ws-client';
import { labelToColor as colorFor } from '@/lib/lesion-colors';
import { LesionReportCard } from '@/components/lesion-report-card';

interface LiveBox { label: string; confidence: number; bbox: [number, number, number, number]; }

const FRAME_W = 1920;
const FRAME_H = 1080;
const SEND_INTERVAL_MS = 200;   // grab cadence (~5 fps to backend)
const GRAB_WIDTH = 960;          // downscale frames sent to backend

// Capture resolutions offered to the doctor. "auto" lets the dongle decide.
const RES_OPTIONS = [
  { value: 'auto', label: 'Tự động' },
  { value: '1920x1080', label: '1920×1080 (16:9)' },
  { value: '1280x720', label: '1280×720 (16:9)' },
  { value: '1024x768', label: '1024×768 (4:3)' },
  { value: '800x600', label: '800×600 (4:3)' },
];

// How the mirror fills its frame. "contain" keeps aspect (letterbox), "fill"
// stretches to the frame (fixes a squished signal), "cover" crops to fill.
type FitMode = 'contain' | 'cover' | 'fill';
const FIT_OPTIONS: { value: FitMode; label: string }[] = [
  { value: 'contain', label: 'Vừa khung' },
  { value: 'fill', label: 'Lấp đầy' },
  { value: 'cover', label: 'Cắt vừa' },
];

export function BrowserCaptureLive() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendingRef = useRef(false);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [previewing, setPreviewing] = useState(false);
  // Display tuning: requested capture resolution, how the mirror fills the
  // frame, and a manual zoom to compensate a squished/off-center signal.
  const [resolution, setResolution] = useState('auto');
  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [zoom, setZoom] = useState(100);          // percent, 50–150
  const [actualRes, setActualRes] = useState(''); // e.g. "1920×1080" from the track
  const [showHint, setShowHint] = useState(true);
  const [aiOn, setAiOn] = useState(false);
  const [boxes, setBoxes] = useState<LiveBox[]>([]);
  const [err, setErr] = useState('');
  // On-demand LLM report (Giải thích)
  const [report, setReport] = useState<LesionReport | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [reportErr, setReportErr] = useState('');

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'videoinput'));
    } catch {
      setErr('Trình duyệt không liệt kê được thiết bị video.');
    }
  }, []);

  const startPreview = useCallback(async (id?: string, res?: string) => {
    setErr('');
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const useRes = res ?? resolution;
      const [w, h] = useRes !== 'auto' ? useRes.split('x').map(Number) : [];
      const sizeConstraint = w && h ? { width: { ideal: w }, height: { ideal: h } } : {};
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, ...sizeConstraint } : (w ? sizeConstraint : true),
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPreviewing(true);
      await refreshDevices();
      const settings = stream.getVideoTracks()[0]?.getSettings?.();
      if (settings?.deviceId) setDeviceId(settings.deviceId);
      if (settings?.width && settings?.height) setActualRes(`${settings.width}×${settings.height}`);
    } catch {
      setErr('Không truy cập được thiết bị. Hãy cấp quyền camera cho trang và cắm cục capture.');
      setPreviewing(false);
    }
  }, [refreshDevices, resolution]);

  const stopAi = useCallback(() => {
    setAiOn(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    wsRef.current?.close();
    wsRef.current = null;
    sendingRef.current = false;
    setBoxes([]);
  }, []);

  const startAi = useCallback(() => {
    if (!previewing) return;
    const ws = new WebSocket(`${WS_BASE}/ws/live-detect/browser`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try { const d = JSON.parse(ev.data); setBoxes(d.boxes ?? []); } catch { /* ignore */ }
      sendingRef.current = false;
    };
    ws.onclose = () => { sendingRef.current = false; };
    ws.onerror = () => { setErr('Mất kết nối tới máy chủ AI.'); };
    ws.onopen = () => {
      setAiOn(true);
      timerRef.current = setInterval(() => {
        const v = videoRef.current, c = canvasRef.current, sock = wsRef.current;
        if (!v || !c || !sock || sock.readyState !== WebSocket.OPEN) return;
        if (sendingRef.current) return;        // backpressure: one frame in flight
        if (!v.videoWidth) return;
        const cw = GRAB_WIDTH;
        const ch = Math.round((cw * v.videoHeight) / v.videoWidth) || Math.round(cw * 9 / 16);
        c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, cw, ch);
        c.toBlob((blob) => {
          if (!blob || sock.readyState !== WebSocket.OPEN) return;
          sendingRef.current = true;
          blob.arrayBuffer().then((buf) => sock.send(buf)).catch(() => { sendingRef.current = false; });
        }, 'image/jpeg', 0.6);
      }, SEND_INTERVAL_MS);
    };
  }, [previewing]);

  // Giải thích — snapshot the current frame + top detection, ask the VLM for a
  // structured report. Does not interrupt the mirror/detection loop.
  const explainNow = useCallback(async () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return;
    const top = boxes[0];
    setExplaining(true);
    setReportErr('');
    setReport(null);
    try {
      const cw = 1280;
      const ch = Math.round((cw * v.videoHeight) / v.videoWidth) || Math.round(cw * 9 / 16);
      c.width = cw; c.height = ch;
      c.getContext('2d')?.drawImage(v, 0, 0, cw, ch);
      const blob: Blob | null = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('grab failed');
      const qs = new URLSearchParams({ label: top?.label ?? 'Tổn thương', conf: String(top?.confidence ?? 0) });
      const r = await fetch(`${API_BASE}/live/explain?${qs.toString()}`, { method: 'POST', body: blob });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      const data = await r.json();
      setReport(data.report ?? null);
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : 'Giải thích thất bại');
    } finally {
      setExplaining(false);
    }
  }, [boxes]);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Duplicate-mode notice — an Extend (mở rộng) signal arrives squished/cropped */}
      {showHint && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 1.5, py: 1, borderRadius: '10px', border: '1px solid #FCD34D', backgroundColor: '#FFFBEB' }}>
          <Info size={16} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
          <Typography sx={{ fontSize: '0.75rem', color: '#92400E', flex: 1, lineHeight: 1.5 }}>
            Trên máy nguồn, đặt chế độ màn hình là <b>Duplicate (Nhân đôi)</b>, không dùng <b>Extend (Mở rộng)</b> —
            nếu để Extend, hình truyền sang sẽ bị méo/bẹp hoặc cắt mất. Có thể chỉnh thêm độ phân giải và tỉ lệ bên dưới.
          </Typography>
          <Box component="button" onClick={() => setShowHint(false)}
            sx={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#B45309', display: 'inline-flex', p: 0 }}>
            <X size={15} />
          </Box>
        </Box>
      )}

      {/* Video surface + overlay */}
      <Box sx={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '16px', backgroundColor: '#0D1117', position: 'relative', overflow: 'hidden', border: '1px solid #1c2530', boxShadow: '0 6px 24px rgba(13,27,42,0.10)' }}>
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: fitMode, background: '#0D1117',
            transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
          }}
        />
        {!previewing && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
            <VideoIcon size={36} color="rgba(0,132,143,0.5)" />
            <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)' }}>
              Chưa bật nguồn — bấm “Bật nguồn” và chọn cục capture HDMI
            </Typography>
          </Box>
        )}

        {/* Detection overlay (boxes normalized to 1920×1080) */}
        {aiOn && boxes.map((b, i) => {
          const [x1, y1, x2, y2] = b.bbox;
          const c = colorFor(b.label);
          return (
            <Box key={i} sx={{
              position: 'absolute',
              left: `${(x1 / FRAME_W) * 100}%`, top: `${(y1 / FRAME_H) * 100}%`,
              width: `${((x2 - x1) / FRAME_W) * 100}%`, height: `${((y2 - y1) / FRAME_H) * 100}%`,
              border: `2px solid ${c}`, borderRadius: '4px', pointerEvents: 'none',
            }}>
              <Box sx={{ position: 'absolute', top: -19, left: -1, backgroundColor: c, color: '#fff', px: 0.6, fontSize: '0.6rem', fontWeight: 700, borderRadius: '4px 4px 0 0', whiteSpace: 'nowrap' }}>
                {b.label} {(b.confidence * 100).toFixed(0)}%
              </Box>
            </Box>
          );
        })}

        {/* status badge */}
        <Box sx={{ position: 'absolute', top: 12, left: 12, zIndex: 2, display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.4, borderRadius: '6px', backgroundColor: aiOn ? 'rgba(220,38,38,0.85)' : previewing ? 'rgba(2,119,189,0.85)' : 'rgba(100,100,100,0.6)', backdropFilter: 'blur(6px)' }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#fff', animation: aiOn ? 'pulse 1.5s infinite' : 'none', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } } }} />
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>
            {aiOn ? 'AI ĐANG CHẠY' : previewing ? 'MIRROR' : 'OFFLINE'}
          </Typography>
          {previewing && actualRes && (
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', ml: 0.5 }}>
              · {actualRes}
            </Typography>
          )}
        </Box>

        {/* detection count (AI on) */}
        {aiOn && (
          <Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.1, py: 0.4, borderRadius: '6px', backgroundColor: 'rgba(0,96,100,0.95)', color: '#fff' }}>
            <Cpu size={11} />
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 800 }}>{boxes.length} vùng</Typography>
          </Box>
        )}
      </Box>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {err && (
        <Typography sx={{ fontSize: '0.78rem', color: '#DC2626' }}>{err}</Typography>
      )}

      {/* Controls */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
        {!previewing ? (
          <Box component="button" onClick={() => startPreview()} sx={btnSx('#006064')}>
            <Radio size={16} /> Bật nguồn (chọn cục capture)
          </Box>
        ) : (
          <>
            {/* Device picker — no typing */}
            <Box component="select"
              value={deviceId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => startPreview(e.target.value)}
              sx={{ flex: '1 1 220px', minWidth: 200, px: 1.5, py: 1, borderRadius: '10px', border: '1px solid #CBD5D3', fontSize: '0.85rem', backgroundColor: '#fff', color: 'text.primary' }}
            >
              {devices.map((d, i) => (
                <option key={`${d.deviceId}-${i}`} value={d.deviceId}>
                  {d.label || `Thiết bị ${i + 1}`}
                </option>
              ))}
            </Box>
            {!aiOn ? (
              <Box component="button" onClick={startAi} sx={btnSx('#DC2626')}>
                <Cpu size={16} /> Bắt đầu AI
              </Box>
            ) : (
              <Box component="button" onClick={stopAi} sx={btnSx('#6E7C7B')}>
                <Square size={15} /> Dừng AI
              </Box>
            )}
            {aiOn && (
              <Box component="button"
                onClick={explainNow}
                disabled={explaining || boxes.length === 0}
                sx={{ ...btnSx('#0277BD'),
                  opacity: (explaining || boxes.length === 0) ? 0.5 : 1,
                  cursor: (explaining || boxes.length === 0) ? 'not-allowed' : 'pointer' }}
              >
                {explaining
                  ? <CircularProgress size={15} sx={{ color: '#fff' }} />
                  : <Sparkles size={15} />} Giải thích
              </Box>
            )}
          </>
        )}
      </Box>
      {/* Display tuning — resolution, fit mode, zoom (fixes a squished signal) */}
      {previewing && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, borderRadius: '10px', border: '1px solid #E2EAE8', backgroundColor: '#F8FAFB' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
            <Maximize2 size={14} color="#006064" />
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#445' }}>Độ phân giải</Typography>
            <Box component="select"
              value={resolution}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setResolution(e.target.value); startPreview(deviceId, e.target.value); }}
              sx={{ px: 1, py: 0.6, borderRadius: '8px', border: '1px solid #CBD5D3', fontSize: '0.78rem', backgroundColor: '#fff' }}
            >
              {RES_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Box>
          </Box>

          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#445' }}>Hiển thị</Typography>
            <Box sx={{ display: 'inline-flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid #CBD5D3' }}>
              {FIT_OPTIONS.map((o) => (
                <Box key={o.value} component="button" onClick={() => setFitMode(o.value)}
                  sx={{ px: 1.1, py: 0.6, border: 'none', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600,
                    backgroundColor: fitMode === o.value ? '#006064' : '#fff',
                    color: fitMode === o.value ? '#fff' : '#445' }}>
                  {o.label}
                </Box>
              ))}
            </Box>
          </Box>

          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flex: '1 1 180px', minWidth: 160 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#445', whiteSpace: 'nowrap' }}>Tỉ lệ {zoom}%</Typography>
            <Box component="input" type="range" min={50} max={150} step={1}
              value={zoom}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setZoom(Number(e.target.value))}
              sx={{ flex: 1, accentColor: '#006064', cursor: 'pointer' }}
            />
            {zoom !== 100 && (
              <Box component="button" onClick={() => setZoom(100)}
                sx={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#006064', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', p: 0 }}>
                Đặt lại
              </Box>
            )}
          </Box>
        </Box>
      )}

      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>
        Cục capture HDMI cắm vào máy này; trình duyệt nhận như một “camera”. Màn hình máy kia hiển thị
        liên tục (mirror); chỉ khi bấm <b>Bắt đầu AI</b> mới chạy mô hình phát hiện. Bấm <b>Giải thích</b>
        để AI mô tả tổn thương đang thấy.
      </Typography>

      {/* On-demand LLM report */}
      {(report || explaining || reportErr) && (
        <Box sx={{ borderRadius: '14px', border: '1px solid #E2EAE8', backgroundColor: '#fff', overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: '1px solid #EEF2F1', backgroundColor: '#F8FAFB' }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <Sparkles size={14} color="#0277BD" /> Báo cáo AI
            </Typography>
            <Box component="button" onClick={() => { setReport(null); setReportErr(''); }}
              sx={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6E7C7B', display: 'inline-flex' }}>
              <X size={16} />
            </Box>
          </Box>
          <Box sx={{ p: 2 }}>
            {explaining ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'text.secondary' }}>
                <CircularProgress size={18} /> <Typography sx={{ fontSize: '0.85rem' }}>Đang tạo báo cáo…</Typography>
              </Box>
            ) : reportErr ? (
              <Typography sx={{ color: '#DC2626', fontSize: '0.85rem' }}>{reportErr}</Typography>
            ) : report ? (
              <LesionReportCard report={report} />
            ) : null}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function btnSx(color: string) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 0.75,
    px: 2, py: 1, borderRadius: '10px', border: 'none', cursor: 'pointer',
    backgroundColor: color, color: '#fff', fontSize: '0.85rem', fontWeight: 700,
    '&:hover': { filter: 'brightness(1.08)' },
  } as const;
}
