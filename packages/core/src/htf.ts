// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Higher-timeframe candles, after the idea of the TradingView script "ICT HTF Candles
// (fadi)": the last few candles of a higher timeframe, built from the chart's own bars
// (so the newest one updates live), plus the fair value gaps and volume imbalances
// between those candles.
//
// - FVG (three candles a, b, c): bull when c.low > a.high, bear when c.high < a.low.
// - Volume imbalance (two candles p, q): the bodies do not overlap but the wicks do.

import { bucketStart, DAY_SECONDS, type AggregateOptions } from './aggregate.js';
import { WEEK_SECONDS } from './blind.js';
import type { Bar } from './types.js';

export interface HtfImbalance {
  readonly kind: 'bull' | 'bear';
  /** Candle index (in `candles`) where the box starts; it runs to the last candle. */
  readonly index: number;
  readonly top: number;
  readonly bottom: number;
}

export interface HtfSet {
  readonly tfSeconds: number;
  /** Oldest first; the last one may still be forming. */
  readonly candles: Bar[];
  /** Unix seconds at which the last candle closes. */
  readonly end: number;
  readonly fvgs: HtfImbalance[];
  readonly volumeImbalances: HtfImbalance[];
}

/** Bucket start; weeks start on the trading day that begins on Sunday. */
export function htfBucketStart(
  time: number,
  tfSeconds: number,
  opts: AggregateOptions = {},
): number {
  if (tfSeconds !== WEEK_SECONDS) return bucketStart(time, tfSeconds, opts);
  const day = bucketStart(time, DAY_SECONDS, opts);
  const shift = (opts.utcOffsetMinutes ?? 0) * 60 - (opts.dayStartMinutes ?? 0) * 60;
  // 1970-01-01 was a Thursday; Sunday is 4 days earlier in the cycle.
  const sinceSunday = (((Math.floor((day + shift) / DAY_SECONDS) + 4) % 7) + 7) % 7;
  return day - sinceSunday * DAY_SECONDS;
}

export function htfCandles(
  bars: readonly Bar[],
  tfSeconds: number,
  count: number,
  opts: AggregateOptions = {},
): HtfSet {
  const all: Bar[] = [];
  for (const b of bars) {
    const start = htfBucketStart(b.time, tfSeconds, opts);
    const cur = all.at(-1);
    if (!cur || cur.time !== start) {
      all.push({ ...b, time: start });
      continue;
    }
    all[all.length - 1] = {
      time: cur.time,
      open: cur.open,
      high: Math.max(cur.high, b.high),
      low: Math.min(cur.low, b.low),
      close: b.close,
      volume: cur.volume + b.volume,
    };
  }
  const first = Math.max(0, all.length - Math.max(1, Math.floor(count)));
  const candles = all.slice(first);
  const fvgs: HtfImbalance[] = [];
  const volumeImbalances: HtfImbalance[] = [];
  for (let k = first; k < all.length; k++) {
    const c = all[k]!;
    const a = all[k - 2];
    // The gap belongs to the middle candle; it must be on screen.
    if (a && k - 1 >= first) {
      if (c.low > a.high)
        fvgs.push({ kind: 'bull', index: k - 1 - first, top: c.low, bottom: a.high });
      else if (c.high < a.low)
        fvgs.push({ kind: 'bear', index: k - 1 - first, top: a.low, bottom: c.high });
    }
    const p = all[k - 1];
    if (p && k - 1 >= first) {
      const pTop = Math.max(p.open, p.close);
      const pBot = Math.min(p.open, p.close);
      const cTop = Math.max(c.open, c.close);
      const cBot = Math.min(c.open, c.close);
      if (cBot > pTop && c.low <= p.high)
        volumeImbalances.push({ kind: 'bull', index: k - 1 - first, top: cBot, bottom: pTop });
      else if (cTop < pBot && c.high >= p.low)
        volumeImbalances.push({ kind: 'bear', index: k - 1 - first, top: pBot, bottom: cTop });
    }
  }
  const last = candles.at(-1);
  const end = last
    ? tfSeconds === WEEK_SECONDS
      ? last.time + WEEK_SECONDS
      : bucketStart(last.time, tfSeconds, opts) + tfSeconds
    : 0;
  return { tfSeconds, candles, end, fvgs, volumeImbalances };
}
