'use client';

/**
 * settings-modal.tsx — Settings panel opened by the navbar gear button.
 *
 * UC "Cấu hình hệ thống phân tích":
 *   - Detection sensitivity: global + per-class confidence (applies NEXT session).
 *   - System status (read-only): GPU, LLM, tracker, model, memory counts.
 *   - AI memory: reset learned false-positives / confirmed-lesions.
 * Backed by GET/POST /config, GET /system/status, POST /memory/reset.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  X, SlidersHorizontal, Cpu, Brain, Save, RotateCcw, Trash2, CheckCircle2,
} from 'lucide-react';
import { API_BASE } from '@/lib/ws-client';
import { C } from '@/lib/ui-tokens';

type Conf = Record<string, number>;
interface SysStatus {
  gpu: { name: string; vram_total_mb: number; vram_used_mb: number } | null;
  llm: { backend: string; model: string };
  tracker: string;
  model_file: string;
  classes: string[];
  whisper_model: string;
  memory: { false_positives: number; confirmed_lesions: number };
  active_sessions: number;
}

const CONF_FIELDS: { key: string; label: string }[] = [
  { key: 'conf_global',   label: 'Ngưỡng chung (mọi lớp)' },
  { key: 'conf_viem_tq',  label: 'Viêm thực quản' },
  { key: 'conf_viem_dd',  label: 'Viêm dạ dày HP' },
  { key: 'conf_ut_tq',    label: 'Ung thư thực quản' },
  { key: 'conf_ut_dd',    label: 'Ung thư dạ dày' },
  { key: 'conf_loet_htt', label: 'Loét hoành tá tràng' },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cfg, setCfg] = useState<Conf | null>(null);
  const [status, setStatus] = useState<SysStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const loadStatus = useCallback(() => {
    fetch(`${API_BASE}/system/status`).then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    setSavedMsg('');
    fetch(`${API_BASE}/config`).then((r) => r.json()).then((d) => setCfg(d.config)).catch(() => setCfg(null));
    loadStatus();
  }, [open, loadStatus]);

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (r.ok) setSavedMsg('Đã lưu — áp dụng từ phiên phân tích kế tiếp.');
      else setSavedMsg('Lưu thất bại.');
    } catch {
      setSavedMsg('Không kết nối được backend.');
    } finally {
      setSaving(false);
    }
  }, [cfg]);

  const resetConfig = useCallback(async () => {
    const r = await fetch(`${API_BASE}/config/reset`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    if (r?.config) { setCfg(r.config); setSavedMsg('Đã khôi phục mặc định.'); }
  }, []);

  const resetMemory = useCallback(async (which: string, labelVi: string) => {
    if (!window.confirm(`Xoá toàn bộ "${labelVi}"? Không thể hoàn tác.`)) return;
    await fetch(`${API_BASE}/memory/reset`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ which }),
    }).catch(() => null);
    loadStatus();
  }, [loadStatus]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(13,20,20,0.55)',
        backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, background: C.bgPaper, borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.30)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 22px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: C.teal50, color: C.teal700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SlidersHorizontal size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Cài đặt hệ thống</div>
            <div style={{ fontSize: 12, color: C.neutral500 }}>Tùy chỉnh độ nhạy AI · trạng thái · bộ nhớ học</div>
          </div>
          <button onClick={onClose} aria-label="Đóng" style={iconBtn}><X size={18} /></button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 22, maxHeight: '72vh', overflowY: 'auto' }}>
          {/* Detection sensitivity */}
          <section>
            <SectionHead icon={<SlidersHorizontal size={14} />} title="Độ nhạy phát hiện" sub="Confidence tối thiểu để báo tổn thương. Thấp = bắt nhiều hơn (nhiễu hơn). Áp dụng từ phiên kế tiếp." />
            {cfg ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                {CONF_FIELDS.map((f) => (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 170, fontSize: 13, color: C.neutral700 }}>{f.label}</div>
                    <input
                      type="range" min={0.05} max={0.95} step={0.05}
                      value={cfg[f.key] ?? 0.5}
                      onChange={(e) => setCfg({ ...cfg, [f.key]: parseFloat(e.target.value) })}
                      style={{ flex: 1, accentColor: '#00838F' }}
                    />
                    <div style={{ width: 44, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: C.teal700 }}>
                      {(cfg[f.key] ?? 0.5).toFixed(2)}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                  <button onClick={save} disabled={saving} style={primaryBtn}>
                    <Save size={14} /> {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
                  </button>
                  <button onClick={resetConfig} style={ghostBtn}><RotateCcw size={13} /> Mặc định</button>
                  {savedMsg && (
                    <span style={{ fontSize: 12, color: C.stConfirmed, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <CheckCircle2 size={13} /> {savedMsg}
                    </span>
                  )}
                </div>
              </div>
            ) : <Muted>Không tải được cấu hình (backend offline?).</Muted>}
          </section>

          {/* System status */}
          <section>
            <SectionHead icon={<Cpu size={14} />} title="Trạng thái hệ thống" sub="Thông tin phần cứng & mô hình (chỉ đọc)." />
            {status ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 12 }}>
                <Stat label="GPU" value={status.gpu ? status.gpu.name : 'Không phát hiện (CPU)'} />
                <Stat label="VRAM" value={status.gpu ? `${(status.gpu.vram_used_mb / 1024).toFixed(1)} / ${(status.gpu.vram_total_mb / 1024).toFixed(1)} GB` : '—'} />
                <Stat label="LLM" value={`${status.llm.model} (${status.llm.backend})`} mono />
                <Stat label="Mô hình YOLO" value={status.model_file} mono />
                <Stat label="Tracker" value={status.tracker} />
                <Stat label="Whisper" value={status.whisper_model} mono />
                <Stat label="Số lớp tổn thương" value={String(status.classes.length)} />
                <Stat label="Phiên đang chạy" value={String(status.active_sessions)} />
              </div>
            ) : <Muted>Không tải được trạng thái.</Muted>}
          </section>

          {/* AI memory */}
          <section>
            <SectionHead icon={<Brain size={14} />} title="Bộ nhớ AI" sub="Vùng đã 'Báo sai' (auto-skip) và 'Xác nhận luôn' (auto-capture) được nhớ qua các phiên." />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 12 }}>
              <MemoryCard
                label="Báo sai (false-positive)" count={status?.memory.false_positives ?? 0}
                onReset={() => resetMemory('false_positives', 'Báo sai')}
              />
              <MemoryCard
                label="Xác nhận luôn (confirmed)" count={status?.memory.confirmed_lesions ?? 0}
                onReset={() => resetMemory('confirmed_lesions', 'Xác nhận luôn')}
              />
            </div>
            <button onClick={() => resetMemory('all', 'Báo sai + Xác nhận luôn')} style={{ ...ghostBtn, marginTop: 12, color: C.sevCancer, borderColor: 'rgba(196,78,82,0.4)' }}>
              <Trash2 size={13} /> Xoá toàn bộ bộ nhớ học
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── small bits ────────────────────────────────────────────────────────────────

function SectionHead({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.teal700 }}>
        {icon}
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
      </div>
      <div style={{ fontSize: 12, color: C.neutral500, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: C.bgSubtle, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: C.neutral500 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: C.neutral800, fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function MemoryCard({ label, count, onReset }: { label: string; count: number; onReset: () => void }) {
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: C.neutral600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: C.neutral800 }}>{count}</div>
      <button onClick={onReset} disabled={count === 0} style={{ ...ghostBtn, opacity: count === 0 ? 0.45 : 1 }}>
        <RotateCcw size={12} /> Xoá
      </button>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: C.neutral500, marginTop: 10 }}>{children}</div>;
}

const iconBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, background: 'transparent', border: 'none',
  color: C.neutral500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: C.teal600, color: 'white',
  border: 'none', padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: C.neutral700,
  border: '1px solid var(--border-default)', padding: '7px 13px', fontSize: 13, fontWeight: 550, borderRadius: 8, cursor: 'pointer',
};
