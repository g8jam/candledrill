// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DAY CE: high, low and 50% (CE) of the last few completed daily candles. Days follow the
// dataset's trading-day start (dayStartMinutes), as the daily aggregation does; the day
// that is still forming is left out.

import { bucketStart, DAY_SECONDS, type AggregateOptions } from './aggregate.js';
import type { Bar } from './types.js';

export interface DayLevels {
  /** Trading day the candle belongs to, "MM/DD" (the date the session ends on). */
  readonly label: string;
  /** First bar of that day. */
  readonly startIndex: number;
  readonly high: number;
  readonly low: number;
  /** (high + low) / 2, unrounded. */
  readonly mid: number;
}

/** Oldest first; at most `count` completed days. */
export function dayCe(bars: readonly Bar[], opts: AggregateOptions = {}, count = 3): DayLevels[] {
  const days: { start: number; startIndex: number; high: number; low: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const start = bucketStart(b.time, DAY_SECONDS, opts);
    const cur = days.at(-1);
    if (!cur || cur.start !== start) days.push({ start, startIndex: i, high: b.high, low: b.low });
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
    }
  }
  // The last day is still forming.
  const offset = (opts.utcOffsetMinutes ?? 0) * 60;
  return days
    .slice(0, -1)
    .slice(-count)
    .map((d) => {
      const end = new Date((d.start + offset + DAY_SECONDS - 1) * 1000);
      const mm = String(end.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(end.getUTCDate()).padStart(2, '0');
      return {
        label: `${mm}/${dd}`,
        startIndex: d.startIndex,
        high: d.high,
        low: d.low,
        mid: (d.high + d.low) / 2,
      };
    });
}
