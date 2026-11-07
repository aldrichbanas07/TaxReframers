import { api, html, raw, money, pct, mult, initials, toast, credMeter, conflictChips, importancePhrase } from '../core.js';
import { outcomeStrip } from '../charts.js';
import { experienceSection, bindExperience, researchSection, bindResearch } from '../components.js';

const EXAMPLES = ['Series C in a biotech company', 'Buying a painting from a dealer', 'Minority stake in a hockey team', 'Equity in a data center campus', 'Payroll for the household staff'];
const hasConflict = (c) => !!c && (c.stake || c.exited || c.rival);

/**
 * The payment flow: who and how much → "What is this for?" → advice → two options.
 * Talk to people first (the payment is held and Private Line threads open), or continue anyway.
 */
export async function renderPay(el, ctx) {
  const [home, payees, topics] = await Promise.all([api('/api/home'), api('/api/payees'), api('/api/topics')]);
  if (!ctx.isCurrent()) return;
  const s = {
    step: 'details',
    accountId: home.accounts.find((a) => a.name === 'Investment reserve')?.id ?? home.accounts[0].id,
    payee: null,
    payeeQuery: '',
    sizeM: '',
    purpose: '',
    topic: null,
    review: null,
    selected: new Set(),
    showAllFriends: false,
    note: '',
    result: null,
  };
  const account = () => home.accounts.find((a) => a.id === s.accountId);
  const payeeName = () => s.payee?.name ?? s.payeeQuery;

  const draw = () => { el.innerHTML = String(views[s.step]()); bind[s.step]?.(); };
  const go = (step) => { s.step = step; draw(); window.scrollTo(0, 0); };
  const head = (title, n) => html`<div class="flowhead">
    <button class="back" data-back aria-label="Back">‹</button>${n ? html`<span class="eyebrow steps">Step ${n} of 3</span>` : ''}
  </div><h1>${title}</h1>`;

  const runReview = async () => {
    try {
      s.review = await api('/api/pay/review', {
        method: 'POST',
        body: { accountId: s.accountId, sizeM: Number(s.sizeM), purpose: s.purpose, assetId: s.payee?.id, payeeName: payeeName(), topic: s.topic ?? undefined },
      });
      const friends = s.review.advisory?.advisors.friends ?? [];
      const clean = friends.filter((f) => !hasConflict(f.conflicts));
      s.selected = new Set(clean.filter((f) => f.credibility.score >= 55).slice(0, 2).map((f) => f.id));
      if (!s.selected.size && clean[0]) s.selected.add(clean[0].id);
      s.showAllFriends = false;
      go('review');
    } catch (err) { toast(err.message, { error: true }); }
  };

  const submit = async (action) => {
    const r = s.review;
    try {
      s.result = await api('/api/pay', {
        method: 'POST',
        body: {
          accountId: s.accountId, sizeM: Number(s.sizeM), purpose: s.purpose, action,
          assetId: r.payee.id ?? undefined, payeeName: r.payee.name,
          topic: r.classification.personal ? 'personal' : r.classification.topic,
          advisorIds: [...s.selected], question: s.note || undefined,
        },
      });
      s.result.action = action;
      go('done');
    } catch (err) { toast(err.message, { error: true }); }
  };

  const consultLabel = () => {
    const n = s.selected.size;
    if (!n) return 'Choose someone to speak with';
    const first = s.review.advisory.advisors.friends.find((f) => s.selected.has(f.id))?.name.split(' ')[0];
    return n === 1 ? `Speak with ${first} first` : `Speak with ${n} people first`;
  };

  const views = {
    details: () => html`<div class="stack">
      ${head('Make a payment', 1)}
      <div class="field"><span>From</span>
        <div class="chips">${home.accounts.map((a) => html`<button class="pick" data-account="${a.id}" aria-pressed="${a.id === s.accountId}">${a.name} · ${money(a.balanceM)}</button>`)}</div>
      </div>
      <label class="field"><span>To</span>
        <input class="input" id="payee" autocomplete="off" placeholder="Search payees, or type a new name" value="${payeeName()}">
      </label>
      <div class="list suggest" id="suggest" hidden></div>
      <label class="field"><span>Amount</span>
        <div class="amount"><span>$</span><input id="amount" inputmode="decimal" placeholder="0" value="${s.sizeM}" aria-label="Amount in millions of dollars"><em>million</em></div>
      </label>
      <button class="btn primary block" id="next" disabled>Continue</button>
    </div>`,

    purpose: () => html`<div class="stack">
      ${head('What is this for?', 2)}
      <div class="payee"><span class="avatar">${initials(payeeName())}</span><div class="grow"><p class="title">${payeeName()}</p><p class="meta">From ${account().name}</p></div><p class="amt tnum">${money(Number(s.sizeM))}</p></div>
      <p class="lede">In your own words. Before any money moves, we find people you know who have made this kind of transaction, and how it has gone for others.</p>
      <textarea class="textarea" id="purpose" placeholder="e.g. Series C allocation in an oncology biotech" maxlength="300">${s.purpose}</textarea>
      <div class="chips">${EXAMPLES.map((e) => html`<button class="pick" data-example="${e}">${e}</button>`)}</div>
      <button class="btn primary block" id="review">Review before sending</button>
    </div>`,

    review: () => {
      const r = s.review;
      const c = r.classification;
      const top = html`${head('Before you send', 3)}
        <div class="payee"><span class="avatar">${initials(r.payee.name)}</span><div class="grow"><p class="title">${r.payee.name}</p><p class="meta">From ${account().name}${r.purpose ? ` · “${r.purpose}”` : ''}</p></div><p class="amt tnum">${money(r.sizeM)}</p></div>
        ${r.suggestedPayee ? html`<div class="callout neutral small"><span class="grow">Did you mean <strong>${r.suggestedPayee.name}</strong>? A known payee gives better advice.</span><button class="btn small quiet" data-use-suggested>Use it</button></div>` : ''}
        <div class="row between small"><span class="ink2">Read as <strong>${c.topicName ?? 'not yet clear'}</strong></span>${c.topic || c.personal ? html`<button class="linkish" data-change-topic>Change</button>` : ''}</div>
        <div class="chips" id="topicpicker" ${raw(c.topic || c.personal ? 'hidden' : '')}>
          ${topics.map((t) => html`<button class="pick" data-topic="${t.id}" aria-pressed="${t.id === c.topic}">${t.name}</button>`)}
          <button class="pick" data-topic="personal" aria-pressed="${c.personal}">Personal payment</button>
        </div>`;

      if (c.personal) {
        return html`<div class="stack">${top}
          <div class="card flat"><h2>No advice needed</h2><p class="ink2" style="margin-top:6px">Personal and household payments go straight through. Nothing is shared with your network.</p></div>
          <div class="sticky-actions"><button class="btn primary block" data-continue>Send ${money(r.sizeM)}</button></div>
        </div>`;
      }
      if (!c.topic) return html`<div class="stack">${top}<p class="ink2">Choose the closest match and we will find the right people.</p></div>`;

      const a = r.advisory;
      const cs = a.caseStudy;
      const sum = cs.summary;
      const friends = a.advisors.friends;
      const conflicted = friends.filter((f) => hasConflict(f.conflicts));
      const shownFriends = s.showAllFriends ? friends : friends.slice(0, 3).concat(friends.slice(3).filter((f) => s.selected.has(f.id)));
      const best = a.experience[0];

      const shortVersion = [
        html`<p><i></i><span>Comparable transactions typically returned <strong>${mult(sum.medianMultiple)}</strong>; ${pct(sum.lossRate)} lost money.</span></p>`,
        best
          ? html`<p><i></i><span><strong>${best.name}</strong> ${best.match === 'same-payee' ? 'has invested in this exact payee' : best.match === 'same-area' ? 'has done transactions like this' : 'has done something close to this'}${best.relation === 'friend' ? ', and is in your circle.' : `. ${best.viaName} can introduce you.`}${best.conflicts?.stake ? ' They still hold a stake, so their view is not neutral.' : ''}</span></p>`
          : html`<p><i></i><span>Nobody within reach of your network has done this. A public case-study search is available below.</span></p>`,
        ...conflicted.slice(0, 2).map((f) => html`<p><i class="warn"></i><span><strong>${f.name}</strong> ${f.conflicts.stake ? 'holds a stake in this' : f.conflicts.exited ? 'sold out of this in the past year' : 'is competing for the same deals'}. Weigh their view accordingly.</span></p>`),
        a.gap && a.gap.gap >= 0.25 ? html`<p><i></i><span>${a.gap.name} is the #${a.gapRank} gap in your network: ${importancePhrase(a.gap.relevance)}, with ${pct(a.gap.coverage)} covered by friends.</span></p>` : '',
      ];

      return html`<div class="stack">${top}

        <section class="section">
          <p class="eyebrow">The short version</p>
          <div class="short">${shortVersion}</div>
        </section>

        ${experienceSection(a.experience, { topicName: c.topicName })}

        <section class="section">
          <div class="section-title"><h2>Speak with your circle</h2><span class="meta" id="selcount">${s.selected.size} chosen</span></div>
          <p class="lede">Ranked by what they have actually done in ${c.topicName.toLowerCase()}, not what they claim.</p>
          <div class="list">
            ${shownFriends.map((f) => html`<label class="selectable">
              <input type="checkbox" data-friend="${f.id}" ${raw(s.selected.has(f.id) ? 'checked' : '')} aria-label="Speak with ${f.name}">
              <div class="grow stack-sm" style="gap:8px">
                <div><p class="title">${f.name}</p><p class="meta">${f.title}</p></div>
                ${credMeter(f.credibility)}
                <p class="tiny muted">${f.credibility.calls ? `${f.credibility.hits} of ${f.credibility.calls} calls right in this area` : 'No calls in this area yet'}${f.conflictRecord.n ? ` · ${f.conflictRecord.wrong} of ${f.conflictRecord.n} calls with money on the line went wrong (all areas)` : ''}</p>
                ${hasConflict(f.conflicts) ? html`<div class="chips">${conflictChips(f.conflicts)}</div>` : ''}
              </div>
            </label>`)}
          </div>
          ${!s.showAllFriends && friends.length > shownFriends.length ? html`<button class="btn text" data-show-all>Show all ${friends.length} friends</button>` : ''}
          <input class="input" id="note" placeholder="Add a note to your question (optional)" value="${s.note}" maxlength="300">
        </section>

        <section class="section">
          <div class="section-title"><h2>How this has gone for others</h2><span class="meta">${sum.n} closest of ${cs.pool.platform + cs.pool.external}</span></div>
          <div class="tiles">
            <div class="tile"><p class="k">Typical</p><p class="v">${mult(sum.medianMultiple)}</p></div>
            <div class="tile"><p class="k">Lost money</p><p class="v">${pct(sum.lossRate)}</p></div>
            <div class="tile"><p class="k">Doubled</p><p class="v">${pct(sum.doubleRate)}</p></div>
          </div>
          ${cs.rowsHidden ? html`<p class="fine">Too few comparable transactions to show individually without identifying anyone.</p>` : outcomeStrip(cs.rows)}
          ${cs.sameAsset ? html`<p class="small"><strong>This payee:</strong> ${cs.sameAsset.n} earlier transaction${cs.sameAsset.n === 1 ? '' : 's'}, typically ${mult(cs.sameAsset.medianMultiple)}.</p>` : ''}
          <details><summary>More detail</summary>
            <div class="stack-sm" style="margin-top:12px">
              ${cs.lessons.map((l) => html`<p class="small">${l.a.label}: ${l.metric === 'median' ? `typically ${mult(l.a.value)}` : `${pct(l.a.value)} lost money`} (${l.a.n}) against ${l.b.label.toLowerCase()}: ${l.metric === 'median' ? mult(l.b.value) : pct(l.b.value)} (${l.b.n}).</p>`)}
              <p class="small">${flowLine(cs.flows)}</p>
              ${cs.bestAdvisors.length ? html`<p class="eyebrow" style="margin-top:8px">Best record on these calls</p>
                ${cs.bestAdvisors.map((b) => html`<p class="small">${b.name} · ${b.hits} of ${b.calls} right · <span class="muted">${b.relation === 'friend' ? 'in your circle' : b.relation === 'one-intro' ? `through ${b.viaName}` : 'not connected'}</span></p>`)}` : ''}
            </div>
          </details>
        </section>

        ${researchSection(a.research, { prominent: !a.experience.length })}

        <div class="sticky-actions">
          <button class="btn primary block" data-consult ${raw(s.selected.size ? '' : 'disabled')}>${consultLabel()}</button>
          <button class="btn secondary block" data-continue>Continue anyway · send ${money(r.sizeM)}</button>
        </div>
      </div>`;
    },

    done: () => {
      const r = s.result;
      const names = [...s.selected].map((id) => s.review.advisory?.advisors.friends.find((f) => f.id === id)?.name).filter(Boolean);
      if (r.action === 'consult') {
        return html`<div class="stack" style="text-align:center">
          <div class="done-mark" aria-hidden="true">‖</div>
          <h1>Payment held</h1>
          <p class="lede" style="margin:0 auto">${money(Number(s.sizeM))} to ${s.review.payee.name} waits until you decide. ${names.join(' and ')} ${names.length === 1 ? 'has' : 'have'} been asked on Private Line, and their answers go on the record.</p>
          <div class="btn-row"><a class="btn secondary" href="#/messages">Private Line</a><a class="btn primary" href="#/tx/${r.id}">View payment</a></div>
        </div>`;
      }
      return html`<div class="stack" style="text-align:center">
        <div class="done-mark" aria-hidden="true">✓</div>
        <h1>Sent</h1>
        <p class="lede" style="margin:0 auto">${money(Number(s.sizeM))} to ${s.review.payee.name} from ${account().name}.</p>
        ${r.ledgerSeq ? html`<p class="fine">Recorded as entry #${r.ledgerSeq}: you went ahead${s.review.advisory ? ' after reviewing the advice' : ''}.</p>` : ''}
        <div class="btn-row"><a class="btn secondary" href="#/home">Home</a>${r.kind === 'transaction' ? html`<a class="btn primary" href="#/tx/${r.id}">View payment</a>` : html`<a class="btn primary" href="#/pay" data-again>New payment</a>`}</div>
      </div>`;
    },
  };

  const bind = {
    details: () => {
      const input = el.querySelector('#payee');
      const list = el.querySelector('#suggest');
      const amount = el.querySelector('#amount');
      const next = el.querySelector('#next');
      const valid = () => { next.disabled = !(Number(s.sizeM) > 0 && (s.payee || s.payeeQuery.trim().length >= 2)); };
      const suggest = () => {
        const q = input.value.trim().toLowerCase();
        const hits = q.length < 2 ? [] : payees.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
        list.hidden = !hits.length || s.payee?.name === input.value;
        list.innerHTML = String(html`${hits.map((p) => html`<button class="item" data-payee="${p.id}"><p class="title">${p.name}</p><p class="meta">${p.topicName}</p></button>`)}`);
      };
      input.addEventListener('input', () => { s.payee = null; s.payeeQuery = input.value; suggest(); valid(); });
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-payee]');
        if (!b) return;
        s.payee = payees.find((p) => p.id === b.dataset.payee);
        input.value = s.payee.name;
        list.hidden = true;
        valid();
        amount.focus();
      });
      amount.addEventListener('input', () => { amount.value = amount.value.replace(/[^\d.]/g, ''); s.sizeM = amount.value; valid(); });
      el.querySelectorAll('[data-account]').forEach((b) => b.addEventListener('click', () => { s.accountId = b.dataset.account; draw(); }));
      next.addEventListener('click', () => go('purpose'));
      el.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/home'; });
      valid();
      if (!s.payee && !s.payeeQuery) input.focus();
    },
    purpose: () => {
      const ta = el.querySelector('#purpose');
      ta.addEventListener('input', () => { s.purpose = ta.value; });
      el.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => { s.purpose = b.dataset.example; ta.value = s.purpose; ta.focus(); }));
      el.querySelector('#review').addEventListener('click', () => { s.topic = null; runReview(); });
      el.querySelector('[data-back]').addEventListener('click', () => go('details'));
      ta.focus();
    },
    review: () => {
      const r = s.review;
      el.querySelector('[data-back]').addEventListener('click', () => go('purpose'));
      el.querySelector('[data-change-topic]')?.addEventListener('click', () => { el.querySelector('#topicpicker').hidden = false; });
      el.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => { s.topic = b.dataset.topic; runReview(); }));
      el.querySelector('[data-use-suggested]')?.addEventListener('click', () => { s.payee = { id: r.suggestedPayee.id, name: r.suggestedPayee.name }; s.topic = null; runReview(); });
      el.querySelector('[data-show-all]')?.addEventListener('click', () => { s.showAllFriends = true; const y = window.scrollY; draw(); window.scrollTo(0, y); });
      el.querySelectorAll('[data-friend]').forEach((cb) => cb.addEventListener('change', () => {
        if (cb.checked) s.selected.add(cb.dataset.friend); else s.selected.delete(cb.dataset.friend);
        const btn = el.querySelector('[data-consult]');
        btn.disabled = !s.selected.size;
        btn.textContent = consultLabel();
        el.querySelector('#selcount').textContent = `${s.selected.size} chosen`;
      }));
      el.querySelector('#note')?.addEventListener('input', (e) => { s.note = e.target.value; });
      if (r.advisory) {
        bindExperience(el, { topic: r.classification.topic });
        bindResearch(el, { research: r.advisory.research, topic: r.classification.topic, purpose: s.purpose, payeeName: r.payee.name, sizeM: r.sizeM });
      }
      el.querySelector('[data-consult]')?.addEventListener('click', () => submit('consult'));
      el.querySelector('[data-continue]')?.addEventListener('click', () => submit('continue'));
    },
    done: () => {
      el.querySelector('[data-again]')?.addEventListener('click', (e) => { e.preventDefault(); ctx.refresh(); });
    },
  };

  draw();
}

function flowLine(f) {
  const parts = [f.buys.count ? `In the last six months, ${f.buys.members} member${f.buys.members === 1 ? '' : 's'} put ${money(f.buys.totalM)} into this area` : 'No members have bought into this area in the last six months'];
  if (f.exits.count) parts.push(`${f.exits.count} exited`);
  if (f.experts.buying || f.experts.exiting) parts.push(`those with the strongest records: ${f.experts.buying} buying, ${f.experts.exiting} exiting`);
  return `${parts.join('; ')}.`;
}
