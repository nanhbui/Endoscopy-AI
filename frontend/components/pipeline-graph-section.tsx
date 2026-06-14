'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { Minus, Plus, RefreshCw, RotateCcw, Share2 } from 'lucide-react';
import { API_BASE } from '@/lib/ws-client';

type LoadStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error';

const ELEMENTS = [
  { label: 'filesrc / rtspsrc', desc: 'Đọc dữ liệu thô từ file MP4 hoặc RTSP stream' },
  { label: 'qtdemux', desc: 'Tách container MP4 thành các stream (video, audio)' },
  { label: 'h264parse', desc: 'Parse bitstream H.264 thành các NAL unit' },
  { label: 'avdec_h264 / nvh264dec', desc: 'Giải mã H.264 bằng CPU (libav) hoặc GPU NVDEC' },
  { label: 'videoconvert', desc: 'Chuyển đổi pixel format sang BGR để YOLO xử lý' },
  { label: 'queue', desc: 'Buffer frame giữa các thread, leaky=downstream để tránh stall' },
  { label: 'appsink', desc: 'Điểm cuối — Python pull từng frame qua try-pull-sample()' },
];

const COLORS = [
  { color: '#f8cecc', border: '#b85450', label: 'Đỏ/hồng', desc: 'Source element — tạo dữ liệu' },
  { color: '#d5e8d4', border: '#82b366', label: 'Xanh lá', desc: 'Filter/transform element — xử lý dữ liệu' },
  { color: '#dae8fc', border: '#6c8ebf', label: 'Xanh dương', desc: 'Sink element — tiêu thụ dữ liệu' },
];

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.2;

