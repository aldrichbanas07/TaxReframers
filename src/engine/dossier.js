import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ADJACENT, STANCES, TOPICS, topicName } from '../data/catalog.js';
import { credibility, adviceWasRight, isResolved, conflictState } from './credibility.js';

const START = '<!-- record:start (generated from the bank\'s records; edits inside this block are replaced) -->';
const END = '<!-- record:end -->';
const year = (ts) => new Date(ts).getUTCFullYear();
const money = (m) => (m >= 1000 ? `$${(m / 1000).toFixed(2)}B` : `$${Math.round(m)}M`);

/**
 * Each member has a dossier: a markdown file their network can read before asking them for advice.
 * Everything outside the record block is theirs to write ("In their words"); the record block is
 * regenerated from their transactions and advice so it never goes stale or gets embellished.
 */
export function recordSection(store, memberId) {
  const lines = [];
  const areas = TOPICS.map((t) => ({
    t,
    deals: store.dealsOf(memberId).filter((d) => d.topic === t.id && d.decision === 'proceed').sort((a, b) => b.decidedAt - a.decidedAt),
    calls: store.adviceBy(memberId).filter((a) => a.topic === t.id && isResolved(store.deal(a.dealId))),
  })).filter((x) => x.deals.length || x.calls.length).sort((a, b) => b.deals.length - a.deals.length || b.calls.length - a.calls.length);
  for (const { t, deals, calls } of areas) {
    const cred = credibility(store, memberId, t.id);
    const right = calls.filter((a) => adviceWasRight(a, store.deal(a.dealId))).length;
    const record = calls.length ? `${right} of ${calls.length} calls right` : 'no resolved calls yet';
    lines.push(`## ${t.name}`, '', deals.length ? `Credibility ${cred.score}/100 · ${deals.length} transaction${deals.length === 1 ? '' : 's'} · ${record}` : `Credibility ${cred.score}/100 · advice only · ${record}`, '');
    for (const d of deals.slice(0, 6)) {
      const asset = store.asset(d.assetId)?.name ?? 'Undisclosed';
      const result = d.outcome ? `returned **${d.outcome.multiple.toFixed(2)}x** over ${d.outcome.holdYears} years` : 'still held';
      lines.push(`- **${asset}** · ${year(d.decidedAt)} · ${money(d.sizeM)} · ${result} {asset:${d.assetId}}`);
    }
    if (deals.length > 6) lines.push(`- and ${deals.length - 6} more`);
    if (deals.length) lines.push('');
  }
  return lines.join('\n').trim();
}

function initialDossier(store, memberId) {
  const m = store.member(memberId);
  return [
    `# ${m.name}`,
    '',
    `${m.title} · ${m.city}`,
    '',
    '## In their words',
    '',
    `> ${STANCES[memberId] ?? 'No note yet.'}`,
    '',
    START,
    '',
    END,
    '',
  ].join('\n');
}

/** Create missing dossiers and refresh the record block in every one, keeping members' own words. */
export function syncDossiers(store, dir) {
  mkdirSync(dir, { recursive: true });
  for (const m of store.data.members) {
    const path = join(dir, `${m.id}.md`);
    let text = existsSync(path) ? readFileSync(path, 'utf8') : initialDossier(store, m.id);
    if (!text.includes(START) || !text.includes(END)) text = `${text.trimEnd()}\n\n${START}\n\n${END}\n`;
    const before = text.slice(0, text.indexOf(START) + START.length);
    const after = text.slice(text.indexOf(END));
    const next = `${before}\n\n${recordSection(store, m.id)}\n\n${after}`;
    if (next !== text || !existsSync(path)) writeFileSync(path, next);
  }
}

export function readDossier(dir, memberId) {
  const path = join(dir, `${memberId}.md`);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Split a dossier into its header (name, title, their words) and one section per area. */
export function parseDossier(markdown) {
  const clean = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const parts = clean.split(/^## /m);
  const header = parts.shift().trim();
  const sections = parts.map((p) => {
    const [heading, ...rest] = p.split('\n');
    return { heading: heading.trim(), body: rest.join('\n').trim() };
  });
  return { header, sections };
}

/** Markdown served to the client: drop the internal asset tags, keep everything else. */
export const publicMarkdown = (markdown) => markdown.replace(/<!--[\s\S]*?-->\n?/g, '').replace(/ \{asset:[\w-]+\}/g, '').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Who in your network has done this, or something close? Friends and people one introduction away,
 * ranked by how close their experience is (same payee, same area, adjacent area), each with the
 * parts of their dossier that matter for this transaction.
 */
export function findExperience(store, dir, me, { topic, assetId = null, limit = 4 }) {
  const reach = new Map();
  for (const f of store.friendsOf(me)) reach.set(f.id, { relation: 'friend', viaId: null, strength: f.strength });
  for (const f of store.friendsOf(me)) {
    for (const g of store.friendsOf(f.id)) {
      if (g.id === me || reach.get(g.id)?.relation === 'friend') continue;
      const s = f.strength * g.strength;
      if (!reach.has(g.id) || reach.get(g.id).strength < s) reach.set(g.id, { relation: 'one-intro', viaId: f.id, strength: s });
    }
  }
  const adjacent = ADJACENT[topic] ?? [];
  const relevantTopics = [topic, ...adjacent];
  const names = new Set(relevantTopics.map(topicName));
  const out = [];
  for (const [id, r] of reach) {
    const deals = store.dealsOf(id).filter((d) => d.decision === 'proceed' && relevantTopics.includes(d.topic));
    if (!deals.length) continue;
    const sameAsset = assetId ? deals.filter((d) => d.assetId === assetId) : [];
    const sameArea = deals.filter((d) => d.topic === topic);
    const match = sameAsset.length ? 'same-payee' : sameArea.length ? 'same-area' : 'adjacent';
    const markdown = readDossier(dir, id);
    if (!markdown) continue;
    const { sections } = parseDossier(markdown);
    const words = sections.find((x) => x.heading === 'In their words')?.body.match(/^>\s?(.*)$/m)?.[1] ?? null;
    const excerpt = sections.filter((s) => names.has(s.heading)).sort((a, b) => (a.heading === topicName(topic) ? -1 : b.heading === topicName(topic) ? 1 : 0));
    const cred = credibility(store, id, topic);
    out.push({
      id,
      name: store.member(id).name,
      title: store.member(id).title,
      relation: r.relation,
      viaId: r.viaId,
      viaName: r.viaId ? store.member(r.viaId).name : null,
      match,
      credibility: cred.score,
      highlight: sameAsset[0] ? `${sameAsset[0].outcome ? `Returned ${sameAsset[0].outcome.multiple.toFixed(2)}x on` : 'Currently holds'} ${store.asset(assetId).name} (${year(sameAsset[0].decidedAt)})` : null,
      inTheirWords: words,
      conflicts: assetId ? conflictState(store, id, assetId, topic, Date.now()) : null,
      excerpt: publicMarkdown([...excerpt.map((s) => `## ${s.heading}\n\n${s.body}`)].join('\n\n')),
      score: (match === 'same-payee' ? 300 : match === 'same-area' ? 200 : 100) + cred.score + (r.relation === 'friend' ? 15 : 0),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Dossiers are shared with a member's network: friends, and people one introduction away. */
export function canReadDossier(store, me, memberId) {
  if (me === memberId || store.areFriends(me, memberId)) return true;
  return store.friendsOf(me).some((f) => store.areFriends(f.id, memberId));
}
