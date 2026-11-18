// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { dayCe } from '../src/day-ce.js';
import type { Bar } from '../src/types.js';

const at = (s: string) => Date.parse(`${s}Z`) / 1000;
const bar = (time: number, high: number, low: number): Bar => ({
  time,
  open: low,
  high,
  low,
  close: high,
  volume: 1,
});

describe('dayCe', () => {
  it('keeps the last three completed days, not the forming one', () => {
    const bars = [
      bar(at('2026-11-09T10:00:00'), 50, 40),
      bar(at('2026-11-10T10:00:00'), 110, 100),
      bar(at('2026-11-10T11:00:00'), 120, 105),
      bar(at('2026-11-11T10:00:00'), 90, 80),
      bar(at('2026-11-12T10:00:00'), 70, 60),
      bar(at('2026-11-13T10:00:00'), 999, 1), // forming
    ];
    expect(dayCe(bars)).toEqual([
      { label: '11/10', startIndex: 1, high: 120, low: 100, mid: 110 },
      { label: '11/11', startIndex: 3, high: 90, low: 80, mid: 85 },
      { label: '11/12', startIndex: 4, high: 70, low: 60, mid: 65 },
    ]);
  });

  it('follows the trading-day start (18:00 starts the next day)', () => {
    const opts = { dayStartMinutes: 18 * 60 };
    const bars = [
      bar(at('2026-11-11T19:00:00'), 10, 5), // 11/12 session
      bar(at('2026-11-12T10:00:00'), 12, 6), // 11/12 session
      bar(at('2026-11-12T18:00:00'), 20, 15), // 11/13, forming
    ];
    expect(dayCe(bars, opts)).toEqual([
      { label: '11/12', startIndex: 0, high: 12, low: 5, mid: 8.5 },
    ]);
  });
});
