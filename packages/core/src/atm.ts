// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Session zones, ported from the TradingView script "Asia/Tokyo Zone by Adamtrade" (ATM)
// with its default inputs: Asia and Tokyo on, NY off, 10 sessions kept, pivots extended
// "Until Mitigated" from the "Most Recent" session only.
//
// The script's GMT+8 windows with its summer/winter toggle both map to fixed New York
// times (Asia 18:00-19:00, Tokyo 21:00-22:00), so windows here are exchange-local minutes
// and daylight saving needs no toggle when the data is in New York time.
//
// Per bar, in this order (as the script does):
// 1. The first bar inside a window starts a session (box + high/low pivots).
// 2. Inside the window the box and pivots follow new highs / lows.
// 3. The most recent session's pivots extend to this bar while unmitigated; a high above
//    the pivot high (low below the pivot low) mitigates it, and it stops there.

import { exchangeLocalMinute } from './indicators.js';
import type { Bar } from './types.js';

export interface AtmWindow {
  readonly key: string;
  /** Exchange-local minute of day, inclusive. */
  readonly startMinute: number;
  /** Exchange-local minute of day, exclusive. */
  readonly endMinute: number;
}

export const ATM_WINDOWS: readonly AtmWindow[] = [
  { key: 'asia', startMinute: 18 * 60, endMinute: 19 * 60 },
  { key: 'tokyo', startMinute: 21 * 60, endMinute: 22 * 60 },
  // Local addition: New York 07:00-09:00 (Taipei 20:00-22:00 in winter, 19:00-21:00 in summer).
  { key: 'ny', startMinute: 7 * 60, endMinute: 9 * 60 },
];

export interface AtmSession {
  readonly key: string;
  /** First and last bar inside the window (box left / right). */
  readonly startIndex: number;
  readonly endIndex: number;
  readonly high: number;
  readonly highIndex: number;
  /** Bar where the high pivot line ends. */
  readonly highEnd: number;
  readonly low: number;
  readonly lowIndex: number;
  readonly lowEnd: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export function atmSessions(
  bars: readonly Bar[],
  utcOffsetMinutes = 0,
  windows: readonly AtmWindow[] = ATM_WINDOWS,
  maxSessions = 10,
): AtmSession[] {
  const out: AtmSession[] = [];
  for (const w of windows) {
    const kept: Mutable<AtmSession>[] = [];
    let cur: Mutable<AtmSession> | undefined;
    let highValid = false;
    let lowValid = false;
    let prevIn = false;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i]!;
      const m = exchangeLocalMinute(b.time, utcOffsetMinutes);
      const inside = m >= w.startMinute && m < w.endMinute;
      if (inside && !prevIn) {
        cur = {
          key: w.key,
          startIndex: i,
          endIndex: i,
          high: b.high,
          highIndex: i,
          highEnd: i,
          low: b.low,
          lowIndex: i,
          lowEnd: i,
        };
        highValid = true;
        lowValid = true;
        kept.push(cur);
        if (kept.length > maxSessions) kept.shift();
      }
      prevIn = inside;
      if (!cur) continue;
      if (inside) {
        cur.endIndex = i;
        if (b.high > cur.high) {
          cur.high = b.high;
          cur.highIndex = i;
        }
        if (b.low < cur.low) {
          cur.low = b.low;
          cur.lowIndex = i;
        }
      }
      if (highValid) cur.highEnd = i;
      if (b.high > cur.high) highValid = false;
      if (lowValid) cur.lowEnd = i;
      if (b.low < cur.low) lowValid = false;
    }
    out.push(...kept);
  }
  return out;
}
