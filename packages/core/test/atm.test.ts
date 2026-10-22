// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { atmSessions, type AtmWindow } from '../src/atm.js';
import type { Bar } from '../src/types.js';

// One window 18:00-19:00 local; bars every 30 minutes from 17:30 (UTC offset 0).
const W: AtmWindow[] = [{ key: 'asia', startMinute: 18 * 60, endMinute: 19 * 60 }];
const DAY = 86_400;
const at = (day: number, hhmm: number) =>
  day * DAY + Math.floor(hhmm / 100) * 3600 + (hhmm % 100) * 60;
const bar = (time: number, low: number, high: number): Bar => ({
  time,
  open: low,
  high,
  low,
  close: high,
  volume: 1,
});

describe('atmSessions', () => {
  it('builds the session box and pivots from bars inside the window', () => {
    const bars = [
      bar(at(0, 1730), 90, 120), // before the window: ignored
      bar(at(0, 1800), 100, 105),
      bar(at(0, 1830), 98, 110),
      bar(at(0, 1900), 101, 104), // after: pivots extend, not mitigated
    ];
    expect(atmSessions(bars, 0, W)).toEqual([
      {
        key: 'asia',
        startIndex: 1,
        endIndex: 2,
        high: 110,
        highIndex: 2,
        highEnd: 3,
        low: 98,
        lowIndex: 2,
        lowEnd: 3,
      },
    ]);
  });

  it('stops a pivot on the bar that trades through it', () => {
    const bars = [
      bar(at(0, 1800), 100, 110),
      bar(at(0, 1900), 101, 111), // high mitigated here
      bar(at(0, 1930), 101, 109),
    ];
    const [s] = atmSessions(bars, 0, W);
    expect(s!.highEnd).toBe(1);
    expect(s!.lowEnd).toBe(2);
  });

  it('freezes older sessions and keeps at most maxSessions', () => {
    const bars = [
      bar(at(0, 1800), 100, 110),
      bar(at(0, 1900), 101, 109),
      bar(at(1, 1800), 102, 108),
      bar(at(1, 1900), 103, 107),
      bar(at(2, 1800), 104, 106),
    ];
    const all = atmSessions(bars, 0, W, 10);
    expect(all.map((s) => s.startIndex)).toEqual([0, 2, 4]);
    expect(all[0]!.highEnd).toBe(1); // last bar before the next session started
    expect(atmSessions(bars, 0, W, 2).map((s) => s.startIndex)).toEqual([2, 4]);
  });

  it('uses the exchange-local clock', () => {
    // 23:00 UTC is 18:00 at UTC-5.
    const bars = [bar(at(0, 2300), 100, 110)];
    expect(atmSessions(bars, -300, W)).toHaveLength(1);
    expect(atmSessions(bars, 0, W)).toHaveLength(0);
  });
});
