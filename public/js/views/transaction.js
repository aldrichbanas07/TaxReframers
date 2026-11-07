import { api, html, raw, money, pct, mult, when, initials, toast, levelBadge, verdictPill, credMeter, conflictChips } from '../core.js';
import { outcomeStrip, shareBar } from '../charts.js';
import { experienceSection, bindExperience, researchSection, bindResearch } from '../components.js';

const STATUS = { review: 'On hold', sent: 'Sent', cancelled: 'Cancelled' };

export function adviceCard(a, { showThread = true } = {}) {
  const b = a.bias;
  const factors = b.factors.slice(0, 4);
  return html`<div class="stack-sm">
    <div class="row between top">
      <div class="row"><span class="avatar sm">${initials(a.advisor.name)}</span><div><p class="title">${a.advisor.name}</p><p class="meta">${when(a.at)}</p></div></div>
      ${verdictPill(a.rec, a.confidence)}
    </div>
    <blockquote>${a.rationale}</blockquote>
    <div class="riskbox">
      <div class="row between"><span class="eyebrow">Chance this works against you</span>${levelBadge(b.level)}</div>
      <div class="row"><span class="big-pct tnum">${pct(b.probability)}</span>
        <div class="grow"><div class="meter level-${b.level}" role="img" aria-label="${pct(b.probability)}, or ${pct(b.withoutConflicts)} if they had nothing riding on it"><b style="width:${b.probability * 100}%"></b><u style="left:${b.withoutConflicts * 100}%" title="If they had nothing riding on it"></u></div></div>
      </div>
      <p class="tiny ink2">${b.conflictLift > 0.005 ? `If ${a.advisor.name.split(' ')[0]} had nothing riding on it: ${pct(b.withoutConflicts)}. Their conflicts add ${Math.round(b.conflictLift * 100)} points.` : 'No conflicts of interest found in their position.'}</p>
      ${factors.length ? html`<ul class="factors">${factors.map((f) => html`<li><b>${f.logOdds > 0 ? 'Raises' : 'Lowers'}</b><span>${f.label}${f.key === 'conflictHistory' && f.record ? ` (${f.record.wrong} of ${f.record.n} went wrong)` : ''}${f.key === 'inexperience' ? ` (${a.disclosed.credibility}/100)` : ''}</span></li>`)}</ul>` : ''}
    </div>
    <p class="fine">On the record: entry #${a.ledger?.seq} · <span class="hash">${a.ledger?.hash.slice(0, 12)}…</span>${showThread && a.threadId ? raw(` · <a href="#/messages/${a.threadId}">Open conversation</a>`) : ''}</p>
  </div>`;
}

