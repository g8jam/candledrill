// SPDX-License-Identifier: AGPL-3.0-or-later
//
// RTH opening gap: the previous regular session's close (the bar before 16:15 New York,
// 05:14 Taipei in winter) and today's open (09:30 New York, 22:30 Taipei in winter).
// Like the ATM zones, times are exchange-local (New York wall time for the NQ datasets),
// so daylight saving needs no handling here.

import type { Bar } from './types.js';

export interface RthGap {
  /** Last regular-session bar of the previous day. */
  readonly closeIndex: number;
  readonly close: number;
  /** First regular-session bar of the day. */
  readonly openIndex: number;
  readonly open: number;
  /** Exchange-local date of the open, "YYYY-MM-DD". */
  readonly date: string;
}

const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60 + 15;

/** The most recent opening gap, or null before the second regular session. */
export function rthGap(bars: readonly Bar[], utcOffsetMinutes = 0): RthGap | null {
  let gap: RthGap | null = null;
  let last: { index: number; close: number; day: number } | undefined;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const local = b.time + utcOffsetMinutes * 60;
    const day = Math.floor(local / 86_400);
    const minute = Math.floor((local - day * 86_400) / 60);
    if (minute < RTH_OPEN || minute >= RTH_CLOSE) continue;
    if (last && last.day !== day) {
      gap = {
        closeIndex: last.index,
        close: last.close,
        openIndex: i,
        open: b.open,
        date: new Date(day * 86_400_000).toISOString().slice(0, 10),
      };
    }
    last = { index: i, close: b.close, day };
  }
  return gap;
}
