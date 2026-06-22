'use client';

/**
 * chat-tab.tsx — "Hỏi AI" tab of the session-summary panel.
 *
 * Phase 3 enhancements:
 * - Empty state: static example questions become clickable chips → call onSend.
 * - Evidence grounding is wired server-side (_stream_session_qa); no FE changes
 *   needed beyond the UI polish here.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { MessageSquare, RotateCcw, Send, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { QaMessage } from '@/context/AnalysisContext';
import { API_BASE } from '@/lib/ws-client';

/** Frame thumbnail (already has the lesion box drawn) keyed by frame_index —
 *  fetched once so chat "frame N" mentions become click-to-view links. */
interface FrameInfo {
  frame_index: number;
  label?: string;
  severity?: string;
  primary_dx?: string;
  frame_b64?: string;
}

const EXAMPLE_QUESTIONS = [
  'Tổn thương nào nguy hiểm nhất?',
  'Có cần sinh thiết không?',
  'Phân loại Paris là gì?',
  'Khuyến nghị tái khám?',
];

interface ChatTabProps {
  messages: QaMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  /** Stop the in-flight answer so the input unlocks (like other chatbots). */
  onStop?: () => void;
  /** Reset the conversation (wipe history). Shown only when there are messages. */
  onClear?: () => void;
  /** Session id — used to fetch frame thumbnails for the "frame N" click-to-view. */
  sessionId?: string;
}

