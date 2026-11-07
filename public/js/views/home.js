import { api, html, raw, money, when, levelBadge, pct, importancePhrase } from '../core.js';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

export async function renderHome(el, ctx) {
  const d = await api('/api/home');
  if (!ctx.isCurrent()) return;
  const total = d.accounts.reduce((s, a) => s + a.balanceM, 0);
  const gap = d.topGap;

  el.innerHTML = String(html`<div class="stack">
    <section class="hero-balance">
      <p class="greeting">${greeting()}, ${d.me.name.split(' ')[0]}.</p>
      <p class="value">${money(total)}</p>
      <p class="meta">Across your accounts</p>
    </section>

    <div class="accounts">
      ${d.accounts.map((a) => html`<div><p class="eyebrow">${a.name}</p><p class="v tnum">${money(a.balanceM)}</p><p class="tiny muted">${a.number}</p></div>`)}
    </div>

    <a class="btn primary block" href="#/pay">Make a payment</a>

    ${d.awaitingYou ? html`<a class="notice" href="#/messages"><span class="mark"></span><span class="grow"><strong>${d.awaitingYou === 1 ? 'A friend is' : `${d.awaitingYou} friends are`} waiting on your view.</strong><br><span class="ink2 small">Open Private Line to reply.</span></span></a>` : ''}

    ${d.held.length ? html`<section class="section">
      <h2>On hold</h2>
      <div class="list">
        ${d.held.map((t) => html`<a class="item" href="#/tx/${t.id}">
          <div class="row between top">
            <div class="grow"><p class="title">${t.assetName}</p><p class="meta">${t.topicName} · ${t.adviceCount} answered${t.pendingRequests ? ` · ${t.pendingRequests} waiting` : ''}</p></div>
            <div style="text-align:right"><p class="tnum" style="font-weight:550">${money(t.sizeM)}</p>${t.worstBias ? levelBadge(t.worstBias) : raw('<span class="meta">No answers yet</span>')}</div>
          </div></a>`)}
      </div>
    </section>` : ''}

    ${gap && gap.gap > 0.25 ? html`<section class="section">
      <h2>Your network</h2>
      <a class="card flat" href="#/network" style="text-decoration:none">
        <p class="eyebrow">Biggest gap</p>
        <p style="font-family:var(--serif);font-size:19px;margin-top:4px">${gap.name}</p>
        <p class="small ink2" style="margin-top:6px">It is ${importancePhrase(gap.relevance)}, and your friends cover ${pct(gap.coverage)} of it.${gap.bridges?.[0] ? ` ${gap.bridges[0].name} could fill it${gap.bridges[0].path ? `, through ${gap.bridges[0].path.viaName}` : ''}.` : ''}</p>
      </a>
    </section>` : ''}

    <section class="section">
      <div class="section-title"><h2>Recent activity</h2></div>
      <div class="list">
        ${d.activity.length ? d.activity.map((a) => html`<${raw(a.dealId ? 'a' : 'div')} class="item" ${raw(a.dealId ? `href="#/tx/${a.dealId}"` : '')}>
          <div class="row between"><div class="grow"><p class="title">${a.label}</p><p class="meta">${a.sub} · ${when(a.at)}</p></div>
          <p class="tnum ${a.amountM < 0 ? 'amt-out' : 'amt-in'}" style="font-weight:550">${money(a.amountM, { sign: true })}</p></div>
        </${raw(a.dealId ? 'a' : 'div')}>`) : raw('<div class="empty">No activity yet</div>')}
      </div>
    </section>
  </div>`);
}
