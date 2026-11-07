import { api, html, raw, esc, toast, when, conflictChips } from './core.js';

/**
 * A small markdown renderer for dossiers: headings, paragraphs, lists, quotes and bold.
 * Text is escaped before any markup is added, so nothing in a dossier can inject HTML.
 */
export function markdown(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const line of md.split('\n')) {
    if (/^- /.test(line)) { (list ??= []).push(`<li>${inline(line.slice(2))}</li>`); continue; }
    flush();
    if (/^# /.test(line)) out.push(`<h2>${inline(line.slice(2))}</h2>`);
    else if (/^## /.test(line)) out.push(`<h3>${inline(line.slice(3))}</h3>`);
    else if (/^> ?/.test(line)) out.push(`<blockquote>${inline(line.replace(/^> ?/, ''))}</blockquote>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return raw(`<div class="md">${out.join('')}</div>`);
}

// ── Bottom sheet ─────────────────────────────────────────────────────────────
let lastFocus = null;
export function openSheet(content) {
  const sheet = document.getElementById('sheet');
  lastFocus = document.activeElement;
  sheet.querySelector('.sheet-body').innerHTML = String(content);
  sheet.hidden = false;
  document.body.classList.add('sheet-open');
  sheet.querySelector('.sheet-close').focus();
}
export function closeSheet() {
  const sheet = document.getElementById('sheet');
  if (sheet.hidden) return;
  sheet.hidden = true;
  document.body.classList.remove('sheet-open');
  lastFocus?.focus?.();
}
export function installSheet() {
  const sheet = document.getElementById('sheet');
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('.sheet-close')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('hashchange', closeSheet);
}

export async function showDossier(id) {
  try {
    const d = await api(`/api/people/${id}/dossier`);
    openSheet(html`<p class="eyebrow">Dossier${d.friend ? '' : ' · shared with you through a mutual friend'}</p>${markdown(d.markdown)}
      <p class="fine">Their record is generated from the bank's own transaction and advice history. “In their words” is written by the member.</p>`);
  } catch (err) { toast(err.message, { error: true }); }
}

// ── People who have done this ───────────────────────────────────────────────
const MATCH = { 'same-payee': 'Same payee', 'same-area': 'Same area', adjacent: 'Adjacent area' };

export function experienceSection(experience, { topicName }) {
  if (!experience.length) {
    return html`<section class="section">
      <h2>Who has done this</h2>
      <p class="lede">Nobody within reach of your network has made this kind of transaction. Public case studies below are the next best thing.</p>
    </section>`;
  }
  return html`<section class="section">
    <h2>Who has done this</h2>
    <p class="lede">People in your circle with direct experience of ${topicName.toLowerCase()} or something close to it.</p>
    <div class="people">
      ${experience.map((p) => html`<article class="person">
        <header>
          <div><h3>${p.name}</h3><p class="meta">${p.title}</p></div>
          <span class="tag ${p.match === 'same-payee' ? 'strong' : ''}">${MATCH[p.match]}</span>
        </header>
        ${p.highlight ? html`<p class="highlight">${p.highlight}</p>` : ''}
        ${p.inTheirWords ? html`<blockquote class="words">${p.inTheirWords}</blockquote>` : ''}
        ${p.conflicts && (p.conflicts.stake || p.conflicts.exited || p.conflicts.rival) ? html`<div class="chips">${conflictChips(p.conflicts)}</div>` : ''}
        <footer>
          <span class="meta">${p.relation === 'friend' ? 'In your circle' : `Through ${p.viaName}`} · credibility ${p.credibility}</span>
          <span class="actions">
            <button class="btn text" data-dossier="${p.id}">Read dossier</button>
            ${p.relation === 'one-intro' ? html`<button class="btn quiet small" data-intro="${p.id}" data-via="${p.viaId}">Ask ${p.viaName.split(' ')[0]} to introduce you</button>` : ''}
          </span>
        </footer>
      </article>`)}
    </div>
  </section>`;
}

export function bindExperience(root, { topic }) {
  root.querySelectorAll('[data-dossier]').forEach((b) => b.addEventListener('click', () => showDossier(b.dataset.dossier)));
  root.querySelectorAll('[data-intro]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/intros', { method: 'POST', body: { targetId: b.dataset.intro, viaId: b.dataset.via, topic } });
      b.disabled = true;
      b.textContent = 'Introduction requested';
    } catch (err) { toast(err.message, { error: true }); }
  }));
}

// ── Beyond your network: public case studies via Claude with web search ─────
export function researchSection(research, { prominent }) {
  const body = html`
    <p class="lede">${prominent ? 'Nobody you know has done this. ' : ''}Search reported transactions on the public web for comparable cases and how they turned out.</p>
    <div class="sendbox">
      <p class="eyebrow">What leaves the bank</p>
      <p class="query" id="rq">${research.query}</p>
      ${research.queryWithName ? html`<label class="check"><input type="checkbox" id="rq-name"> Include the payee’s name (more precise, less private)</label>` : ''}
      <p class="fine">Never your name, your account or the exact amount.</p>
    </div>
    ${research.available
      ? html`<button class="btn quiet block" id="rq-go">Search public case studies</button>`
      : html`<p class="fine">Not switched on for this bank yet. An administrator enables it by setting an Anthropic API key on the server.</p>`}
    <div id="rq-out"></div>`;
  return prominent
    ? html`<section class="section"><h2>Beyond your network</h2>${body}</section>`
    : html`<section class="section"><details class="fold"><summary><h2>Beyond your network</h2><span class="meta">Public case studies</span></summary>${body}</details></section>`;
}

export function bindResearch(root, { research, topic, purpose, payeeName, sizeM }) {
  const box = root.querySelector('#rq-name');
  const q = root.querySelector('#rq');
  box?.addEventListener('change', () => { q.textContent = box.checked ? research.queryWithName : research.query; });
  const go = root.querySelector('#rq-go');
  go?.addEventListener('click', async () => {
    const out = root.querySelector('#rq-out');
    go.disabled = true;
    go.textContent = 'Searching public sources… this can take a minute';
    try {
      const r = await api('/api/research', { method: 'POST', body: { topic, purpose, payeeName, sizeM, includeName: !!box?.checked } });
      out.innerHTML = String(html`<div class="research">
        <p>${r.summary}</p>
        ${r.cases.map((c) => html`<article class="case">
          <p class="eyebrow">${c.year}</p>
          <h3>${c.title}</h3>
          <p>${c.what}</p>
          <p><strong>Outcome.</strong> ${c.outcome}</p>
          <p><strong>Take from it.</strong> ${c.lesson}</p>
          ${c.sources.length ? html`<p class="sources">${c.sources.filter((src) => /^https?:\/\//.test(src.url)).map((s) => html`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title}</a>`)}</p>` : html`<p class="fine">No source link survived verification for this case. Treat it with care.</p>`}
        </article>`)}
        <p class="fine">Public sources gathered by Claude with web search${r.cached ? `, ${when(r.generatedAt)}` : ''}. Not verified by the bank.</p>
      </div>`);
      go.hidden = true;
    } catch (err) {
      toast(err.message, { error: true });
      go.disabled = false;
      go.textContent = 'Search public case studies';
    }
  });
}
