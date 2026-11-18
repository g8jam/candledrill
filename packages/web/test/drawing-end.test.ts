// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { drawingEnd } from '../src/chart.js';

describe('drawingEnd (clear drawings older than 3 days)', () => {
  it('uses the last point of each drawing', () => {
    expect(drawingEnd({ kind: 'hline', id: 'a', price: 1 })).toBeNull();
    expect(drawingEnd({ kind: 'text', id: 'b', t: 50, price: 1, text: 'x' })).toBe(50);
    expect(
      drawingEnd({
        kind: 'freehand',
        id: 'c',
        points: [
          { t: 10, p: 1 },
          { t: 30, p: 2 },
          { t: 20, p: 3 },
        ],
      }),
    ).toBe(30);
    expect(drawingEnd({ kind: 'eighth', id: 'd', t1: 90, p1: 1, t2: 40, p2: 2 })).toBe(90);
  });
});
