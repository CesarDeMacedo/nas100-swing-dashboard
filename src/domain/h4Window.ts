/**
 * Buckets a timestamp into its 4-hour H4 window index, in pure UTC epoch terms — no
 * timezone handling needed, and therefore immune to DST by construction. Two timestamps
 * are in the same H4 window iff they return the same value.
 */
export const h4Window = (time: string) => Math.floor(Date.parse(time) / (4 * 60 * 60 * 1000));
