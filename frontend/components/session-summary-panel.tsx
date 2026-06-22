'use client';

/**
 * session-summary-panel.tsx — Phase B end-of-session UI.
 *
 * Tab components split into session-summary/ sub-directory (Phase 3) to keep
 * each file under 200 lines.
 *
 * Layout: tabs Overview / Detail / Chat
 * Props: {summary, qaMessages, qaStreaming, onSendQA, onClose, sessionId?}
 */

import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import type { QaMessage } from '@/context/AnalysisContext';
import type { SessionSummary } from '@/lib/ws-client';
import { OverviewTab } from './session-summary/overview-tab';
import { DetailTab }   from './session-summary/detail-tab';
import { ChatTab }     from './session-summary/chat-tab';

export interface SessionSummaryPanelProps {
  summary: SessionSummary | undefined;
  qaMessages: QaMessage[];
  qaStreaming: boolean;
  onSendQA: (text: string) => void;
  /** Stop the in-flight Q&A answer (unlocks the chat input). */
  onStopQA?: () => void;
  /** Reset the Q&A conversation (wipe chat history, keep detections + summary). */
  onClearQA?: () => void;
  onClose: () => void;
  /** Optional: session id used by OverviewTab to fetch patient context. */
  sessionId?: string;
}

export function SessionSummaryPanel({
  summary, qaMessages, qaStreaming, onSendQA, onStopQA, onClearQA, onClose, sessionId,
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
          borderBottom: '1px solid #E2EAE8', minHeight: 36,
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
      <Box sx={{ flex: 1, minHeight: 0, overflowY: tab === 'chat' ? 'hidden' : 'auto', px: 2, py: 2 }}>
        {!summary ? (
          <SummarySkeleton />
        ) : tab === 'overview' ? (
          <OverviewTab summary={summary} sessionId={sessionId} />
        ) : tab === 'detail' ? (
          <DetailTab summary={summary} />
        ) : (
          <ChatTab messages={qaMessages} streaming={qaStreaming} onSend={onSendQA} onStop={onStopQA} onClear={onClearQA} sessionId={sessionId} />
        )}
      </Box>

      {/* Disclaimer footer */}
      <Box sx={{ px: 2, py: 1, borderTop: '1px solid #E2EAE8', backgroundColor: '#FAFCFB' }}>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', textAlign: 'center', lineHeight: 1.4 }}>
          Báo cáo do AI gợi ý · Không thay thế chẩn đoán bác sĩ · Powered by {tab === 'chat' ? 'Qwen2.5 7B' : 'MedGemma'}
        </Typography>
      </Box>

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

// ── Loading skeleton (extracted to keep main component lean) ─────────────────

function SummarySkeleton() {
  const shimmer = {
    background: 'linear-gradient(90deg, #E2EAE8 0%, #F0F4F3 50%, #E2EAE8 100%)',
    backgroundSize: '200% 100%',
    animation: 'sumSkele 1.4s ease-in-out infinite',
  } as const;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, color: '#006064' }}>
        <CircularProgress size={14} thickness={5} sx={{ color: '#006064' }} />
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600 }}>
          AI đang tổng hợp phiên… (10–15s)
        </Typography>
      </Box>
      <Box sx={{ p: 2, borderRadius: '12px', border: '1px solid #E2EAE8', backgroundColor: '#F8FAFB' }}>
        <Box sx={{ width: '50%', height: 11, borderRadius: '4px', mb: 1.5, ...shimmer }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1.25 }}>
          {[0, 1, 2, 3].map((i) => (
            <Box key={i}>
              <Box sx={{ width: '60%', height: 8, mb: 0.5, borderRadius: '3px', ...shimmer }} />
              <Box sx={{ width: '80%', height: 16, borderRadius: '4px', ...shimmer }} />
            </Box>
          ))}
        </Box>
      </Box>
      {[0, 1, 2].map((i) => (
        <Box key={i} sx={{ p: 1.25, borderRadius: '8px', backgroundColor: '#F8FAFB',
          border: '1px solid #E2EAE8', display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <Box sx={{ width: 50, height: 18, borderRadius: '4px', ...shimmer }} />
          <Box sx={{ flex: 1 }}>
            <Box sx={{ width: '70%', height: 12, mb: 0.5, borderRadius: '3px', ...shimmer }} />
            <Box sx={{ width: '50%', height: 8, borderRadius: '3px', ...shimmer }} />
          </Box>
        </Box>
      ))}
      <Box sx={{ '@keyframes sumSkele': {
        '0%': { backgroundPosition: '200% 0' },
        '100%': { backgroundPosition: '-200% 0' },
      } }} />
    </Box>
  );
}
