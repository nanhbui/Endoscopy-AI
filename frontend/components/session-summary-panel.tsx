'use client';

/**
 * session-summary-panel.tsx — Phase B end-of-session UI.
 *
 * Renders the structured SessionSummary (from SESSION_SUMMARY_DONE event)
 * plus an embedded Q&A chat (SESSION_QA_* event flow). Shown when pipeline
 * state is EOS_SUMMARY.
 *
 * Layout: tabs Overview / Detail / Chat — Overview is the headline at-a-glance
 * (overall risk + counts + top 3 priorities), Detail is the full priority
 * list + patterns + checklist, Chat is the streaming Q&A.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, MessageSquare, Send, Sparkles, X } from 'lucide-react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import type { QaMessage } from '@/context/AnalysisContext';
import type { SessionSummary } from '@/lib/ws-client';

// ── Severity / risk visual mapping (kept consistent with LesionReportCard) ──

const RISK_STYLE = {
  'thấp':       { color: '#2E7D32', bg: 'rgba(46,125,50,0.10)',  emoji: '🟢' },
  'trung bình': { color: '#ED6C02', bg: 'rgba(237,108,2,0.10)',  emoji: '🟡' },
  'cao':        { color: '#D32F2F', bg: 'rgba(211,47,47,0.10)',  emoji: '🔴' },
} as const;

const CATEGORY_LABEL = {
  sinh_thiet: 'Sinh thiết',
  test:       'Xét nghiệm',
  dieu_tri:   'Điều trị',
  tai_kham:   'Tái khám',
} as const;

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ summary }: { summary: SessionSummary }) {
  const risk = RISK_STYLE[summary.overall_risk];
  const top3 = summary.priority_findings.slice(0, 3);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Hero — overall risk badge + counts grid */}
      <Box sx={{
        px: 2, py: 1.75, borderRadius: '12px',
        backgroundColor: risk.bg,
        border: `1px solid ${risk.color}33`,
        borderLeft: `4px solid ${risk.color}`,
      }}>
        <Typography sx={{
          fontSize: '0.7rem', fontWeight: 700, color: risk.color,
          textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5,
        }}>
          {risk.emoji} Nguy cơ tổng thể: {summary.overall_risk}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.25, mt: 1.25 }}>
          {[
            ['Tổn thương', summary.overview.total_findings],
            ['Xác nhận', summary.overview.confirmed_count],
            ['Bỏ qua', summary.overview.ignored_count],
            ['Thời lượng', `${summary.overview.duration_seconds}s`],
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
      </Box>

      {/* Top 3 priority findings */}
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
                  borderRadius: '8px', backgroundColor: '#F8FAFB',
                  border: '1px solid #E2EAE8',
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
                      Frame {f.frame_index} · {f.rationale}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Detail tab — full priority list + patterns + checklist ──────────────────

function DetailTab({ summary }: { summary: SessionSummary }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* All priority findings */}
      {summary.priority_findings.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
            Tất cả phát hiện ưu tiên ({summary.priority_findings.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {summary.priority_findings.map((f, i) => {
              const s = RISK_STYLE[f.severity];
              return (
                <Box key={i} sx={{
                  display: 'flex', gap: 1, px: 1.25, py: 1,
                  borderRadius: '8px', backgroundColor: '#F8FAFB',
                  border: '1px solid #E2EAE8',
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
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
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
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
            Checklist hành động
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            {summary.checklist.map((c, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                <Chip
                  label={CATEGORY_LABEL[c.category]}
                  size="small"
                  sx={{ fontSize: '0.62rem', height: 18, fontWeight: 700, backgroundColor: 'rgba(0,96,100,0.1)', color: '#006064', flexShrink: 0 }}
                />
                <Typography sx={{ fontSize: '0.8rem', color: 'text.primary', lineHeight: 1.5, flex: 1 }}>
                  {c.action}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Chat tab — Q&A streaming interface ──────────────────────────────────────

interface ChatTabProps {
  messages: QaMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
}

function ChatTab({ messages, streaming, onSend }: ChatTabProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message / chunk.
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 360 }}>
      {/* Message list */}
      <Box ref={listRef} sx={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1,
        pr: 0.5, py: 0.5,
      }}>
        {messages.length === 0 && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, color: 'text.disabled', py: 3 }}>
            <MessageSquare size={28} />
            <Typography sx={{ fontSize: '0.8rem', textAlign: 'center', maxWidth: 280 }}>
              Hỏi AI về phiên này. Ví dụ:<br />
              <em>"Tổn thương nào nguy hiểm nhất?"</em><br />
              <em>"Có cần sinh thiết frame 214 không?"</em>
            </Typography>
          </Box>
        )}
        {messages.map((m, i) => (
          <Box key={i} sx={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            px: 1.5, py: 1, borderRadius: '12px',
            backgroundColor: m.role === 'user' ? '#006064' : '#F0F4F3',
            color: m.role === 'user' ? '#fff' : 'text.primary',
            fontSize: '0.82rem',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {m.content}
            {/* Cursor blink while streaming the assistant's last message */}
            {m.role === 'assistant' && streaming && i === messages.length - 1 && (
              <Box component="span" sx={{
                display: 'inline-block', width: 6, height: 14, ml: 0.5,
                backgroundColor: 'currentColor', verticalAlign: 'middle',
                animation: 'blink 0.9s steps(2) infinite',
                '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } },
              }} />
            )}
          </Box>
        ))}
      </Box>

      {/* Input */}
      <Box sx={{ display: 'flex', gap: 0.75, mt: 1, alignItems: 'flex-end' }}>
        <TextField
          size="small"
          fullWidth
          placeholder={streaming ? 'AI đang trả lời…' : 'Hỏi về phiên này…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={streaming}
          multiline
          maxRows={3}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '10px', fontSize: '0.85rem',
              backgroundColor: '#FAFCFB',
            },
          }}
        />
        <IconButton
          onClick={submit}
          disabled={!draft.trim() || streaming}
          sx={{
            color: '#fff', backgroundColor: '#006064', borderRadius: '10px',
            width: 38, height: 38, flexShrink: 0,
            '&:hover': { backgroundColor: '#004D40' },
            '&.Mui-disabled': { backgroundColor: '#E2EAE8', color: '#9AA5B1' },
          }}
        >
          {streaming ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <Send size={16} />}
        </IconButton>
      </Box>
    </Box>
  );
}

// ── Main panel with tabs ────────────────────────────────────────────────────

export interface SessionSummaryPanelProps {
  summary: SessionSummary | undefined;
  qaMessages: QaMessage[];
  qaStreaming: boolean;
  onSendQA: (text: string) => void;
  onClose: () => void;
}

export function SessionSummaryPanel({
  summary, qaMessages, qaStreaming, onSendQA, onClose,
}: SessionSummaryPanelProps) {
  const [tab, setTab] = useState<'overview' | 'detail' | 'chat'>('overview');

  return (
    <Box sx={{
      backgroundColor: '#fff', borderRadius: '20px',
      border: '1px solid #E2EAE8', boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 500,
    }}>
      {/* Header */}
      <Box sx={{
        px: 2.5, py: 1.5, borderBottom: '1px solid #E2EAE8',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: '#F8FAFB',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Sparkles size={16} color="#006064" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Tổng hợp phiên
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <X size={16} />
        </IconButton>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          borderBottom: '1px solid #E2EAE8',
          minHeight: 36,
          '& .MuiTab-root': { minHeight: 36, fontSize: '0.78rem', fontWeight: 600, textTransform: 'none', py: 0.5 },
          '& .Mui-selected': { color: '#006064 !important' },
          '& .MuiTabs-indicator': { backgroundColor: '#006064' },
        }}
      >
        <Tab value="overview" label="Tổng quan" />
        <Tab value="detail"   label="Chi tiết" />
        <Tab value="chat"     label="Hỏi AI" />
      </Tabs>

      {/* Body */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
        {!summary ? (
          // Loading state — summary chưa generate xong (~10s sau VIDEO_FINISHED)
          <Box sx={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 1.5, color: 'text.secondary', py: 6,
          }}>
            <CircularProgress size={28} sx={{ color: '#006064' }} />
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
              AI đang tổng hợp phiên…
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', textAlign: 'center', maxWidth: 280 }}>
              Đang gộp các phát hiện thành báo cáo tổng thể. Thường mất 10–15 giây.
            </Typography>
          </Box>
        ) : tab === 'overview' ? (
          <OverviewTab summary={summary} />
        ) : tab === 'detail' ? (
          <DetailTab summary={summary} />
        ) : (
          <ChatTab messages={qaMessages} streaming={qaStreaming} onSend={onSendQA} />
        )}
      </Box>

      {/* Disclaimer footer */}
      <Box sx={{
        px: 2, py: 1, borderTop: '1px solid #E2EAE8', backgroundColor: '#FAFCFB',
      }}>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', textAlign: 'center', lineHeight: 1.4 }}>
          Báo cáo do AI gợi ý · Không thay thế chẩn đoán bác sĩ · Powered by Qwen2.5-VL
        </Typography>
      </Box>

      {/* Helper hint when there's no summary entirely (e.g. session had 0 findings) */}
      {summary && summary.overview.total_findings === 0 && (
        <Box sx={{ px: 2, pb: 1, display: 'flex', justifyContent: 'center' }}>
          <MuiButton size="small" variant="outlined" onClick={onClose}
            sx={{ borderRadius: '8px', fontSize: '0.72rem', textTransform: 'none' }}>
            Đóng — không có tổn thương nào trong phiên
          </MuiButton>
        </Box>
      )}
    </Box>
  );
}
