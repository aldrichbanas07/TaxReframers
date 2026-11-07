import { api, html, pct, initials, toast, importance } from '../core.js';
import { adviceMap } from '../charts.js';

const FLAG_TEXT = {
  'single-point': 'Only one person covers this',
  'all-rivals': 'Everyone who covers this competes with you for deals',
  'blind-spot': 'Nobody credible in your network',
};

export async function renderNetwork(el, ctx) {
  const { gaps, friends } = await api('/api/network');
  if (!ctx.isCurrent()) return;
  const top = gaps.topics.filter((g) => g.gap >= 0.15).slice(0, 4);

  el.innerHTML = String(html`<div class="stack">
    <div>
      <p class="small muted">Advice coverage</p>
      <p style="font-size:48px;font-weight:650;letter-spacing:-0.02em;line-height:1.1">${pct(gaps.overallCoverage)}</p>
      <p class="small ink2">How much of what you do has a credible friend to ask, weighted by where your money goes and where members are moving.</p>
    </div>

    <div class="card stack-sm">
      <h2>Your advice map</h2>
      <p class="small muted">Highlighted: your three biggest gaps. Hover or tap any dot.</p>
      ${adviceMap(gaps.topics)}
    </div>

    <div class="section-title"><h2>Gaps to close</h2></div>
    ${top.length ? html`<div class="list">${top.map((g) => html`<div class="stack-sm">
      <div class="row between"><h3>${g.name}</h3><span class="small muted">importance ${importance(g.relevance)} · covered ${pct(g.coverage)}</span></div>
      ${g.flags.length ? html`<div class="chips">${g.flags.map((f) => html`<span class="chip caution">${FLAG_TEXT[f]}</span>`)}</div>` : ''}
      <p class="small ink2">${g.covering.length ? `Best you have: ${g.covering.map((c) => `${c.name} (${c.credibility}/100)`).join(', ')}.` : 'None of your friends has a credible record here.'}</p>
      ${(g.bridges ?? []).map((b) => html`<div class="row between">
        <div class="grow"><p class="small" style="font-weight:600">${b.name} · ${b.credibility.score}/100</p><p class="tiny muted">${b.path ? `Knows ${b.path.viaName}` : 'No mutual friends yet'}</p></div>
        ${b.path ? html`<button class="btn small secondary" data-intro="${b.id}" data-via="${b.path.viaId}" data-topic="${g.topic}">Ask ${b.path.viaName.split(' ')[0]}</button>` : ''}
      </div>`)}
    </div>`)}</div>` : html`<div class="card flat small">No significant gaps. Your friends cover what you do.</div>`}

    <div class="section-title"><h2>Your friends</h2><span class="small">${friends.length}</span></div>
    <div class="list">${friends.sort((a, b) => b.strength - a.strength).map((f) => html`<div class="row">
      <span class="avatar sm">${initials(f.name)}</span>
      <div class="grow"><p style="font-weight:550">${f.name}</p><p class="tiny muted">${f.title}</p></div>
      <button class="btn small ghost" data-message="${f.id}">Message</button>
    </div>`)}</div>
  </div>`);

  el.querySelectorAll('[data-intro]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const { threadId } = await api('/api/intros', { method: 'POST', body: { targetId: b.dataset.intro, viaId: b.dataset.via, topic: b.dataset.topic } });
      toast('Introduction requested on Private Line');
      location.hash = `#/messages/${threadId}`;
    } catch (err) { toast(err.message, { error: true }); }
  }));
  el.querySelectorAll('[data-message]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const { id } = await api('/api/threads', { method: 'POST', body: { toId: b.dataset.message } });
      location.hash = `#/messages/${id}`;
    } catch (err) { toast(err.message, { error: true }); }
  }));
}
