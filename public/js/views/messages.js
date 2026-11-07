import { api, html, raw, money, pct, when, initials, toast, levelBadge, verdictPill } from '../core.js';

export async function renderThreads(el, ctx) {
  const threads = await api('/api/threads');
  if (!ctx.isCurrent()) return;
  el.innerHTML = String(html`<div class="stack">
    <div><h1>Private Line</h1><p class="small ink2" style="margin-top:4px">Members-only messaging inside the bank. Anything said about a transaction goes on the record. Direct conversations stay private.</p></div>
    ${threads.length ? html`<div class="list">${threads.map((t) => html`<a class="item row top" href="#/messages/${t.id}">
      <span class="avatar">${initials(t.other.name)}</span>
      <div class="grow">
        <div class="row between"><p style="font-weight:600">${t.other.name}</p><span class="tiny muted">${when(t.updatedAt)}</span></div>
        <p class="small ink2">${t.subject}</p>
        <p class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.last ? `${t.last.fromMe ? 'You: ' : ''}${t.last.verdict ? `[${t.last.verdict.rec === 'proceed' ? 'Send it' : 'Hold off'}] ` : ''}${t.last.body}` : ''}</p>
      </div>
      ${t.awaitingYou ? html`<span class="badge">Your turn</span>` : ''}
    </a>`)}</div>` : html`<div class="empty">No conversations yet</div>`}
  </div>`);
}

