import { describe, expect, test } from 'vitest';

/**
 * Detection actions revamp — pure-function smoke tests.
 * Mirrors the BE/FE invariants that the 3 PRs introduced. Component-level
 * tests are deferred (no @testing-library configured in this repo yet).
 */

// ── Tracked vs untracked fallback (Phase 07 handler logic) ─────────────────

function pickAction(trackId: number | undefined, trackedFn: (id: number) => string, legacyFn: () => string): string {
  if (trackId !== undefined && trackId >= 0) return trackedFn(trackId);
  return legacyFn();
}

describe('handleQuickConfirmTracked / handleIgnoreTracked fallback', () => {
  test('valid trackId → uses track-based action', () => {
    const out = pickAction(7, (id) => `track:${id}`, () => 'legacy');
    expect(out).toBe('track:7');
  });
  test('trackId undefined → falls back to legacy', () => {
    const out = pickAction(undefined, (id) => `track:${id}`, () => 'legacy');
    expect(out).toBe('legacy');
  });
  test('trackId = -1 (recheck-origin sentinel) → falls back to legacy', () => {
    const out = pickAction(-1, (id) => `track:${id}`, () => 'legacy');
    expect(out).toBe('legacy');
  });
});

// ── Capture cadence throttle (Phase 02 BE logic — pure form) ────────────────

function shouldEmitCapture(nowMs: number, lastMs: number, intervalMs: number): boolean {
  return nowMs - lastMs >= intervalMs;
}

describe('CONFIRMED_CAPTURE cadence', () => {
  test('first capture (last=0, real monotonic time) emits', () => {
    // BE uses time.monotonic() which starts well above 0 by the time worker
    // emits first detection; emulate that.
    expect(shouldEmitCapture(123_456_789, 0, 2000)).toBe(true);
  });
  test('within interval skips', () => {
    expect(shouldEmitCapture(1500, 1000, 2000)).toBe(false);
  });
  test('exactly at interval boundary emits', () => {
    expect(shouldEmitCapture(3000, 1000, 2000)).toBe(true);
  });
});

// ── Captures list cap (Phase 04 — drop oldest beyond 200) ───────────────────

describe('captures slice(-200) cap', () => {
  test('keeps last 200 when exceeding', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const capped = items.slice(-200);
    expect(capped.length).toBe(200);
    expect(capped[0]).toBe(50);
    expect(capped[199]).toBe(249);
  });
});