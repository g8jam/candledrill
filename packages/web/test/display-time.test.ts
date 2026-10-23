// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { isNyDst, nyToTaipei, taipeiToNy } from '../src/display-time.js';

const wall = (iso: string) => Date.parse(`${iso}Z`) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 16);

describe('Taiwan-time display', () => {
  it('knows US daylight saving boundaries (2025: Mar 9 and Nov 2, 02:00 local)', () => {
    expect(isNyDst(wall('2025-03-09T01:59'))).toBe(false);
    expect(isNyDst(wall('2025-03-09T03:00'))).toBe(true);
    expect(isNyDst(wall('2025-11-02T00:59'))).toBe(true);
    expect(isNyDst(wall('2025-11-02T02:00'))).toBe(false);
  });

  it('maps the CME daily break 17:00-18:00 New York to Taipei', () => {
    expect(iso(nyToTaipei(wall('2025-07-15T17:00')))).toBe('2025-07-16T05:00');
    expect(iso(nyToTaipei(wall('2025-01-15T17:00')))).toBe('2025-01-16T06:00');
  });

  it('round-trips', () => {
    for (const s of ['2025-07-15T09:30', '2025-01-15T18:00', '2026-10-21T19:59']) {
      expect(iso(taipeiToNy(nyToTaipei(wall(s))))).toBe(s);
    }
  });
});
