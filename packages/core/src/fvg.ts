// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fair value gaps, ported from the TradingView script "FVG Detector (UDT) [CantoLab]"
// with bull + bear gaps and "Show Mitigated" on: mitigated gaps are kept and flagged.
//
// On each bar i (the newest bar is "[0]"), bars i-3 and i-1 are compared, skipping the
// displacement bar i-2. The newest bar is never part of the pattern, so a still-forming
// higher-timeframe bar cannot create a gap.
// - bear: low[i-3] > high[i-1]  -> top = low[i-3],  bottom = high[i-1]
// - bull: high[i-3] < low[i-1]  -> top = low[i-1],  bottom = high[i-3]
// Then every active gap is checked against close[i-1]: a bear gap is mitigated once a
// close is above its top, a bull gap once a close is below its bottom.

import type { Bar } from './types.js';

export interface FvgZone {
  readonly kind: 'bull' | 'bear';
  readonly top: number;
  readonly bottom: number;
  /** Index of the oldest pattern bar (box left edge). */
  readonly startIndex: number;
  /** Index of the bar on which the gap was found (box right edge). */
  readonly endIndex: number;
  /** True once a close has filled the gap. */
  readonly mitigated: boolean;
}

/** All gaps found up to the last bar, oldest first. */
export function fvg(bars: readonly Bar[]): FvgZone[] {
  // Bull gaps sorted by bottom ascending, bear gaps by top descending, so the gap that
  // a close mitigates first is always at the end of its array.
  const bull: FvgZone[] = [];
  const bear: FvgZone[] = [];
  const done: FvgZone[] = [];
  const insert = (arr: FvgZone[], z: FvgZone, key: (x: FvgZone) => number, desc: boolean) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const before = desc ? key(arr[mid]!) >= key(z) : key(arr[mid]!) <= key(z);
      if (before) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, z);
  };
  for (let i = 3; i < bars.length; i++) {
    const older = bars[i - 3]!;
    const newer = bars[i - 1]!;
    if (older.low > newer.high) {
      const z: FvgZone = {
        kind: 'bear',
        top: older.low,
        bottom: newer.high,
        startIndex: i - 3,
        endIndex: i,
        mitigated: false,
      };
      insert(bear, z, (x) => x.top, true);
    } else if (older.high < newer.low) {
      const z: FvgZone = {
        kind: 'bull',
        top: newer.low,
        bottom: older.high,
        startIndex: i - 3,
        endIndex: i,
        mitigated: false,
      };
      insert(bull, z, (x) => x.bottom, false);
    }
    const close = newer.close;
    while (bull.length && close < bull[bull.length - 1]!.bottom)
      done.push({ ...bull.pop()!, mitigated: true });
    while (bear.length && close > bear[bear.length - 1]!.top)
      done.push({ ...bear.pop()!, mitigated: true });
  }
  return [...done, ...bull, ...bear].sort((a, b) => a.startIndex - b.startIndex);
}
