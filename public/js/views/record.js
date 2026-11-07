import { api, html, raw, money, when } from '../core.js';

const KINDS = [['', 'All'], ['advice', 'Advice'], ['decision', 'Decisions'], ['outcome', 'Outcomes'], ['request', 'Questions'], ['message', 'Messages']];

export async function renderRecord(el, ctx) {
  let kind = '';
  const draw = async () => {
    const r = await api(`/api/record${kind ? `?kind=${kind}` : ''}`);
    if (!ctx.isCurrent()) return;
    const v = r.verify;
    const m = r.model;
    el.innerHTML = String(html`<div class="stack">
      <div><h1>The record</h1><p class="small ink2" style="margin-top:4px">Every question, piece of advice, decision and outcome, chained together so none of it can be quietly changed later.</p></div>

      <div class="card row">
        <span class="level ${v.ok ? 'low' : 'high'}"><i aria-hidden="true">${v.ok ? '✓' : '▲'}</i></span>
        <div class="grow"><p style="font-weight:600">${v.ok ? 'Record intact' : `Tampering detected at entry #${v.brokenAt}`}</p>
        <p class="tiny muted">${v.length.toLocaleString()} entries · latest <span class="hash">${v.head.slice(0, 16)}…</span></p></div>
      </div>

      <div class="section-title"><h2>Who to blame</h2><span class="small">across your completed payments</span></div>
      ${r.board.length ? html`<div class="card" style="padding:4px 12px"><table class="data">
        <thead><tr><th>Advisor</th><th class="num">Calls right</th><th class="num">Cost you</th><th class="num">Made you</th></tr></thead>
        <tbody>${r.board.map((b) => html`<tr>
          <td><b style="font-weight:600">${b.name}</b>${b.conflictedCalls ? html`<br><span class="tiny muted">${b.conflictedCalls} call${b.conflictedCalls === 1 ? '' : 's'} with money on the line</span>` : ''}${b.warnings ? html`<br><span class="tiny muted">warned you ${b.warnings}×</span>` : ''}</td>
          <td class="num">${b.right}/${b.calls}</td><td class="num">${b.blamedM ? money(b.blamedM) : '—'}</td><td class="num">${b.creditedM ? money(b.creditedM) : '—'}</td>
        </tr>`)}</tbody></table>
        <p class="tiny muted" style="padding:8px 0">Each advisor carries a share of the result in proportion to how hard they pushed the call you followed. You always carry 40% of any call you took on someone’s advice.</p>
      </div>` : html`<div class="card flat small muted">Nothing to settle yet.</div>`}

      <details class="card"><summary>How the bias estimate works</summary>
        <div class="stack-sm" style="margin-top:10px">
          <p class="small">A model trained on <b>${m.trainedOn}</b> pieces of advice on the platform whose outcomes are known. It estimates how likely a call is to work against the person receiving it, from what the advisor stood to gain, their record, and how hard they pushed.</p>
          <p class="small">Accuracy on advice it was not trained on: <b>${m.holdoutAuc ?? '—'}</b> AUC (0.5 is a coin flip, 1.0 is perfect). That is a modest signal: treat it as a warning light, not a verdict. It starts from the assumption that conflicts matter and updates as outcomes come in.</p>
          <table class="data"><thead><tr><th>Signal</th><th class="num">Weight</th></tr></thead>
          <tbody>${m.weights.map((w) => html`<tr><td>${w.label}</td><td class="num">${w.weight > 0 ? '+' : ''}${w.weight.toFixed(2)}</td></tr>`)}</tbody></table>
        </div>
      </details>

      <div class="section-title"><h2>Entries involving you</h2></div>
      <div class="chips">${KINDS.map(([k, label]) => html`<button class="pick" data-kind="${k}" aria-pressed="${k === kind}">${label}</button>`)}</div>
      <div class="list">${r.entries.map((e) => html`<${raw(e.dealId ? 'a' : 'div')} class="item" ${raw(e.dealId ? `href="#/tx/${e.dealId}"` : '')}>
        <div class="row between top"><p class="small grow">${e.summary}</p><span class="tiny muted" style="white-space:nowrap">#${e.seq}</span></div>
        <p class="tiny muted">${when(e.ts)} · <span class="hash">${e.hash.slice(0, 12)}…</span></p>
      </${raw(e.dealId ? 'a' : 'div')}>`)}</div>
    </div>`);
    el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; draw(); }));
  };
  await draw();
}
