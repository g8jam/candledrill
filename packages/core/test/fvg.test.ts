// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fvg } from '../src/fvg.js';
import type { Bar } from '../src/types.js';

const bar = (i: number, low: number, high: number, close = (low + high) / 2): Bar => ({
  time: i * 60,
  open: close,
  high,
  low,
  close,
  volume: 1,
});

describe('fvg', () => {
  it('finds a bull gap only once a bar follows the pattern', () => {
    const pattern = [bar(0, 99, 100), bar(1, 100, 110), bar(2, 105, 112)];
    expect(fvg(pattern)).toEqual([]);
    const bars = [...pattern, bar(3, 106, 111)];
    expect(fvg(bars)).toEqual([
      { kind: 'bull', top: 105, bottom: 100, startIndex: 0, endIndex: 3, mitigated: false },
    ]);
  });

  it('finds a bear gap', () => {
    const bars = [bar(0, 110, 112), bar(1, 100, 110), bar(2, 95, 104), bar(3, 94, 99)];
    expect(fvg(bars)).toEqual([
      { kind: 'bear', top: 110, bottom: 104, startIndex: 0, endIndex: 3, mitigated: false },
    ]);
  });

  it('ignores the newest bar, so a forming bar cannot create a gap', () => {
    const bars = [bar(0, 100, 101), bar(1, 99, 100), bar(2, 100, 101), bar(3, 120, 130)];
    expect(fvg(bars)).toEqual([]);
  });

  it('marks a bull gap mitigated after a close below its bottom, checked on the previous bar', () => {
    const base = [bar(0, 99, 100), bar(1, 100, 110), bar(2, 105, 112), bar(3, 106, 111)];
    const dip = bar(4, 95, 107, 99);
    expect(fvg([...base, dip]).map((z) => z.mitigated)).toEqual([false]);
    expect(fvg([...base, dip, bar(5, 96, 100)]).map((z) => z.mitigated)).toEqual([true]);
  });

  it('keeps a gap that is only wicked into', () => {
    const base = [bar(0, 99, 100), bar(1, 100, 110), bar(2, 105, 112), bar(3, 106, 111)];
    const wick = bar(4, 98, 108, 104);
    expect(fvg([...base, wick, bar(5, 104, 106)]).map((z) => z.mitigated)).toEqual([false]);
  });

  it('marks bear gaps mitigated after a close above their top', () => {
    const base = [bar(0, 110, 112), bar(1, 100, 110), bar(2, 95, 104), bar(3, 94, 99)];
    // Bar 4 also opens a second bear gap (100 / 99); the close at 111 fills both.
    expect(fvg([...base, bar(4, 100, 115, 111), bar(5, 110, 112)]).map((z) => z.mitigated)).toEqual(
      [true, true],
    );
  });
});
