import { html, raw, esc, mult, pct, importance } from './core.js';

const SERIES = ['var(--series-1)', 'var(--series-2)', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

/**
 * How comparable transactions turned out, one dot per transaction on a log scale of multiples.
 * Two lanes: member transactions on the platform, and public records from outside it.
 */
export function outcomeStrip(rows) {
  if (!rows.length) return '';
  const W = 500;
  const lanes = [
    { key: 'platform', label: 'Members', color: SERIES[0], y: 34 },
    { key: 'external', label: 'Public record', color: SERIES[1], y: 82 },
  ];
  const H = 128;
  const left = 92;
  const right = 14;
  const lo = Math.log(0.25);
  const hi = Math.log(4);
  const x = (m) => left + ((Math.log(Math.min(4, Math.max(0.25, m))) - lo) / (hi - lo)) * (W - left - right);
  const ticks = [0.25, 0.5, 1, 2, 4];
  const dots = [];
  for (const lane of lanes) {
    const placed = [];
    for (const r of rows.filter((r) => r.source === lane.key).sort((a, b) => a.multiple - b.multiple)) {
      const cx = x(r.multiple);
      let offset = 0;
      for (let k = 1; placed.some((p) => Math.abs(p.cx - cx) < 10 && p.offset === offset); k++) offset = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 9;
      placed.push({ cx, offset });
      const tip = `${r.year} · ${r.sizeBucket} · ${mult(r.multiple)} over ${r.holdYears}y · ${r.source === 'platform' ? 'Member transaction' : `${r.buyerType} (${r.sourceLabel})`}${r.sameAsset ? ' · same asset' : ''}`;
      dots.push(`<g tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><circle class="hit" cx="${cx}" cy="${lane.y + offset}" r="10"/><circle class="ring" cx="${cx}" cy="${lane.y + offset}" r="5" fill="${lane.color}"/>${r.sameAsset ? `<circle cx="${cx}" cy="${lane.y + offset}" r="8.5" fill="none" stroke="var(--ink)" stroke-width="1.2"/>` : ''}</g>`);
    }
  }
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Outcomes of ${rows.length} comparable transactions, as multiples of money in">
    ${lanes.map((l) => `<line class="grid" x1="${left}" x2="${W - right}" y1="${l.y}" y2="${l.y}"/><text class="lbl" x="0" y="${l.y + 4}">${l.label}</text>`).join('')}
    <line class="axis" x1="${x(1)}" x2="${x(1)}" y1="12" y2="${H - 24}"/>
    <text x="${x(1) + 4}" y="14">break-even</text>
    ${ticks.map((t) => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle" class="tnum">${t}x</text>`).join('')}
    ${dots.join('')}
  </svg>`;
  return html`<div class="stack-sm">
    <div class="legend"><span><i style="background:${raw(SERIES[0])}"></i>Member transactions</span><span><i style="background:${raw(SERIES[1])}"></i>Public records</span>${rows.some((r) => r.sameAsset) ? raw('<span><i style="border:1.2px solid var(--ink);background:none"></i>Same asset</span>') : ''}</div>
    ${raw(svg)}
    <details><summary>Show as table</summary>
      <table class="data"><thead><tr><th>Year</th><th>Size</th><th>Source</th><th class="num">Multiple</th><th class="num">Held</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td>${r.year}</td><td>${r.sizeBucket}</td><td>${r.source === 'platform' ? 'Member' : r.sourceLabel}</td><td class="num">${mult(r.multiple)}</td><td class="num">${r.holdYears}y</td></tr>`)}</tbody></table>
    </details>
  </div>`;
}

/**
 * Network gap detector as a map: how much each area matters to you against how well your friends
 * cover it. The bottom-right corner is where you would be making big calls with nobody to ask.
 */
export function adviceMap(topics) {
  const W = 500;
  const H = 300;
  const pad = { l: 56, r: 16, t: 16, b: 40 };
  const x = (v) => pad.l + v * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - v * (H - pad.t - pad.b);
  const top = new Set(topics.slice(0, 3).map((t) => t.topic));
  const short = (name) => name.split(/ & |,/)[0];
  const marks = topics.map((t) => {
    const hot = top.has(t.topic);
    const tip = `${t.name}: importance ${importance(t.relevance)} · covered ${pct(t.coverage)}${t.covering.length ? ` · best friend here: ${t.covering[0].name} (${t.covering[0].credibility}/100)` : ' · nobody credible in your network'}`;
    const cx = x(t.relevance);
    const cy = y(t.coverage);
    const anchor = cx > W - 120 ? 'end' : 'start';
    const dx = anchor === 'end' ? -10 : 10;
    return `<g tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><circle class="hit" cx="${cx}" cy="${cy}" r="12"/><circle class="ring" cx="${cx}" cy="${cy}" r="${hot ? 6 : 5}" fill="${hot ? SERIES[0] : 'var(--muted-mark)'}"/>${hot ? `<text class="lbl" x="${cx + dx}" y="${cy + 4}" text-anchor="${anchor}">${esc(short(t.name))}</text>` : ''}</g>`;
  });
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of ${topics.length} areas by how much they matter to you and how well your friends cover them">
    <rect x="${x(0.5)}" y="${y(0.4)}" width="${x(1) - x(0.5)}" height="${y(0) - y(0.4)}" fill="var(--series-1-wash)" rx="6"/>
    <text x="${x(1) - 6}" y="${y(0) - 8}" text-anchor="end">Blind spots</text>
    ${[0, 0.5, 1].map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`).join('')}
    <line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>
    ${[0, 0.5, 1].map((v) => `<text x="${x(v)}" y="${H - pad.b + 16}" text-anchor="middle">${v * 100}%</text>`).join('')}
    <text x="${x(0.5)}" y="${H - 4}" text-anchor="middle">Importance to you (relative to your most active area) →</text>
    <text x="10" y="${y(0.5)}" text-anchor="middle" transform="rotate(-90 10 ${y(0.5)})">Covered by friends →</text>
    ${marks.join('')}
  </svg>`;
  return html`${raw(svg)}
    <details><summary>Show as table</summary>
      <table class="data"><thead><tr><th>Area</th><th class="num">Importance</th><th class="num">Covered</th><th class="num">Gap</th></tr></thead>
      <tbody>${topics.map((t) => html`<tr><td>${t.name}</td><td class="num">${importance(t.relevance)}</td><td class="num">${pct(t.coverage)}</td><td class="num">${pct(t.gap)}</td></tr>`)}</tbody></table>
    </details>`;
}

/** Who carries the blame (or credit): one bar split into shares, you first. */
export function shareBar(parts) {
  const shown = parts.filter((p) => p.share > 0);
  const colors = ['var(--ink-3)', ...SERIES];
  return html`<div class="stack-sm">
    <div class="segbar" role="img" aria-label="${shown.map((p) => `${p.name} ${pct(p.share)}`).join(', ')}">
      ${shown.map((p, i) => html`<div tabindex="0" style="flex:${p.share};background:${raw(colors[i])};${raw(colors[i] === '#eda100' ? 'color:#0b0b0b' : '')}" data-tip="${p.name}: ${pct(p.share)}">${p.share >= 0.14 ? pct(p.share) : ''}</div>`)}
    </div>
    <div class="legend">${shown.map((p, i) => html`<span><i style="background:${raw(colors[i])}"></i>${p.name}</span>`)}</div>
  </div>`;
}
