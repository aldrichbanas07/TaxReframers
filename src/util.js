import { createHash } from 'node:crypto';

export const DAY = 86_400_000;
export const YEAR = 365 * DAY;

/** A multiple at or above this is a "good" outcome (beat the hurdle). */
export const HURDLE = 1.15;

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const round = (x, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;

/** Small, fast, deterministic PRNG so the seed data is reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (values) => quantile(values, 0.5);
export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Wilson score lower bound: a hit rate you can trust given the sample size. */
export function wilsonLower(hits, n, z = 1.645) {
  if (!n) return 0;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - margin) / denom;
}

/** JSON with sorted keys, so a hash over it is stable. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function sizeBucket(sizeM) {
  if (sizeM < 100) return 'Under $100M';
  if (sizeM < 250) return '$100M–$250M';
  if (sizeM < 500) return '$250M–$500M';
  if (sizeM < 1000) return '$500M–$1B';
  return 'Over $1B';
}