export function PipelineGraphSection() {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');

  const viewportRef = useRef<HTMLDivElement>(null);
  const scale = useRef(1);
  const offset = useRef({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  // Mirror the drag ref into state purely for the cursor — reading drag.current
  // during render is impure (react-hooks/refs); state is the render-safe source.
  const [grabbing, setGrabbing] = useState(false);

  // Apply current transform to the inner div
  const applyTransform = useCallback(() => {
    const el = viewportRef.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    el.style.transform = `translate(${offset.current.x}px, ${offset.current.y}px) scale(${scale.current})`;
  }, []);

  const setScale = useCallback((next: number) => {
    scale.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    applyTransform();
  }, [applyTransform]);

  const resetView = useCallback(() => {
    scale.current = 1;
    offset.current = { x: 0, y: 0 };
    applyTransform();
  }, [applyTransform]);

  // Wheel zoom centred on cursor
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.current * factor));
    const ratio = next / scale.current;
    offset.current = {
      x: mx + (offset.current.x - mx) * ratio,
      y: my + (offset.current.y - my) * ratio,
    };
    scale.current = next;
    applyTransform();
  }, [applyTransform]);

  // Drag pan
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.current.x, oy: offset.current.y };
    setGrabbing(true);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag.current) return;
    offset.current = {
      x: drag.current.ox + e.clientX - drag.current.startX,
      y: drag.current.oy + e.clientY - drag.current.startY,
    };
    applyTransform();
  }, [applyTransform]);

  const onMouseUp = useCallback(() => { drag.current = null; setGrabbing(false); }, []);

  // Attach non-passive wheel listener so preventDefault works
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || status !== 'ok') return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [status, onWheel]);

  // Reset view when new SVG loads
  useEffect(() => {
    if (status === 'ok') {
      scale.current = 1;
      offset.current = { x: 0, y: 0 };
    }
  }, [status, svgContent]);

  const load = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${API_BASE}/pipeline/graph`);
      if (res.status === 404) { setStatus('empty'); return; }
      if (!res.ok) { setStatus('error'); return; }
      setSvgContent(await res.text());
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch; load() shows the spinner then resolves async
  useEffect(() => { load(); }, []);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Share2 size={18} color="#006064" />
          <Typography variant="h3" sx={{ fontSize: '1.25rem', fontWeight: 700, color: 'text.primary' }}>
            GStreamer Pipeline Graph
          </Typography>
        </Box>
        <MuiButton
          size="small"
          startIcon={<RefreshCw size={14} />}
          onClick={load}
          disabled={status === 'loading'}
          sx={{ color: '#006064', borderRadius: '8px', fontSize: '0.8rem' }}
        >
          Tải lại
        </MuiButton>
      </Box>

      {/* Explanation */}
      <Box sx={{ mb: 2, p: 2.5, backgroundColor: 'rgba(0,96,100,0.05)', borderRadius: '12px', border: '1px solid rgba(0,96,100,0.12)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Overview */}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.75 }}>
            Cách đọc graph
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ lineHeight: 1.8 }}>
            Mỗi <b>hình chữ nhật</b> là một GStreamer element. Bên trong hiển thị tên class, tên instance, và trạng thái.
            Các <b>ô nhỏ</b> trên cạnh element là <b>pad</b> — điểm kết nối dữ liệu (src pad → sink pad).
            Nhãn trên mũi tên là <b>caps</b> (format dữ liệu đã thương lượng, ví dụ <code>video/x-h264</code>, <code>video/x-raw</code>).
          </Typography>
        </Box>

        {/* Color legend */}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.75 }}>
            Màu sắc
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {COLORS.map(({ color, border, label, desc }) => (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 16, height: 16, borderRadius: '4px', backgroundColor: color, border: `2px solid ${border}`, flexShrink: 0 }} />
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', display: 'block' }}>{label}</Typography>
                  <Typography variant="caption" color="textSecondary">{desc}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Element legend */}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.75 }}>
            Các element trong pipeline
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '6px 24px' }}>
            {ELEMENTS.map(({ label, desc }) => (
              <Box key={label} sx={{ display: 'flex', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#006064', fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {label}
                </Typography>
                <Typography variant="caption" color="textSecondary">— {desc}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Graph viewport */}
      <Box sx={{
        backgroundColor: 'background.paper',
        borderRadius: '16px',
        border: '1px solid #E2EAE8',
        boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
        overflow: 'hidden',
        position: 'relative',
        minHeight: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {status === 'loading' && (
          <Typography variant="body2" color="textSecondary">Đang tải graph…</Typography>
        )}
        {status === 'empty' && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Share2 size={32} color="#C8D8D6" style={{ marginBottom: 10 }} />
            <Typography variant="body2" color="textSecondary">Graph chưa được tạo</Typography>
            <Typography variant="caption" color="textDisabled">Restart backend để tạo topology</Typography>
          </Box>
        )}
        {status === 'error' && (
          <Typography variant="body2" sx={{ color: '#C62828' }}>
            Không thể tải graph. Kiểm tra kết nối backend.
          </Typography>
        )}

        {status === 'ok' && svgContent && (
          <>
            {/* Zoom controls */}
            <Box sx={{
              position: 'absolute', top: 10, right: 10, zIndex: 10,
              display: 'flex', flexDirection: 'column', gap: 0.5,
              backgroundColor: 'background.paper',
              border: '1px solid #E2EAE8',
              borderRadius: '10px',
              p: 0.5,
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}>
              <IconButton size="small" onClick={() => setScale(scale.current + ZOOM_STEP)} title="Zoom in">
                <Plus size={16} />
              </IconButton>
              <IconButton size="small" onClick={() => setScale(scale.current - ZOOM_STEP)} title="Zoom out">
                <Minus size={16} />
              </IconButton>
              <IconButton size="small" onClick={resetView} title="Reset">
                <RotateCcw size={16} />
              </IconButton>
            </Box>

            {/* Hint */}
            <Typography variant="caption" color="textDisabled" sx={{
              position: 'absolute', bottom: 8, left: 12, zIndex: 10, pointerEvents: 'none',
            }}>
              Scroll để zoom · kéo để di chuyển
            </Typography>

            {/* Pannable / zoomable canvas */}
            <Box
              ref={viewportRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              sx={{
                width: '100%',
                height: 420,
                cursor: grabbing ? 'grabbing' : 'grab',
                userSelect: 'none',
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  display: 'inline-block',
                  transformOrigin: '0 0',
                  '& svg': { display: 'block' },
                }}
                dangerouslySetInnerHTML={{ __html: svgContent }}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
