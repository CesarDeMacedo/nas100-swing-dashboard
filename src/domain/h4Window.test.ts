import { h4Window } from './h4Window';

describe('h4Window', () => {
  it('buckets timestamps within the same 4-hour window to the same value', () => {
    expect(h4Window('2026-07-24T13:00:00.000Z')).toBe(h4Window('2026-07-24T14:30:00.000Z'));
    expect(h4Window('2026-07-24T13:00:00.000Z')).toBe(h4Window('2026-07-24T15:59:59.999Z'));
  });

  it('buckets the start of the next window one higher', () => {
    expect(h4Window('2026-07-24T16:00:00.000Z')).toBe(h4Window('2026-07-24T13:00:00.000Z') + 1);
  });

  it('is pure UTC epoch math, unaffected by DST transitions', () => {
    // Spring-forward and fall-back boundaries in America/Toronto — h4Window must not
    // shift or skip a bucket around these, since it never looks at any timezone.
    expect(h4Window('2026-03-08T21:00:00.000Z') + 1).toBe(h4Window('2026-03-09T01:00:00.000Z'));
    expect(h4Window('2026-11-01T17:00:00.000Z') + 1).toBe(h4Window('2026-11-01T21:00:00.000Z'));
  });
});
