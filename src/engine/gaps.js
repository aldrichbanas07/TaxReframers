import { TOPICS } from '../data/catalog.js';
import { YEAR, clamp, round } from '../util.js';
import { credibility, conflictState } from './credibility.js';

/** How much a friend's view counts toward covering a topic: credible, close, and not a competitor. */
function coverageWeight(cred, strength, rival) {
  return clamp((cred.score - 50) / 40, 0, 0.9) * Math.sqrt(strength) * (rival ? 0.7 : 1);
}

/**
 * Network gap detector. For each topic: how much it matters to you (your own money in it, plus
 * where the rest of the platform is moving) against how well your direct friends cover it. Gaps are
 * topics that matter with nobody credible to ask. Each gap comes with the shortest route to someone
 * who could fill it.
 */
export function networkGaps(store, me, now = Date.now()) {
  const exposure = Object.fromEntries(TOPICS.map((t) => [t.id, 0]));
  for (const d of store.dealsOf(me)) {
    const ageY = Math.max(0, (now - d.createdAt) / YEAR);
    const size = Math.log1p(d.sizeM);
    if (d.status === 'review') exposure[d.topic] += 2 * size;
    else if (d.decision === 'proceed') exposure[d.topic] += size * Math.exp(-ageY / 3) * (d.outcome ? 0.6 : 1);
    else exposure[d.topic] += 0.3 * size * Math.exp(-ageY / 2);
  }
  const maxExposure = Math.max(...Object.values(exposure), 1e-9);

  const recent = Object.fromEntries(TOPICS.map((t) => [t.id, 0]));
  for (const d of store.data.deals) {
    if (d.memberId === me || d.decision !== 'proceed' || now - d.decidedAt > YEAR) continue;
    recent[d.topic] += d.sizeM;
  }
  const maxRecent = Math.max(...Object.values(recent), 1e-9);

  const friends = store.friendsOf(me);
  const topics = TOPICS.map((t) => {
    const relevance = clamp(0.75 * (exposure[t.id] / maxExposure) + 0.25 * (recent[t.id] / maxRecent), 0, 1);
    const covering = friends
      .map((f) => {
        const cred = credibility(store, f.id, t.id);
        const rival = conflictState(store, f.id, null, t.id, now).rival;
        return { id: f.id, name: store.member(f.id).name, strength: f.strength, credibility: cred.score, evidence: cred.evidence, rival, weight: coverageWeight(cred, f.strength, rival) };
      })
      .filter((f) => f.weight > 0.05)
      .sort((a, b) => b.weight - a.weight);
    const coverage = 1 - covering.reduce((p, f) => p * (1 - f.weight), 1);
    const flags = [];
    if (covering.filter((f) => f.weight >= 0.3).length === 1) flags.push('single-point');
    if (covering.length && covering.every((f) => f.rival)) flags.push('all-rivals');
    if (relevance >= 0.35 && !covering.length) flags.push('blind-spot');
    return {
      topic: t.id,
      name: t.name,
      relevance: round(relevance, 3),
      coverage: round(coverage, 3),
      gap: round(relevance * (1 - coverage), 3),
      myExposure: round(exposure[t.id] / maxExposure, 3),
      platformMomentum: round(recent[t.id] / maxRecent, 3),
      covering: covering.slice(0, 3),
      flags,
    };
  }).sort((a, b) => b.gap - a.gap);

  for (const g of topics.slice(0, 6)) g.bridges = bridgesFor(store, me, g.topic);

  const totalRelevance = topics.reduce((s, g) => s + g.relevance, 0);
  const overall = totalRelevance ? topics.reduce((s, g) => s + g.relevance * g.coverage, 0) / totalRelevance : 0;
  return { overallCoverage: round(overall, 3), topics, generatedAt: now };
}

/** Who could close this gap, and how you would reach them: one introduction away, or a cold platform intro. */
export function bridgesFor(store, me, topic) {
  const direct = new Set(store.friendsOf(me).map((f) => f.id));
  const viaPaths = new Map();
  for (const f of store.friendsOf(me)) {
    for (const g of store.friendsOf(f.id)) {
      if (g.id === me || direct.has(g.id)) continue;
      const s = f.strength * g.strength;
      if (!viaPaths.has(g.id) || viaPaths.get(g.id).pathStrength < s) viaPaths.set(g.id, { viaId: f.id, viaName: store.member(f.id).name, pathStrength: round(s, 2) });
    }
  }
  const candidates = store.data.members
    .filter((m) => m.id !== me && !direct.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, title: m.title, credibility: credibility(store, m.id, topic), path: viaPaths.get(m.id) ?? null }))
    .filter((c) => c.credibility.score >= 56);
  candidates.sort((a, b) => (b.path ? 1 : 0) - (a.path ? 1 : 0) || b.credibility.score - a.credibility.score);
  return candidates.slice(0, 3);
}
