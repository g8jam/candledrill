// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Optional Taiwan-time display. Bars, indicators and session rules stay on the
// exchange-local clock (New York wall time for the NQ datasets); only what is shown on
// screen is converted. New York follows US daylight saving (second Sunday of March to
// first Sunday of November, 02:00 local); Taipei is UTC+8 all year, so Taipei is New York
// +12 h in summer and +13 h in winter.

const KEY = 'candledrill.taipeiTime';

/** On by default in the browser; off where there is no storage (tests). */
export const taipeiTime = {
  on: (() => {
    try {
      return localStorage.getItem(KEY) !== '0';
    } catch {
      return false;
    }
  })(),
};

export function setTaipeiTime(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Preference only.
  }
  taipeiTime.on = on;
}

const HOUR = 3600;
const DAY = 86_400;

/** Unix seconds of 00:00 on the n-th Sunday (1-based) of a month, as a wall clock. */
function nthSunday(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month, 1) / 1000;
  const dow = new Date(first * 1000).getUTCDay();
  return first + (((7 - dow) % 7) + (n - 1) * 7) * DAY;
}

/** Is this New York wall-clock time (seconds, as if UTC) in daylight saving time? */
export function isNyDst(wall: number): boolean {
  const year = new Date(wall * 1000).getUTCFullYear();
  const start = nthSunday(year, 2, 2) + 2 * HOUR;
  const end = nthSunday(year, 10, 1) + 2 * HOUR;
  return wall >= start && wall < end;
}

/** New York wall clock -> Taipei wall clock. */
export function nyToTaipei(wall: number): number {
  return wall + (isNyDst(wall) ? 12 : 13) * HOUR;
}

/** Taipei wall clock -> New York wall clock. */
export function taipeiToNy(wall: number): number {
  const summer = wall - 12 * HOUR;
  return isNyDst(summer) ? summer : wall - 13 * HOUR;
}

/** Exchange-local wall clock -> the wall clock shown on screen. */
export function toDisplayWall(wall: number): number {
  return taipeiTime.on ? nyToTaipei(wall) : wall;
}

/** Wall clock shown on screen -> exchange-local wall clock. */
export function fromDisplayWall(wall: number): number {
  return taipeiTime.on ? taipeiToNy(wall) : wall;
}
