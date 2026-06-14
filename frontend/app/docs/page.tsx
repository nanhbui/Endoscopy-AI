'use client';

/**
 * /docs — Tài liệu giới thiệu & hướng dẫn sử dụng.
 *
 * Trang nội dung tĩnh (không gọi backend) dành cho bác sĩ nội soi và hội đồng
 * đánh giá đồ án. Mọi số liệu kỹ thuật lấy trực tiếp từ source thật:
 *   - pipeline states / tracker / ngưỡng  → src/backend/pipeline/pipeline_controller.py
 *   - intent giọng nói                     → src/voice/intent_classifier.py
 *   - LLM backend + schema báo cáo         → src/backend/api/endoscopy_ws_server.py, llm_prompts.py
 *   - màu severity + status                → frontend/app/tokens.css
 * Phong cách: inline-style + var(--token) giống dashboard (app/page.tsx).
 * CHỈ TIÊU hiệu năng ở mục 09 là MỤC TIÊU THIẾT KẾ (TECHNICAL_DESIGN.md),
 * chưa phải kết quả benchmark thực tế.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Play, ArrowRight, ArrowLeft, Sparkles, Mic, Zap,
  ScanLine, ScrollText, BarChart3, Gauge, BookOpen, UploadCloud,
  Boxes, CircleCheck, CircleAlert, CirclePause, Stethoscope,
  ShieldCheck, RotateCcw, Ban, Cpu, Network,
} from 'lucide-react';
import { C, HERO_GRADIENT } from '@/lib/ui-tokens';

const SECTIONS = [
  { id: 'tong-quan', n: '01', label: 'Tổng quan' },
  { id: 'lam-gi',    n: '02', label: 'Hệ thống làm gì?' },
  { id: 'kien-truc', n: '03', label: 'Kiến trúc pipeline' },
  { id: 'workflow',  n: '04', label: 'Quy trình bác sĩ' },
  { id: 'voice',     n: '05', label: 'Lệnh giọng nói' },
  { id: 'ton-thuong',n: '06', label: 'Phân loại tổn thương' },
  { id: 'cac-trang', n: '07', label: 'Các trang trong web' },
  { id: 'tech',      n: '08', label: 'Tech stack' },
  { id: 'gioi-han',  n: '09', label: 'Chỉ tiêu & giới hạn' },
];

export default function DocsPage() {
  const [active, setActive] = useState('tong-quan');

  // Sync TOC highlight với section đang trong viewport.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="theme-fade-up" style={{ minHeight: 'calc(100vh - 64px)' }}>
      <Hero />

      <div
        className="docs-grid"
        style={{
          maxWidth: 1280, margin: '0 auto', padding: '0 24px',
          display: 'grid', gridTemplateColumns: '220px 1fr', gap: 48,
        }}
      >
        {/* TOC dính trái */}
        <aside
          className="docs-toc"
          style={{ position: 'sticky', top: 88, height: 'fit-content', alignSelf: 'start', paddingTop: 48 }}
        >
          <div className="theme-eyebrow" style={{ marginBottom: 12 }}>MỤC LỤC</div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 'var(--r-sm)',
                  fontSize: 13, fontWeight: active === s.id ? 600 : 500,
                  textDecoration: 'none',
                  color: active === s.id ? C.teal700 : C.neutral600,
                  background: active === s.id ? C.teal50 : 'transparent',
                  borderLeft: `2px solid ${active === s.id ? '#00838F' : 'transparent'}`,
                  transition: 'all var(--dur-fast)',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.neutral400 }}>{s.n}</span>
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        <div style={{ paddingTop: 48, paddingBottom: 96 }}>
          <SectionLamGi />
          <SectionKienTruc />
          <SectionWorkflow />
          <SectionVoice />
          <SectionTonThuong />
          <SectionCacTrang />
          <SectionTech />
          <SectionGioiHan />
        </div>
      </div>

      <style jsx global>{`
        @media (max-width: 900px) {
          .docs-grid { grid-template-columns: 1fr !important; gap: 0 !important; }
          .docs-toc { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <div id="tong-quan" style={{ background: HERO_GRADIENT, color: 'white', position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute', top: -200, right: -160, width: 560, height: 560, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.12), transparent 60%)', pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', padding: '56px 24px 72px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', opacity: 0.7, marginBottom: 14 }}>
          HỆ THỐNG PHÂN TÍCH NỘI SOI THÔNG MINH
        </div>
        <h1 className="theme-h-display" style={{ margin: '0 0 16px', color: 'white', maxWidth: 820 }}>
          Tài liệu giới thiệu &amp; hướng dẫn sử dụng
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: 'rgba(255,255,255,0.80)', maxWidth: 680 }}>
          Dành cho bác sĩ nội soi và hội đồng đánh giá đồ án tốt nghiệp. Trang này giải thích hệ thống
          làm gì, hoạt động ra sao theo từng bước, và các trang chức năng trong web.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
          <Link
            href="/workspace"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, background: 'white', color: C.teal700,
              padding: '12px 20px', fontWeight: 600, fontSize: 14, borderRadius: 'var(--r-md)',
              textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.20)',
            }}
          >
            <Play size={14} /> Bắt đầu phân tích
          </Link>
          <Link
            href="/report"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, color: 'white',
              border: '1px solid rgba(255,255,255,0.32)', padding: '12px 20px', fontSize: 14,
              borderRadius: 'var(--r-md)', textDecoration: 'none',
            }}
          >
            Xem báo cáo <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Khung mục ────────────────────────────────────────────────────────────────

function SectionShell({
  id, n, title, sub, children,
}: {
  id: string; n: string; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ paddingBottom: 64, scrollMarginTop: 88 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: C.teal600 }}>{n}</span>
        <h2 className="theme-h-h1" style={{ margin: 0 }}>{title}</h2>
      </div>
      {sub && <p style={{ fontSize: 15, color: C.neutral600, lineHeight: 1.6, marginTop: 6, maxWidth: 720 }}>{sub}</p>}
      <div style={{ marginTop: 24 }}>{children}</div>
    </section>
  );
}

const card: React.CSSProperties = {
  background: C.bgPaper, border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-xl)', boxShadow: C.shadowSm,
};

// ── 02 · Hệ thống làm gì? ─────────────────────────────────────────────────────

function SectionLamGi() {
  const cols = [
    {
      tag: 'VẤN ĐỀ', color: C.sevCancer, title: 'Nội soi liên tục dễ bỏ sót tổn thương',
      body: 'Một ca nội soi tiêu hoá kéo dài nhiều phút, bác sĩ phải theo dõi luồng video tốc độ cao và đồng thời thao tác máy. Tổn thương nhỏ, mờ hoặc thoáng qua dễ bị bỏ sót khi mệt mỏi.',
    },
    {
      tag: 'GIẢI PHÁP', color: C.stAnalyzed, title: 'AI real-time + điều khiển bằng giọng nói',
      body: 'YOLOv8 quét frame liên tục; khi confidence vượt ngưỡng (mặc định 0.5, tinh chỉnh theo từng lớp tổn thương) hệ thống tự dừng video. Bác sĩ chỉ cần nói "giải thích" / "bỏ qua" / "xác nhận".',
    },
    {
      tag: 'KẾT QUẢ', color: C.stConfirmed, title: 'Hands-free, ghi nhớ false-positive',
      body: 'Bác sĩ không cần rời tay khỏi endoscope. Vùng đã "báo sai" được lưu vào SQLite và bỏ qua ở các phiên sau (Smart Ignore). Cuối phiên có báo cáo tổng hợp + xuất PDF.',
    },
  ];
  return (
    <SectionShell
      id="lam-gi" n="02" title="Hệ thống làm gì?"
      sub="Một câu: AI đọc video nội soi cùng bác sĩ, tự dừng đúng chỗ cần xem, và để bác sĩ ra lệnh bằng giọng nói thay vì rời tay bấm chuột."
    >
      <div className="docs-3col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {cols.map((c) => (
          <div key={c.tag} style={{ ...card, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: c.color, marginBottom: 12 }}>{c.tag}</div>
            <div className="theme-h-h3" style={{ marginBottom: 8 }}>{c.title}</div>
            <div style={{ fontSize: 13, color: C.neutral600, lineHeight: 1.65 }}>{c.body}</div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

// ── 03 · Kiến trúc pipeline ───────────────────────────────────────────────────

function SectionKienTruc() {
  const nodes = [
    { label: 'Nguồn video',  sub: 'Upload · RTSP · V4L2',   icon: <UploadCloud size={14} />, color: C.neutral600 },
    { label: 'GStreamer',    sub: 'decode · scale (subprocess)', icon: <Boxes size={14} />,  color: C.neutral600 },
    { label: 'YOLOv8',       sub: 'detect ≥ ngưỡng/lớp',    icon: <Zap size={14} />,         color: C.stDetected },
    { label: 'Tracker',      sub: 'StrongSORT / UTR-Track', icon: <ScanLine size={14} />,    color: C.stProcessing },
    { label: 'Auto-pause',   sub: 'PAUSED_WAITING_INPUT',   icon: <CirclePause size={14} />, color: C.teal600 },
    { label: 'Whisper + intent', sub: 'STT tiếng Việt',     icon: <Mic size={14} />,         color: C.teal600 },
    { label: 'LLM (Vision)', sub: 'gpt-4o / qwen2.5-vl',    icon: <Sparkles size={14} />,    color: C.stProcessing },
    { label: 'Resume',       sub: '→ PLAYING',              icon: <Play size={14} />,        color: C.neutral600 },
  ];
  const states = ['IDLE', 'PLAYING', 'PAUSED_WAITING_INPUT', 'PROCESSING_LLM', 'EOS_SUMMARY'];
  const [hover, setHover] = useState<number | null>(null);

  return (
    <SectionShell
      id="kien-truc" n="03" title="Kiến trúc pipeline"
      sub="Luồng dữ liệu chính. GStreamer chạy trong subprocess riêng (cô lập CUDA/GLib khỏi FastAPI), kết nối frontend qua WebSocket /ws/analysis/{id}."
    >
      <div style={{ ...card, padding: 28, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, minWidth: 980 }}>
          {nodes.map((nd, i) => (
            <span key={nd.label} style={{ display: 'contents' }}>
              <div
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{
                  flex: 1, padding: '16px 12px',
                  border: `1px solid ${hover === i ? nd.color : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--r-md)',
                  background: hover === i ? `${nd.color}0a` : C.bgPaper,
                  display: 'flex', flexDirection: 'column', gap: 8, cursor: 'help',
                  transition: 'all var(--dur-fast)',
                }}
              >
                <div
                  style={{
                    width: 28, height: 28, borderRadius: 'var(--r-sm)',
                    background: `${nd.color}14`, color: nd.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {nd.icon}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{nd.label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.neutral500 }}>{nd.sub}</div>
              </div>
              {i < nodes.length - 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 24px', color: C.neutral300 }}>
                  <svg width="18" height="14" viewBox="0 0 20 14" fill="none">
                    <path d="M0 7 H17 M13 2 L18 7 L13 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </span>
          ))}
        </div>

        {/* Các trạng thái pipeline thật */}
        <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: C.neutral500, marginRight: 4 }}>Trạng thái pipeline:</span>
          {states.map((s) => (
            <span
              key={s}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                color: C.teal700, background: C.teal50, border: '1px solid var(--border-subtle)',
                padding: '3px 8px', borderRadius: 'var(--r-sm)',
              }}
            >
              {s}
            </span>
          ))}
        </div>

        <div
          style={{
            marginTop: 20, padding: 14, background: C.bgSubtle, borderRadius: 'var(--r-md)',
            fontSize: 13, color: C.neutral600, lineHeight: 1.6, display: 'flex', gap: 10,
          }}
        >
          <CircleAlert size={16} style={{ color: C.teal600, flexShrink: 0, marginTop: 2 }} />
          <span>
            LLM có thể chạy <strong style={{ color: C.neutral800 }}>local</strong> (Ollama <code className="theme-mono">qwen2.5vl:7b</code>) để dữ liệu bệnh nhân
            không rời máy, hoặc dùng OpenAI <code className="theme-mono">gpt-4o</code> qua API. Chọn bằng biến môi trường <code className="theme-mono">LLM_BACKEND</code>.
            Tracker chọn được <code className="theme-mono">strongsort</code> / <code className="theme-mono">xysr</code> / <code className="theme-mono">utrtrack-tlukf</code> qua <code className="theme-mono">ENDOSCOPY_TRACKER</code>.
          </span>
        </div>
      </div>
      <style jsx global>{`
        @media (max-width: 720px) { .docs-3col { grid-template-columns: 1fr !important; } }
      `}</style>
    </SectionShell>
  );
}

