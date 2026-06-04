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
import { Radio, Cpu, Square, Video as VideoIcon } from 'lucide-react';
import { WS_BASE } from '@/lib/ws-client';

interface LiveBox { label: string; confidence: number; bbox: [number, number, number, number]; }

const FRAME_W = 1920;
const FRAME_H = 1080;
const SEND_INTERVAL_MS = 200;   // grab cadence (~5 fps to backend)
const GRAB_WIDTH = 960;          // downscale frames sent to backend

function colorFor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('ung thư') || l.includes('ung thu')) return '#C44E52';
  if (l.includes('loét') || l.includes('loet')) return '#55A868';
  return '#DD8452';
}

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
  const [aiOn, setAiOn] = useState(false);
  const [boxes, setBoxes] = useState<LiveBox[]>([]);
  const [err, setErr] = useState('');

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'videoinput'));
    } catch {
      setErr('Trình duyệt không liệt kê được thiết bị video.');
    }
  }, []);

  const startPreview = useCallback(async (id?: string) => {
    setErr('');
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : true,
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
    } catch {
      setErr('Không truy cập được thiết bị. Hãy cấp quyền camera cho trang và cắm cục capture.');
      setPreviewing(false);
    }
  }, [refreshDevices]);

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

  // Cleanup on unmount.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Video surface + overlay */}
      <Box sx={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '16px', backgroundColor: '#0D1117', position: 'relative', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#0D1117' }}
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
        </Box>
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
                <option key={d.deviceId || i} value={d.deviceId}>
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
          </>
        )}
      </Box>
      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>
        Cục capture HDMI cắm vào máy này; trình duyệt nhận như một “camera”. Màn hình máy kia hiển thị
        liên tục (mirror); chỉ khi bấm <b>Bắt đầu AI</b> mới chạy mô hình phát hiện.
      </Typography>
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
