import { YEAR, HURDLE, median, quantile, round, sizeBucket, wilsonLower } from '../util.js';
import { adviceWasRight, credibility, interestAligned, isResolved } from './credibility.js';

const NEAREST = 15;
/** Below this many comparable transactions, individual rows are withheld so no one can be identified. */
export const MIN_ROWS = 5;
const WINDOW = YEAR / 2;

const share = (list, pred) => (list.length ? round(list.filter(pred).length / list.length, 3) : null);

function summarise(cases) {
  const m = cases.map((c) => c.multiple);
  return {
    n: cases.length,
    medianMultiple: m.length ? round(median(m), 2) : null,
    p25: m.length ? round(quantile(m, 0.25), 2) : null,
    p75: m.length ? round(quantile(m, 0.75), 2) : null,
    lossRate: share(cases, (c) => c.multiple < 1),
    hurdleRate: share(cases, (c) => c.multiple >= HURDLE),
    doubleRate: share(cases, (c) => c.multiple >= 2),
    medianHoldYears: cases.length ? round(median(cases.map((c) => c.holdYears)), 1) : null,
  };
}

/**
 * Case study for a transaction you are about to make: how comparable transactions have gone,
 * drawn from other members' completed wires on the platform and from public records off it
 * (filings, press, auction results). Member transactions are always anonymised.
 */
export function caseStudy(store, me, { topic, assetId = null, sizeM, now = Date.now() }) {
  const platform = store.dealsInTopic(topic)
    .filter((d) => d.memberId !== me && d.decision === 'proceed' && isResolved(d))
    .map((d) => {
      const advice = store.adviceForDeal(d.id);
      return {
        source: 'platform', sourceLabel: 'Member transaction', buyerType: 'Member', assetId: d.assetId, sizeM: d.sizeM,
        at: d.decidedAt, multiple: d.outcome.multiple, holdYears: d.outcome.holdYears,
        advisorsAsked: advice.length,
        followedConflicted: advice.some((a) => a.rec === 'proceed' && a.context && interestAligned(a.context, a.rec)),
      };
    });
  const external = store.data.external
    .filter((x) => x.topic === topic)
    .map((x) => ({
      source: 'external', sourceLabel: x.source, buyerType: x.buyerType, assetId: x.assetId, sizeM: x.sizeM,
      at: x.decidedAt, multiple: x.outcome.multiple, holdYears: x.outcome.holdYears, advisorsAsked: null, followedConflicted: null,
    }));

  const similarity = (c) => {
    const sizeSim = Math.exp(-Math.abs(Math.log(c.sizeM / sizeM)) / 1.2);
    const sameAsset = assetId && c.assetId === assetId ? 1 : 0;
    const recency = Math.exp(-Math.max(0, now - c.at) / (4 * YEAR));
    return (0.5 * sizeSim + 0.3 * sameAsset + 0.2 * recency) * (c.source === 'platform' ? 1 : 0.85);
  };
  const ranked = [...platform, ...external].map((c) => ({ ...c, similarity: similarity(c) })).sort((a, b) => b.similarity - a.similarity);
  const nearest = ranked.slice(0, NEAREST);
  const sameAsset = assetId ? ranked.filter((c) => c.assetId === assetId) : [];

  return {
    topic,
    assetId,
    sizeM,
    pool: { platform: platform.length, external: external.length },
    summary: summarise(nearest),
    sameAsset: sameAsset.length ? { ...summarise(sameAsset), platform: sameAsset.filter((c) => c.source === 'platform').length, external: sameAsset.filter((c) => c.source === 'external').length } : null,
    lessons: lessons(platform, sizeM),
    bestAdvisors: bestAdvisors(store, me, topic),
    flows: flows(store, me, topic, now),
    rowsHidden: nearest.length < MIN_ROWS,
    rows: nearest.length < MIN_ROWS ? [] : nearest.map((c) => ({
      source: c.source,
      sourceLabel: c.sourceLabel,
      buyerType: c.buyerType,
      year: new Date(c.at).getUTCFullYear(),
      sizeBucket: sizeBucket(c.sizeM),
      multiple: c.multiple,
      holdYears: c.holdYears,
      sameAsset: !!assetId && c.assetId === assetId,
      advisorsAsked: c.advisorsAsked,
      similarity: round(c.similarity, 2),
    })),
  };
}