// ── 04 · Quy trình bác sĩ ─────────────────────────────────────────────────────

function SectionWorkflow() {
  const steps = [
    { n: 1, title: 'Tải video / kết nối camera', body: 'Chọn nguồn từ file (MP4/MOV/AVI/MKV), stream RTSP/V4L2, hoặc video trong thư viện backend.' },
    { n: 2, title: 'Bấm "Bắt đầu phân tích AI"', body: 'WebSocket kết nối, video phát; YOLO quét nền và overlay bbox theo màu mức độ.' },
    { n: 3, title: 'AI tự dừng tại tổn thương', body: 'Khi vượt ngưỡng confidence, pipeline chuyển PAUSED_WAITING_INPUT và bật micro.' },
    { n: 4, title: 'Ra lệnh (nói hoặc bấm)', body: 'Giải thích · Xác nhận luôn · Kiểm tra lại · Báo sai · Bỏ qua. Hands-free hoàn toàn.' },
    { n: 5, title: 'Xem báo cáo phiên', body: 'Hết video → EOS_SUMMARY tạo tổng hợp AI + hỏi đáp; xem ở Báo cáo, xuất PDF.' },
  ];
  const pre = [
    { label: 'Giải thích',    desc: 'Gọi LLM phân tích chi tiết (báo cáo 3 phần).', color: C.stAnalyzed, icon: <Sparkles size={14} /> },
    { label: 'Xác nhận luôn', desc: 'Lưu phát hiện ngay, bỏ qua bước LLM.',        color: C.stConfirmed, icon: <CircleCheck size={14} /> },
    { label: 'Kiểm tra lại',  desc: 'Chạy lại YOLO ở ngưỡng thấp hơn (0.4).',      color: C.stProcessing, icon: <RotateCcw size={14} /> },
    { label: 'Báo sai',       desc: 'Đánh dấu false-positive, nhớ cho phiên sau.',  color: C.sevCancer, icon: <CircleAlert size={14} /> },
    { label: 'Bỏ qua',        desc: 'Bỏ qua riêng tổn thương này trong phiên.',     color: C.stDetected, icon: <Ban size={14} /> },
  ];
  return (
    <SectionShell
      id="workflow" n="04" title="Quy trình bác sĩ"
      sub="5 bước. Từ bước 2 trở đi hoàn toàn hands-free. Mỗi tổn thương có 2 nhóm lựa chọn: trước khi gọi LLM, và sau khi đã có phân tích."
    >
      <div className="docs-5col" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {steps.map((s, i) => (
          <div key={s.n} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: C.teal50, color: C.teal700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-mono)', border: `1px solid ${C.teal100}`,
                }}
              >
                {s.n}
              </div>
              {i < steps.length - 1 && <span style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: C.neutral600, lineHeight: 1.55 }}>{s.body}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: 20 }}>
        <div className="theme-eyebrow" style={{ marginBottom: 14 }}>NÚT THAO TÁC KHI VỪA PHÁT HIỆN</div>
        <div className="docs-actions" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {pre.map((a) => (
            <div key={a.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                  padding: '6px 10px', borderRadius: 'var(--r-pill)',
                  background: `${a.color}14`, color: a.color, fontSize: 12, fontWeight: 600,
                }}
              >
                {a.icon} {a.label}
              </div>
              <div style={{ fontSize: 12, color: C.neutral600, lineHeight: 1.5 }}>{a.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '16px 0' }} />
        <div style={{ fontSize: 13, color: C.neutral600, lineHeight: 1.6 }}>
          <strong style={{ color: C.neutral800 }}>Sau khi có phân tích LLM</strong>, chỉ còn 2 lựa chọn:{' '}
          <span style={{ color: C.stConfirmed, fontWeight: 600 }}>Xác nhận</span> (lưu vào báo cáo) hoặc{' '}
          <span style={{ color: C.sevCancer, fontWeight: 600 }}>Bỏ qua</span> (huỷ kết quả). Lưu ý:{' '}
          <em>Báo sai</em> sẽ override <em>Xác nhận</em> — vùng báo sai không được lưu.
        </div>
      </div>
      <style jsx global>{`
        @media (max-width: 860px) {
          .docs-5col { grid-template-columns: repeat(2, 1fr) !important; }
          .docs-actions { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </SectionShell>
  );
}

// ── 05 · Lệnh giọng nói ───────────────────────────────────────────────────────

function SectionVoice() {
  const cmds = [
    { phrases: ['"giải thích thêm"', '"phân tích thêm"', '"tại sao lại"'], intent: 'GIAI_THICH', color: C.stAnalyzed, action: 'LLM mô tả tổn thương (Kỹ thuật / Mô tả / Kết luận)' },
    { phrases: ['"bỏ qua"', '"bắt sai rồi"', '"không phải tổn thương"'],   intent: 'BO_QUA',     color: C.neutral500, action: 'Đánh dấu false-positive, resume video' },
    { phrases: ['"kiểm tra lại"', '"xem lại"', '"phân tích lại"'],          intent: 'KIEM_TRA_LAI', color: C.stProcessing, action: 'Chạy lại nhận diện ở ngưỡng thấp hơn' },
    { phrases: ['"xác nhận đúng"', '"đúng rồi"', '"lưu lại"', '"ok"'],      intent: 'XAC_NHAN',   color: C.stConfirmed, action: 'Đánh dấu confirmed, lưu vào báo cáo' },
    { phrases: ['(câu hỏi tự do)'],                                          intent: 'UNKNOWN',    color: C.stDetected, action: 'Hỏi đáp follow-up với LLM về tổn thương' },
  ];
  return (
    <SectionShell
      id="voice" n="05" title="Lệnh giọng nói"
      sub="faster-whisper (tiếng Việt) + intent classifier theo từ khoá — chấp nhận nhiều biến thể câu nói. Độ tin cậy tăng theo độ dài cụm từ khớp; không cần nhớ chính xác câu lệnh."
    >
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.bgSubtle }}>
                <th style={th}>Bạn nói</th>
                <th style={th}>Intent</th>
                <th style={th}>Hệ thống làm</th>
              </tr>
            </thead>
            <tbody>
              {cmds.map((c) => (
                <tr key={c.intent} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ ...td, width: '42%' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {c.phrases.map((p) => (
                        <span key={p} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: C.neutral800 }}>{p}</span>
                      ))}
                    </div>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                        color: c.color, background: `${c.color}14`, padding: '3px 8px', borderRadius: 'var(--r-sm)',
                      }}
                    >
                      {c.intent}
                    </span>
                  </td>
                  <td style={td}>{c.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionShell>
  );
}
const th: React.CSSProperties = { textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.neutral500 };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 13, color: C.neutral700, verticalAlign: 'top' };

// ── 06 · Phân loại tổn thương ─────────────────────────────────────────────────

function SectionTonThuong() {
  const groups = [
    {
      kind: 'cancer', hex: C.sevCancer, edge: 'cancer', title: 'Ung thư', sub: 'cao · suspected malignancy',
      classes: ['Ung thư thực quản', 'Ung thư dạ dày'],
      body: 'Tổn thương nghi ác tính: viền bờ không đều, bề mặt loét, mạch máu bất thường. Ngưỡng confidence cao (0.75) để giảm cảnh báo nhiễu.',
    },
    {
      kind: 'inflam', hex: C.sevInflam, edge: 'inflam', title: 'Viêm', sub: 'trung bình · inflammation',
      classes: ['Viêm thực quản', 'Viêm dạ dày HP'],
      body: 'Niêm mạc xuất tiết, đỏ, phù nề. Là nhóm mặc định khi nhãn không thuộc ung thư hay loét. Ngưỡng 0.60.',
    },
    {
      kind: 'ulcer', hex: C.sevUlcer, edge: 'ulcer', title: 'Loét', sub: 'thấp–trung bình · ulcer',
      classes: ['Loét hoành tá tràng'],
      body: 'Khuyết niêm mạc có đáy phủ giả mạc. Theo dõi và điều trị nội khoa. Ngưỡng 0.60.',
    },
  ];
  return (
    <SectionShell
      id="ton-thuong" n="06" title="Phân loại tổn thương"
      sub="Mô hình nhận diện 5 lớp tổn thương tiêu hoá, nhóm thành 3 màu mức độ. Đỏ–Cam–Xanh là quy ước y khoa (cancer / inflammation / ulcer), không phải phối màu tuỳ ý. Kết luận LLM xếp 3 mức: thấp / trung bình / cao."
    >
      <div className="docs-3col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {groups.map((g) => (
          <div key={g.kind} style={{ ...card, overflow: 'hidden' }}>
            <div style={{ height: 72, background: g.hex, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(255,255,255,0.92)',
                  background: 'rgba(0,0,0,0.2)', padding: '4px 10px', borderRadius: 'var(--r-sm)',
                }}
              >
                {g.hex}
              </span>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <div className="theme-h-h3">{g.title}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.neutral500 }}>{g.sub}</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {g.classes.map((cl) => (
                  <span key={cl} className={`theme-chip theme-chip--${g.edge}`} style={{ fontSize: 11 }}>{cl}</span>
                ))}
              </div>
              <div style={{ fontSize: 13, color: C.neutral600, lineHeight: 1.65 }}>{g.body}</div>
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

// ── 07 · Các trang trong web ──────────────────────────────────────────────────

function SectionCacTrang() {
  const pages = [
    { href: '/',          icon: <Gauge size={16} />,      label: 'Dashboard', body: 'Tổng quan: KPI phiên/tổn thương, 4 thẻ tính năng, phiên gần đây, sơ đồ pipeline GStreamer.' },
    { href: '/workspace', icon: <ScanLine size={16} />,   label: 'Workspace', body: 'Nơi làm việc chính: player 16:9, overlay bbox, voice control, các nút thao tác, báo cáo cuối phiên.' },
    { href: '/report',    icon: <ScrollText size={16} />, label: 'Báo cáo',   body: 'Lịch sử phiên (localStorage + SQLite). Mỗi phiên: lưới tổn thương, tổng hợp AI + hỏi đáp, xuất PDF.' },
    { href: '/analytics', icon: <BarChart3 size={16} />,  label: 'Thống kê',  body: 'KPI tổng hợp, phân bố mức độ, top nhãn, phân loại Paris, quản lý false-positive.' },
    { href: '/docs',      icon: <BookOpen size={16} />,   label: 'Tài liệu',  body: 'Trang này — giới thiệu hệ thống và hướng dẫn sử dụng cho bác sĩ và hội đồng.' },
  ];
  return (
    <SectionShell id="cac-trang" n="07" title="Các trang trong web" sub="Năm trang chính trên thanh điều hướng.">
      <div className="docs-pages" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {pages.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            style={{ ...card, padding: 18, display: 'flex', gap: 14, textDecoration: 'none', color: 'inherit' }}
          >
            <div
              style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: C.teal50, color: C.teal700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {p.icon}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.label} <ArrowRight size={13} style={{ color: C.neutral400 }} />
              </div>
              <div style={{ fontSize: 13, color: C.neutral600, lineHeight: 1.55, marginTop: 4 }}>{p.body}</div>
            </div>
          </Link>
        ))}
      </div>
      <style jsx global>{`
        @media (max-width: 720px) { .docs-pages { grid-template-columns: 1fr !important; } }
      `}</style>
    </SectionShell>
  );
}

// ── 08 · Tech stack ───────────────────────────────────────────────────────────

function SectionTech() {
  const groups = [
    {
      icon: <Cpu size={15} />, tag: 'Backend & ML',
      items: [
        ['FastAPI', 'API + WebSocket realtime'],
        ['GStreamer 1.0', 'decode video (subprocess)'],
        ['YOLOv8 (ultralytics)', 'phát hiện tổn thương'],
        ['StrongSORT / boxmot', 'theo dõi đối tượng + ReID'],
        ['faster-whisper', 'speech-to-text tiếng Việt'],
      ],
    },
    {
      icon: <Sparkles size={15} />, tag: 'LLM & dữ liệu',
      items: [
        ['OpenAI gpt-4o / mini', 'vision-LLM (cloud)'],
        ['Ollama qwen2.5vl:7b', 'vision-LLM (local)'],
        ['FAISS', 'dedup negative pattern'],
        ['SQLite', 'phiên, báo cáo, false-positive'],
      ],
    },
    {
      icon: <Network size={15} />, tag: 'Frontend',
      items: [
        ['Next.js 16', 'App Router · React 19'],
        ['MUI v9', 'nền tảng component'],
        ['Tailwind v4 + shadcn/ui', 'utility CSS'],
        ['lucide-react', 'bộ icon'],
        ['WebSocket', 'nhận detection + intent'],
      ],
    },
  ];
  return (
    <SectionShell
      id="tech" n="08" title="Tech stack"
      sub="Toàn bộ stack open-source và chạy được on-premise — phù hợp yêu cầu bảo mật dữ liệu y tế (khi dùng LLM local)."
    >
      <div className="docs-3col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {groups.map((grp) => (
          <div key={grp.tag} style={{ ...card, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: C.teal700 }}>
              {grp.icon}
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{grp.tag}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {grp.items.map(([name, role]) => (
                <div key={name}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                  <div style={{ fontSize: 12, color: C.neutral500, marginTop: 2, lineHeight: 1.5 }}>{role}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

// ── 09 · Chỉ tiêu thiết kế & giới hạn ─────────────────────────────────────────

function SectionGioiHan() {
  const targets = [
    ['YOLO inference', '< 30ms / frame (GPU) · < 100ms (CPU)'],
    ['Độ chính xác phát hiện', 'mAP ≥ 0.85 (mục tiêu trên HyperKvasir)'],
    ['Whisper STT', '< 500ms · độ chính xác ≥ 90% tiếng Việt'],
    ['Vision-LLM phản hồi', '< 2 giây / phân tích'],
    ['Giảm false-positive', '≥ 50% sau ~10 lần "báo sai"'],
  ];
  const limits = [
    'Chỉ hỗ trợ tiếng Việt — chưa đa ngôn ngữ.',
    'Khuyến nghị GPU NVIDIA (≥ 6GB VRAM, RTX 3060+); chạy CPU được nhưng chậm.',
    'LLM local cần ≥ 16GB VRAM; hoặc dùng OpenAI (cần API key, dữ liệu rời máy).',
    'Chưa tích hợp HIS/PACS bệnh viện.',
    'Chưa có benchmark thực tế / validate lâm sàng trên tập giữ riêng.',
  ];
  return (
    <SectionShell
      id="gioi-han" n="09" title="Chỉ tiêu thiết kế & giới hạn"
      sub="Trung thực với những gì hệ thống đặt mục tiêu và chưa làm được."
    >
      {/* Cảnh báo: đây là mục tiêu, không phải số đo */}
      <div
        style={{
          display: 'flex', gap: 10, padding: 14, marginBottom: 16,
          background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)',
          borderRadius: 'var(--r-md)', fontSize: 13, color: C.neutral700, lineHeight: 1.6,
        }}
      >
        <CircleAlert size={16} style={{ color: C.stDetected, flexShrink: 0, marginTop: 2 }} />
        <span>
          Các con số dưới đây là <strong>MỤC TIÊU THIẾT KẾ</strong> (theo <code className="theme-mono">TECHNICAL_DESIGN.md</code>),
          <strong> chưa phải kết quả benchmark thực tế</strong>. Số đo thật cần chạy{' '}
          <code className="theme-mono">share/endoscopy-yolo-eval/benchmark_gstreamer_yolo.py</code> trên phần cứng cụ thể.
        </span>
      </div>

      <div className="docs-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ ...card, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: C.stConfirmed }}>
            <ShieldCheck size={15} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>CHỈ TIÊU THIẾT KẾ</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {targets.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, alignItems: 'baseline' }}>
                <span style={{ color: C.neutral700 }}>{k}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: C.neutral800, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...card, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: C.sevInflam }}>
            <CircleAlert size={15} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>GIỚI HẠN</span>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {limits.map((l) => (
              <li key={l} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.sevInflam, marginTop: 7, flexShrink: 0 }} />
                <span style={{ color: C.neutral700 }}>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Yêu cầu hệ thống */}
      <div style={{ ...card, padding: 20, marginTop: 16 }}>
        <div className="theme-eyebrow" style={{ marginBottom: 12 }}>YÊU CẦU HỆ THỐNG</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['Python 3.10+', 'Node.js 18+', 'CUDA 11.8+', 'GStreamer 1.0', 'RAM ≥ 16GB', 'Ubuntu 22.04/24.04'].map((r) => (
            <span
              key={r}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, color: C.neutral700,
                background: C.bgSubtle, border: '1px solid var(--border-subtle)',
                padding: '5px 10px', borderRadius: 'var(--r-sm)',
              }}
            >
              {r}
            </span>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link
          href="/workspace"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, background: C.teal600, color: 'white',
            padding: '10px 18px', fontSize: 14, fontWeight: 600, borderRadius: 'var(--r-md)', textDecoration: 'none',
          }}
        >
          <Stethoscope size={15} /> Mở Workspace
        </Link>
        <Link
          href="/"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, color: C.teal700,
            border: '1px solid var(--border-default)', padding: '10px 18px', fontSize: 14,
            borderRadius: 'var(--r-md)', textDecoration: 'none',
          }}
        >
          <ArrowLeft size={15} /> Về Dashboard
        </Link>
      </div>
      <style jsx global>{`
        @media (max-width: 720px) { .docs-2col { grid-template-columns: 1fr !important; } }
      `}</style>
    </SectionShell>
  );
}
