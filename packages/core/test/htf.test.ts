// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { WEEK_SECONDS } from '../src/blind.js';
import { htfBucketStart, htfCandles } from '../src/htf.js';
import type { Bar } from '../src/types.js';

const H = 3600;
const bar = (time: number, open: number, high: number, low: number, close: number): Bar => ({
  time,
  open,
  high,
  low,
  close,
  volume: 1,
});

describe('htfCandles', () => {
  it('builds the last N higher-timeframe candles from chart bars', () => {
    const bars = [
      bar(0, 10, 12, 9, 11),
      bar(1800, 11, 15, 10, 14),
      bar(H, 14, 16, 13, 13),
      bar(2 * H, 13, 14, 8, 9),
      bar(2 * H + 1800, 9, 10, 7, 8),
    ];
    const s = htfCandles(bars, H, 2);
    expect(s.candles).toEqual([bar(H, 14, 16, 13, 13), { ...bar(2 * H, 13, 14, 7, 8), volume: 2 }]);
    expect(s.end).toBe(3 * H);
  });

  it('finds fair value gaps and volume imbalances between candles', () => {
    const bars = [
      bar(0, 10, 11, 9, 10.5), // a
      bar(H, 10.5, 15, 10.4, 14.5), // b: bodies gap from a? no (10.5 = 10.5)
      bar(2 * H, 14.8, 16, 12, 15.5), // c: low 12 > a.high 11 -> bull FVG; body gap 14.5..14.8
    ];
    const s = htfCandles(bars, H, 3);
    expect(s.fvgs).toEqual([{ kind: 'bull', index: 1, top: 12, bottom: 11 }]);
    expect(s.volumeImbalances).toEqual([{ kind: 'bull', index: 1, top: 14.8, bottom: 14.5 }]);
  });

  it('starts weeks on the Sunday trading day', () => {
    // 2024-01-07 is a Sunday; with an 18:00 day start (UTC offset 0) the week opens at 18:00.
    const sun18 = Date.UTC(2024, 0, 7, 18) / 1000;
    const opts = { dayStartMinutes: 18 * 60 };
    expect(htfBucketStart(sun18, WEEK_SECONDS, opts)).toBe(sun18);
    expect(htfBucketStart(sun18 + 3 * 86_400 + 5 * H, WEEK_SECONDS, opts)).toBe(sun18);
    expect(htfBucketStart(sun18 - H, WEEK_SECONDS, opts)).toBe(sun18 - WEEK_SECONDS);
  });
});
