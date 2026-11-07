import { api, session, installTooltips, toast, loading } from './core.js';
import { renderHome } from './views/home.js';
import { renderPay } from './views/pay.js';
import { renderTransaction } from './views/transaction.js';
import { renderThreads, renderThread } from './views/messages.js';
import { renderNetwork } from './views/network.js';
import { renderRecord } from './views/record.js';
import { installSheet } from './components.js';

const view = document.getElementById('view');

const ROUTES = [
  [/^\/home$/, 'home', renderHome],
  [/^\/pay$/, 'pay', renderPay, { flow: true }],
  [/^\/tx\/([\w-]+)$/, 'home', renderTransaction],
  [/^\/messages$/, 'messages', renderThreads],
  [/^\/messages\/([\w-]+)$/, 'messages', renderThread],
  [/^\/network$/, 'network', renderNetwork],
  [/^\/record$/, 'record', renderRecord],
];

let renderToken = 0;

async function route() {
  const path = location.hash.replace(/^#/, '') || '/home';
  const match = ROUTES.find(([re]) => re.test(path));
  if (!match) { location.hash = '#/home'; return; }
  const [re, tab, render, opts = {}] = match;
  const params = path.match(re).slice(1);
  document.body.classList.toggle('flow', !!opts.flow);
  for (const a of document.querySelectorAll('#tabbar a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const token = ++renderToken;
  view.innerHTML = loading();
  try {
    // Each view gets a context so stale renders (after quick navigation) are discarded.
    await render(view, ...params, { isCurrent: () => token === renderToken, refresh: route });
  } catch (err) {
    if (token !== renderToken) return;
    view.innerHTML = `<div class="empty">${err.message.replace(/[<>&]/g, '')}</div>`;
  }
  if (token === renderToken) { window.scrollTo(0, 0); refreshBadge(); }
}

async function refreshBadge() {
  try {
    const threads = await api('/api/threads');
    document.getElementById('msgdot').hidden = !threads.some((t) => t.awaitingYou);
  } catch { /* badge is cosmetic */ }
}

async function boot() {
  installTooltips();
  installSheet();
  const select = document.getElementById('viewas');
  const members = await api('/api/members');
  select.innerHTML = members.map((m) => `<option value="${m.id}">${m.name.replace(/[<>&]/g, '')}</option>`).join('');
  select.value = session.memberId;
  if (!select.value) { session.memberId = members[0].id; select.value = members[0].id; }
  select.addEventListener('change', () => {
    session.memberId = select.value;
    toast(`Now viewing as ${select.selectedOptions[0].textContent}`);
    if (location.hash === '#/home') route(); else location.hash = '#/home';
  });
  window.addEventListener('hashchange', route);
  route();
}

boot().catch((err) => { view.innerHTML = `<div class="empty">Could not start: ${err.message}</div>`; });
