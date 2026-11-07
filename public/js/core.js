// Shared helpers: API client, HTML escaping, formatting, toasts and tooltips.

const STORAGE_KEY = 'inner-circle:member';

export const session = {
  get memberId() {
    try { return localStorage.getItem(STORAGE_KEY) || 'm01'; } catch { return 'm01'; }
  },
  set memberId(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode: falls back to default */ }
  },
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'x-member-id': session.memberId, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Markup that is already safe. html`` returns one, so templates nest without double-escaping. */
class Safe {
  constructor(s) { this.__raw = s; }
  toString() { return this.__raw; }
}
export const raw = (s) => new Safe(String(s));
const render = (v) => (v instanceof Safe ? v.__raw : Array.isArray(v) ? v.map(render).join('') : v === false || v == null ? '' : esc(v));

/** Tagged template that escapes every interpolation unless it is already Safe. */
export function html(strings, ...values) {
  return new Safe(strings.reduce((out, s, i) => out + render(values[i - 1]) + s));
}

/** Money is held in millions of dollars throughout. */
export function money(m, { sign = false } = {}) {
  if (m == null || Number.isNaN(m)) return '—';
  const abs = Math.abs(m);
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(abs >= 10_000 ? 1 : 2)}B` : abs >= 1 ? `$${abs.toLocaleString(undefined, { maximumFractionDigits: abs >= 100 ? 0 : 1 })}M` : `$${Math.round(abs * 1000).toLocaleString()}K`;
  return `${sign ? (m < 0 ? '−' : '+') : m < 0 ? '−' : ''}${s}`;
}

/** Gap relevance is relative to the member's own most active area, so it reads as a word, not a share. */
export const importance = (r) => (r >= 0.7 ? 'high' : r >= 0.4 ? 'medium' : 'low');
export const importancePhrase = (r) => (r >= 0.7 ? 'one of your most active areas' : r >= 0.4 ? 'a significant area for you' : 'an area where members are moving');

export const pct = (x, dp = 0) => (x == null ? '—' : `${(x * 100).toFixed(dp)}%`);
export const mult = (x) => (x == null ? '—' : `${Number(x).toFixed(2)}x`);
export const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('');

export function when(ts) {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: diff > 300 * 86_400_000 ? 'numeric' : undefined });
}

const LEVELS = { low: ['✓', 'Low risk'], elevated: ['!', 'Elevated'], high: ['▲', 'High risk'] };
export const levelBadge = (level) => html`<span class="level ${level}"><i aria-hidden="true">${LEVELS[level][0]}</i>${LEVELS[level][1]}</span>`;

export const verdictPill = (rec, confidence) => html`<span class="verdict ${rec}">${rec === 'proceed' ? 'Send it' : 'Hold off'}${confidence ? ` · ${Math.round(confidence * 100)}%` : ''}</span>`;

export function credMeter(cred) {
  const evidence = { strong: 'strong record', moderate: 'some record', thin: 'thin record' }[cred.evidence];
  return html`<div class="row small" title="Credibility in this area, learned from their transactions and advice on the platform">
    <span class="tnum" style="width:30px;font-weight:600">${cred.score}</span>
    <div class="meter thin grow" role="img" aria-label="Credibility ${cred.score} out of 100"><b style="width:${cred.score}%"></b></div>
    <span class="meta" style="width:92px;text-align:right">${evidence}</span>
  </div>`;
}

export function conflictChips(c) {
  if (!c) return '';
  const chips = [];
  if (c.stake) chips.push('<span class="chip warn">Holds a stake in this</span>');
  if (c.exited) chips.push('<span class="chip warn">Sold out of this in the past year</span>');
  if (c.rival) chips.push('<span class="chip caution">Competing for the same deals</span>');
  return raw(chips.join(''));
}

let toastTimer;
export function toast(message, { error = false } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast${error ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 5000 : 3200);
}

/** One tooltip for every chart: any element with data-tip shows it on hover and keyboard focus. */
export function installTooltips() {
  const tip = document.getElementById('tip');
  const show = (target, x, y) => {
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
    tip.style.top = `${Math.max(8, y - tip.offsetHeight - 12)}px`;
  };
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) show(t, e.clientX, e.clientY); else tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    show(t, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', () => { tip.hidden = true; });
}

export const loading = () => '<div class="stack"><div class="skeleton"></div><div class="skeleton" style="height:200px"></div></div>';