export async function renderThread(el, id, ctx) {
  const t = await api(`/api/threads/${id}`);
  if (!ctx.isCurrent()) return;
  const brief = t.advisorBrief;
  const state = { rec: null, confidence: 0.75 };

  el.innerHTML = String(html`<div class="stack">
    <div class="thread-head">
      <a class="back" href="#/messages" aria-label="Back to Private Line" style="text-decoration:none">‹</a>
      <span class="avatar">${initials(t.other.name)}</span>
      <div class="grow"><p style="font-weight:600">${t.other.name}</p><p class="tiny muted">${t.other.title} · ${t.other.city}</p></div>
    </div>

    ${t.deal ? html`<div class="dealbanner">
      <p><b>${t.deal.mine ? 'You are' : `${t.deal.ownerName} is`}</b> about to send <b>${money(t.deal.sizeM)}</b> to <b>${t.deal.assetName}</b> (${t.deal.topicName.toLowerCase()})${t.deal.status !== 'review' ? html` · <i>${t.deal.status === 'sent' ? 'since sent' : 'since cancelled'}</i>` : ''}.</p>
      <p class="tiny muted" style="margin-top:2px">On the record: every message here is hashed into the ledger.${t.deal.mine && t.deal.id ? raw(` <a href="#/tx/${t.deal.id}">View payment</a>`) : ''}</p>
    </div>` : ''}

    <div class="bubbles">
      ${t.messages.map((m) => html`<div class="bubble ${m.fromMe ? 'mine' : ''}">
        ${m.verdict ? verdictPill(m.verdict.rec, m.verdict.confidence) : ''}
        <p>${m.body}</p>
        ${m.intro ? html`<div class="card tight" style="margin-top:8px;background:var(--surface);color:var(--ink)">
          <p class="small">Introduction to <b>${m.intro.targetName}</b> · ${m.intro.status}</p>
          ${m.intro.canRespond ? html`<div class="btn-row" style="margin-top:8px"><button class="btn small secondary" data-intro="${m.intro.id}" data-accept="0">Decline</button><button class="btn small primary" data-intro="${m.intro.id}" data-accept="1">Introduce</button></div>` : ''}
        </div>` : ''}
        <p class="meta muted">${when(m.at)}${m.ledgerSeq ? ` · entry #${m.ledgerSeq}` : ''}</p>
      </div>`)}
    </div>

    ${brief ? html`<div class="card stack-sm" id="brief">
      <h2>Give your call</h2>
      <p class="small ink2">${t.other.name.split(' ')[0]} will see your call next to an estimate of how likely it is to work against them. This goes on the record with your call:</p>
      <ul class="factors">
        <li><b>${brief.disclosure.stake ? 'Yes' : 'No'}</b><span>You hold a stake in ${t.deal.assetName}</span></li>
        <li><b>${brief.disclosure.exited ? 'Yes' : 'No'}</b><span>You sold out of it in the past year</span></li>
        <li><b>${brief.disclosure.rival ? 'Yes' : 'No'}</b><span>You are buying in this space right now</span></li>
        <li><b class="tnum">${brief.yourRecord.score}</b><span>Your record in ${t.deal.topicName.toLowerCase()} (${brief.yourRecord.hits} of ${brief.yourRecord.calls} calls right)</span></li>
      </ul>
      <div class="btn-row">
        <button class="pick" data-rec="proceed" aria-pressed="false">Send it</button>
        <button class="pick" data-rec="pass" aria-pressed="false">Hold off</button>
      </div>
      <p class="small" id="scorepreview"></p>
      <label class="field"><span>How sure are you? <b id="confval">75%</b></span><input type="range" id="conf" min="50" max="100" value="75" step="5"></label>
      <textarea class="textarea" id="reason" placeholder="Why? One or two sentences. This is what they will read." maxlength="1000"></textarea>
      <div class="btn-row"><button class="btn ghost" id="decline">I would rather not</button><button class="btn primary" id="sendcall" disabled>Send my call</button></div>
    </div>` : ''}

    <form class="composer" id="composer">
      <input class="input" id="msg" placeholder="${brief ? 'Or just reply…' : 'Message'}" autocomplete="off" maxlength="2000" aria-label="Message">
      <button class="btn primary small" type="submit">Send</button>
    </form>
  </div>`);

  const post = async (body, message) => {
    try {
      await api(`/api/threads/${id}/messages`, { method: 'POST', body });
      if (message) toast(message);
      ctx.refresh();
    } catch (err) { toast(err.message, { error: true }); }
  };

  el.querySelector('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = el.querySelector('#msg').value.trim();
    if (body) post({ body });
  });

  el.querySelectorAll('[data-intro]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/intros/${b.dataset.intro}/respond`, { method: 'POST', body: { accept: b.dataset.accept === '1' } });
      toast(b.dataset.accept === '1' ? 'Introduction made' : 'Declined');
      ctx.refresh();
    } catch (err) { toast(err.message, { error: true }); }
  }));

  if (brief) {
    const preview = el.querySelector('#scorepreview');
    const sendBtn = el.querySelector('#sendcall');
    const reason = el.querySelector('#reason');
    const sync = () => {
      sendBtn.disabled = !state.rec || reason.value.trim().length < 10;
      if (state.rec) {
        const s = brief.scoring[state.rec];
        preview.innerHTML = String(html`How it will be scored: ${levelBadge(s.level)} <span class="muted">${pct(s.probability)} chance of working against ${t.other.name.split(' ')[0]}${s.conflictLift > 0.005 ? `, ${Math.round(s.conflictLift * 100)} points of it from your position` : ''}</span>`);
      }
    };
    el.querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', () => {
      state.rec = b.dataset.rec;
      el.querySelectorAll('[data-rec]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sync();
    }));
    el.querySelector('#conf').addEventListener('input', (e) => { state.confidence = Number(e.target.value) / 100; el.querySelector('#confval').textContent = `${e.target.value}%`; });
    reason.addEventListener('input', sync);
    sendBtn.addEventListener('click', () => post({ body: reason.value.trim(), verdict: { rec: state.rec, confidence: state.confidence } }, 'Your call is on the record'));
    el.querySelector('#decline').addEventListener('click', async () => {
      try {
        await api(`/api/requests/${t.request.id}/decline`, { method: 'POST' });
        toast('Declined');
        ctx.refresh();
      } catch (err) { toast(err.message, { error: true }); }
    });
  }
  const bubbles = el.querySelector('.bubbles');
  bubbles.lastElementChild?.scrollIntoView({ block: 'nearest' });
}