/** Patterns across every member transaction in the topic, where the platform knows who advised whom. */
function lessons(platform, sizeM) {
  const out = [];
  const compare = (key, a, b, metric) => {
    if (a.cases.length < 4 || b.cases.length < 4) return;
    const value = (cases) => (metric === 'median' ? round(median(cases.map((c) => c.multiple)), 2) : share(cases, (c) => c.multiple < 1));
    out.push({ key, metric, a: { label: a.label, n: a.cases.length, value: value(a.cases) }, b: { label: b.label, n: b.cases.length, value: value(b.cases) } });
  };
  compare('advice-breadth',
    { label: 'Asked two or more friends first', cases: platform.filter((c) => c.advisorsAsked >= 2) },
    { label: 'Asked nobody', cases: platform.filter((c) => c.advisorsAsked === 0) },
    'median');
  compare('conflicted-advice',
    { label: 'Sent on a push from someone with a stake', cases: platform.filter((c) => c.followedConflicted) },
    { label: 'No conflicted push', cases: platform.filter((c) => !c.followedConflicted) },
    'loss');
  compare('ticket-size',
    { label: `Larger than $${sizeM}M`, cases: platform.filter((c) => c.sizeM > sizeM) },
    { label: `$${sizeM}M or smaller`, cases: platform.filter((c) => c.sizeM <= sizeM) },
    'median');
  return out;
}

/** Whose calls in this topic have actually held up, and how far they are from you. */
export function bestAdvisors(store, me, topic) {
  const tally = new Map();
  for (const d of store.dealsInTopic(topic)) {
    if (!isResolved(d)) continue;
    for (const a of store.adviceForDeal(d.id)) {
      const t = tally.get(a.advisorId) ?? { calls: 0, hits: 0, conflicted: 0 };
      t.calls++;
      if (adviceWasRight(a, d)) t.hits++;
      if (a.context && interestAligned(a.context, a.rec)) t.conflicted++;
      tally.set(a.advisorId, t);
    }
  }
  const direct = new Set(store.friendsOf(me).map((f) => f.id));
  const via = (id) => store.friendsOf(me).find((f) => store.areFriends(f.id, id));
  return [...tally.entries()]
    .filter(([id, t]) => t.calls >= 3 && id !== me)
    .map(([id, t]) => {
      const bridge = direct.has(id) ? null : via(id);
      return {
        id,
        name: store.member(id).name,
        title: store.member(id).title,
        ...t,
        hitRate: round(t.hits / t.calls, 3),
        trust: round(wilsonLower(t.hits, t.calls), 3),
        credibility: credibility(store, id, topic).score,
        relation: direct.has(id) ? 'friend' : bridge ? 'one-intro' : 'outside',
        viaName: bridge ? store.member(bridge.id).name : null,
      };
    })
    .sort((a, b) => b.trust - a.trust)
    .slice(0, 5);
}

/** How members are moving in this topic right now: overall, and the ones with the best records. */
function flows(store, me, topic, now) {
  const inWindow = (t, back) => t != null && now - t >= back && now - t < back + WINDOW;
  const buys = (back) => store.dealsInTopic(topic).filter((d) => d.memberId !== me && d.decision === 'proceed' && inWindow(d.decidedAt, back));
  const exits = store.dealsInTopic(topic).filter((d) => d.memberId !== me && d.decision === 'proceed' && d.outcome && inWindow(d.outcome.resolvedAt, 0));
  const recent = buys(0);
  const prior = buys(WINDOW);
  const expert = (d) => credibility(store, d.memberId, topic).score >= 60;
  return {
    windowDays: 180,
    buys: { count: recent.length, totalM: recent.reduce((s, d) => s + d.sizeM, 0), members: new Set(recent.map((d) => d.memberId)).size },
    priorBuys: { count: prior.length, totalM: prior.reduce((s, d) => s + d.sizeM, 0) },
    exits: { count: exits.length, totalM: Math.round(exits.reduce((s, d) => s + d.sizeM * d.outcome.multiple, 0)) },
    experts: { buying: recent.filter(expert).length, exiting: exits.filter(expert).length },
  };
}