export async function renderTransaction(el, id, ctx) {
  const t = await api(`/api/transactions/${id}`);
  if (!ctx.isCurrent()) return;
  const open = t.status === 'review';
  const asked = new Set([...t.advice.map((a) => a.advisor.id), ...t.waitingOn.map((w) => w.id)]);
  const askable = (t.advisors?.friends ?? []).filter((f) => !asked.has(f.id));
  const cs = t.caseStudy;

  el.innerHTML = String(html`<div class="stack">
    <div class="flowhead"><a class="back" href="#/home" aria-label="Back to home">‹</a><span class="tag ${t.status === 'review' ? 'strong' : ''}">${STATUS[t.status]}</span></div>
    <div class="stack-sm">
      <p class="eyebrow">${t.topicName} · ${t.account.name} · ${when(t.createdAt)}</p>
      <h1>${t.assetName}</h1>
      <p style="font-size:38px;font-weight:500;letter-spacing:-0.02em" class="tnum">${money(t.sizeM)}</p>
      ${t.purpose ? html`<p class="ink2">“${t.purpose}”</p>` : ''}
    </div>

    ${t.blame ? blameSection(t) : ''}

    <div class="section-title"><h2>${open ? 'Advice so far' : 'The advice you had'}</h2><span class="small">${t.advice.length} answer${t.advice.length === 1 ? '' : 's'}</span></div>
    ${t.advice.length ? html`<div class="list">${t.advice.map((a) => html`<div>${adviceCard(a)}</div>`)}</div>` : html`<div class="card flat small muted">${open ? 'Nobody has answered yet.' : 'You did not ask anyone before deciding.'}</div>`}

    ${t.waitingOn.length ? html`
      <div class="section-title"><h2>Waiting on</h2></div>
      <div class="list">${t.waitingOn.map((w) => html`<a class="item row" href="#/messages/${w.threadId}"><span class="avatar sm">${initials(w.name)}</span><div class="grow"><p style="font-weight:550">${w.name}</p><p class="tiny muted">Asked ${when(w.since)}</p></div><span aria-hidden="true">›</span></a>`)}</div>` : ''}

    ${open && askable.length ? html`
      <details class="card"><summary>Ask more people</summary>
        <div class="stack-sm" style="margin-top:12px">
          ${askable.map((f) => html`<label class="selectable"><input type="checkbox" data-ask="${f.id}"><div class="grow stack-sm" style="gap:4px"><p style="font-weight:600">${f.name}</p>${credMeter(f.credibility)}<div class="chips">${conflictChips(f.conflicts)}</div></div></label>`)}
          <button class="btn secondary small" id="askmore">Send on Private Line</button>
        </div>
      </details>` : ''}

    ${open ? experienceSection(t.experience, { topicName: t.topicName }) : ''}
    ${open ? researchSection(t.research, { prominent: !t.experience.length }) : ''}

    <div class="section-title"><h2>How this has gone for others</h2><span class="small">${cs.summary.n} comparable</span></div>
    <div class="card stack-sm">
      <div class="tiles">
        <div class="tile"><p class="k">Typical outcome</p><p class="v">${mult(cs.summary.medianMultiple)}</p></div>
        <div class="tile"><p class="k">Lost money</p><p class="v">${pct(cs.summary.lossRate)}</p></div>
        <div class="tile"><p class="k">Doubled+</p><p class="v">${pct(cs.summary.doubleRate)}</p></div>
      </div>
      ${cs.rowsHidden ? '' : outcomeStrip(cs.rows)}
    </div>

    ${!open && !t.outcome ? html`
      <div class="card flat stack-sm">
        <h3>How did it turn out?</h3>
        <p class="small ink2">Demo control. In live use the outcome is picked up when the distribution lands in your account, or from marks on the asset.</p>
        <div class="row"><input class="input" id="multiple" inputmode="decimal" placeholder="Multiple returned, e.g. 0.6 or 1.8" aria-label="Multiple returned"><button class="btn secondary" id="record">Record</button></div>
      </div>` : ''}

    ${open ? html`<div class="sticky-actions" style="margin:8px -16px 0;bottom:64px">
      <button class="btn primary block" data-continue>Continue anyway · send ${money(t.sizeM)}</button>
      <button class="btn ghost block" data-cancel>Cancel this payment</button>
    </div>` : ''}
  </div>`);

  const act = async (path, body, message) => {
    try {
      await api(path, { method: 'POST', body });
      toast(message);
      ctx.refresh();
    } catch (err) { toast(err.message, { error: true }); }
  };
  el.querySelector('[data-continue]')?.addEventListener('click', () => act(`/api/transactions/${id}/continue`, {}, `Sent ${money(t.sizeM)}. Recorded on the ledger.`));
  el.querySelector('[data-cancel]')?.addEventListener('click', () => act(`/api/transactions/${id}/cancel`, {}, 'Payment cancelled. Recorded on the ledger.'));
  el.querySelector('#askmore')?.addEventListener('click', () => {
    const ids = [...el.querySelectorAll('[data-ask]:checked')].map((c) => c.dataset.ask);
    if (!ids.length) { toast('Pick at least one person', { error: true }); return; }
    act(`/api/transactions/${id}/consult`, { advisorIds: ids }, 'Asked on Private Line');
  });
  if (open) {
    bindExperience(el, { topic: t.topic });
    bindResearch(el, { research: t.research, topic: t.topic, purpose: t.purpose, payeeName: t.assetName, sizeM: t.sizeM });
  }
  el.querySelector('#record')?.addEventListener('click', () => act(`/api/transactions/${id}/outcome`, { multiple: Number(el.querySelector('#multiple').value) }, 'Outcome recorded'));
}

function blameSection(t) {
  const b = t.blame;
  const amount = money(Math.abs(b.impactM));
  const headline = b.decision === 'proceed'
    ? (b.verdict === 'blame' ? `Lost ${amount}` : `Made ${amount}`)
    : (b.verdict === 'blame' ? `Missed ${amount}` : `Avoided losing ${amount}`);
  const sub = b.decision === 'proceed' ? `Returned ${mult(b.multiple)}.` : `You did not send it. It went on to return ${mult(b.multiple)}.`;
  const parts = [{ name: 'You', share: b.ownShare }, ...b.parties.filter((p) => p.share > 0).map((p) => ({ name: p.name, share: p.share }))];
  return html`<div class="card stack-sm">
    <p class="small muted">${b.verdict === 'blame' ? 'Who is on the hook' : 'Who gets the credit'}</p>
    <h2 style="font-size:22px">${headline}</h2>
    <p class="small ink2">${sub}</p>
    ${shareBar(parts)}
    <div class="list" style="margin-top:4px">${b.parties.map((p) => html`<div class="row between top">
      <div class="grow"><p style="font-weight:550">${p.name} ${p.share ? html`<span class="muted small">· ${pct(p.share)}</span>` : ''}</p>
      <p class="tiny muted">${p.followed ? 'You followed this' : 'You went against this'} · ${p.right ? 'turned out right' : 'turned out wrong'}${p.ledger ? ` · entry #${p.ledger.seq}` : ''}</p>
      ${p.conflicted ? html`<div class="chips" style="margin-top:4px"><span class="chip warn">Had money on the line when advising</span></div>` : ''}</div>
      ${verdictPill(p.rec, p.confidence)}
    </div>`)}</div>
    ${b.toldYouSo.length ? html`<p class="small"><b>Told you so:</b> ${b.toldYouSo.join(', ')}</p>` : ''}
  </div>`;
}
