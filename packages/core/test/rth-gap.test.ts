// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { rthGap } from '../src/rth-gap.js';
import type { Bar } from '../src/types.js';

const wall = (s: string) => Date.parse(`${s}Z`) / 1000;
const bar = (time: number, open: number, close: number): Bar => ({
  time,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 1,
});

describe('rthGap', () => {
  it('takes the 16:14 close and the 09:30 open (New York wall time)', () => {
    const bars = [
      bar(wall('2026-11-12T16:13:00'), 100, 101),
      bar(wall('2026-11-12T16:14:00'), 101, 102), // close 102
      bar(wall('2026-11-12T16:15:00'), 102, 999), // after the close
      bar(wall('2026-11-13T09:29:00'), 999, 998), // pre-market
      bar(wall('2026-11-13T09:30:00'), 95, 96), // open 95
      bar(wall('2026-11-13T09:31:00'), 96, 97),
    ];
    expect(rthGap(bars)).toEqual({
      closeIndex: 1,
      close: 102,
      openIndex: 4,
      open: 95,
      date: '2026-11-13',
    });
  });

  it('applies the dataset UTC offset and keeps only the newest day', () => {
    const est = -300;
    const utc = (s: string) => wall(s) - est * 60;
    const bars = [
      bar(utc('2026-11-11T16:14:00'), 1, 2),
      bar(utc('2026-11-12T09:30:00'), 3, 4),
      bar(utc('2026-11-12T16:14:00'), 5, 6),
      bar(utc('2026-11-13T09:30:00'), 7, 8),
    ];
    expect(rthGap(bars, est)).toMatchObject({ close: 6, open: 7, date: '2026-11-13' });
    expect(rthGap(bars.slice(0, 1), est)).toBeNull();
  });
});