export function ChatTab({ messages, streaming, onSend, onStop, onClear, sessionId }: ChatTabProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Frame thumbnails keyed by frame_index — fetched once per session so "frame N"
  // mentions in answers become clickable previews. Empty until loaded / on error.
  const [frames, setFrames] = useState<Map<number, FrameInfo>>(new Map());
  const [frameAnchor, setFrameAnchor] = useState<HTMLElement | null>(null);
  const [activeFrame, setActiveFrame] = useState<FrameInfo | null>(null);

  useEffect(() => {
    if (!sessionId || messages.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/session/${sessionId}/frames`);
        if (!res.ok) return;
        const data = await res.json() as { frames: FrameInfo[] };
        if (cancelled) return;
        setFrames(new Map(data.frames.map((f) => [f.frame_index, f])));
      } catch { /* no links if fetch fails — graceful */ }
    })();
    return () => { cancelled = true; };
  }, [sessionId, messages.length]);

  const openFrame = (el: HTMLElement, n: number) => {
    const info = frames.get(n);
    if (!info) return;
    setActiveFrame(info);
    setFrameAnchor(el);
  };

  // Turn "frame N" / "Frame N" into a markdown link ONLY when that frame has a
  // thumbnail; the custom `a` renderer below makes it a click-to-view chip.
  const linkifyFrames = (text: string): string =>
    frames.size === 0
      ? text
      : text.replace(/\b([Ff]rame)\s+(\d+)\b/g, (m, word, num) =>
          frames.has(Number(num)) ? `[${word} ${num}](#frame-${num})` : m);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content.length]);

  const submit = () => {
    const t = draft.trim();
    if (!t || streaming) return;
    onSend(t);
    setDraft('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 360 }}>
      {/* Reset conversation — wipes chat history only (keeps detections + summary). */}
      {messages.length > 0 && onClear && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5, flexShrink: 0 }}>
          <Button
            size="small"
            startIcon={<RotateCcw size={13} />}
            onClick={() => {
              if (window.confirm('Xoá toàn bộ hội thoại và bắt đầu lại?')) onClear();
            }}
            sx={{
              fontSize: '0.72rem', textTransform: 'none', color: 'text.secondary',
              borderRadius: '8px', py: 0.25, px: 1, minWidth: 0,
              '&:hover': { backgroundColor: 'rgba(0,96,100,0.06)', color: '#006064' },
            }}
          >
            Hỏi lại từ đầu
          </Button>
        </Box>
      )}
      <Box ref={listRef} sx={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1,
        pr: 0.5, py: 0.5,
      }}>
        {/* Empty state — clickable example question chips */}
        {messages.length === 0 && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 1.5, color: 'text.disabled', py: 3 }}>
            <MessageSquare size={28} />
            <Typography sx={{ fontSize: '0.8rem', textAlign: 'center', maxWidth: 280 }}>
              Hỏi AI về phiên này:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, justifyContent: 'center', maxWidth: 300 }}>
              {EXAMPLE_QUESTIONS.map((q) => (
                <Chip
                  key={q}
                  label={q}
                  size="small"
                  clickable
                  onClick={() => { if (!streaming) onSend(q); }}
                  sx={{
                    fontSize: '0.72rem', cursor: 'pointer',
                    backgroundColor: 'rgba(0,96,100,0.08)', color: '#006064',
                    border: '1px solid rgba(0,96,100,0.2)',
                    '&:hover': { backgroundColor: 'rgba(0,96,100,0.15)' },
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Message bubbles */}
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          const isStreamingThis = !isUser && streaming && i === messages.length - 1;
          return (
            <Box key={i} sx={{
              alignSelf: isUser ? 'flex-end' : 'flex-start',
              maxWidth: '88%', px: 1.5, py: 1, borderRadius: '12px',
              backgroundColor: isUser ? '#006064' : '#F0F4F3',
              color: isUser ? '#fff' : 'text.primary',
              fontSize: '0.84rem', lineHeight: 1.6, wordBreak: 'break-word',
              ...(isUser ? { whiteSpace: 'pre-wrap' } : {
                '& p':        { margin: '0 0 6px', '&:last-child': { marginBottom: 0 } },
                '& strong':   { fontWeight: 700, color: '#004D40' },
                '& em':       { fontStyle: 'italic', color: '#00695C' },
                '& code':     { backgroundColor: 'rgba(0,96,100,0.08)', borderRadius: '4px', padding: '1px 5px', fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' },
                '& ul, & ol': { paddingLeft: '1.1rem', margin: '4px 0 6px' },
                '& li':       { marginBottom: '2px' },
                '& h1, & h2, & h3, & h4': {
                  fontSize: '0.82rem', fontWeight: 700, color: '#004D40',
                  margin: '10px 0 4px', paddingBottom: '3px',
                  borderBottom: '1px solid rgba(0,77,64,0.15)',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  '&:first-of-type': { marginTop: 0 },
                },
                '& blockquote': { borderLeft: '3px solid #00897B', backgroundColor: 'rgba(0,137,123,0.06)', padding: '4px 8px', margin: '4px 0', borderRadius: '0 6px 6px 0', '& p': { margin: 0 } },
                '& a':        { color: '#0277BD', textDecoration: 'underline' },
                '& hr':       { border: 0, borderTop: '1px dashed #C8D8D6', margin: '6px 0' },
                '& table':    { borderCollapse: 'collapse', fontSize: '0.78rem', margin: '4px 0' },
                '& th, & td': { border: '1px solid #C8D8D6', padding: '3px 6px' },
                '& th':       { backgroundColor: 'rgba(0,96,100,0.05)', fontWeight: 700 },
              }),
            }}>
              {isUser ? m.content : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => {
                      const fm = href?.match(/^#frame-(\d+)$/);
                      if (!fm) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
                      const n = Number(fm[1]);
                      return (
                        <Box
                          component="span"
                          role="button"
                          tabIndex={0}
                          onClick={(e: MouseEvent<HTMLElement>) => openFrame(e.currentTarget, n)}
                          sx={{
                            cursor: 'pointer', fontWeight: 700, color: '#00695C',
                            borderBottom: '1px dashed #00897B', whiteSpace: 'nowrap',
                            '&:hover': { color: '#006064', backgroundColor: 'rgba(0,137,123,0.08)' },
                          }}
                        >
                          {children}
                        </Box>
                      );
                    },
                  }}
                >
                  {linkifyFrames(m.content)}
                </ReactMarkdown>
              )}
              {isStreamingThis && (
                <Box component="span" sx={{
                  display: 'inline-block', width: 6, height: 14, ml: 0.5,
                  backgroundColor: 'currentColor', verticalAlign: 'middle',
                  animation: 'blink 0.9s steps(2) infinite',
                  '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } },
                }} />
              )}
            </Box>
          );
        })}

        {/* Typing indicator */}
        {streaming && (messages.length === 0 || messages[messages.length - 1].role === 'user') && (
          <Box sx={{
            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.5, py: 1, borderRadius: '12px',
            backgroundColor: '#F0F4F3', color: 'text.secondary', fontSize: '0.82rem',
          }}>
            <Typography component="span" sx={{ fontSize: 'inherit', fontStyle: 'italic' }}>
              AI đang suy nghĩ
            </Typography>
            <Box sx={{
              display: 'inline-flex', gap: 0.4,
              '& > span': { width: 5, height: 5, borderRadius: '50%', backgroundColor: 'currentColor',
                animation: 'qaTypingDot 1.2s ease-in-out infinite' },
              '& > span:nth-of-type(2)': { animationDelay: '0.2s' },
              '& > span:nth-of-type(3)': { animationDelay: '0.4s' },
              '@keyframes qaTypingDot': {
                '0%, 80%, 100%': { opacity: 0.25, transform: 'translateY(0)' },
                '40%':           { opacity: 1,    transform: 'translateY(-3px)' },
              },
            }}>
              <span /><span /><span />
            </Box>
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box sx={{ display: 'flex', gap: 0.75, mt: 1, alignItems: 'flex-end' }}>
        <TextField
          size="small" fullWidth
          placeholder={streaming ? 'AI đang trả lời… (bấm ■ để dừng)' : 'Hỏi về phiên này…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          multiline maxRows={3}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', fontSize: '0.85rem', backgroundColor: '#FAFCFB' } }}
        />
        {/* While streaming the action becomes a STOP button (abort + unlock input);
            otherwise it is the normal Send button. */}
        <IconButton
          onClick={streaming ? (onStop ?? (() => {})) : submit}
          disabled={!streaming && !draft.trim()}
          title={streaming ? 'Dừng' : 'Gửi'}
          sx={{
            color: '#fff',
            backgroundColor: streaming ? '#C62828' : '#006064',
            borderRadius: '10px', width: 38, height: 38, flexShrink: 0,
            '&:hover': { backgroundColor: streaming ? '#A01b1b' : '#004D40' },
            '&.Mui-disabled': { backgroundColor: '#E2EAE8', color: '#9AA5B1' },
          }}
        >
          {streaming ? <Square size={14} fill="#fff" /> : <Send size={16} />}
        </IconButton>
      </Box>

      {/* Frame preview popover — click a "frame N" mention to see its thumbnail. */}
      <Popover
        open={Boolean(frameAnchor && activeFrame)}
        anchorEl={frameAnchor}
        onClose={() => { setFrameAnchor(null); setActiveFrame(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { borderRadius: '12px', overflow: 'hidden', maxWidth: 320 } } }}
      >
        {activeFrame && (
          <Box sx={{ width: 300 }}>
            {activeFrame.frame_b64 ? (
              <img
                src={`data:image/jpeg;base64,${activeFrame.frame_b64}`}
                alt={`Frame ${activeFrame.frame_index}`}
                style={{ display: 'block', width: '100%', height: 'auto' }}
              />
            ) : (
              <Box sx={{ p: 2, textAlign: 'center', color: 'text.disabled', fontSize: '0.8rem' }}>
                Không có ảnh cho frame này
              </Box>
            )}
            <Box sx={{ px: 1.5, py: 1 }}>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'text.primary' }}>
                Frame {activeFrame.frame_index}
                {activeFrame.primary_dx ? ` — ${activeFrame.primary_dx}` : ''}
              </Typography>
              {activeFrame.severity && (
                <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.25 }}>
                  Mức độ: <strong>{activeFrame.severity}</strong>
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </Popover>
    </Box>
  );
}
