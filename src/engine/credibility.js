import { DAY, HURDLE, sigmoid } from '../util.js';

export const isGood = (multiple) => multiple >= HURDLE;
export const isResolved = (deal, asOf = Infinity) => !!deal?.outcome && deal.outcome.resolvedAt <= asOf;

/** Was this advice right for the person who received it, given how the asset actually did? */
export function adviceWasRight(advice, deal) {
  return (advice.rec === 'proceed') === isGood(deal.outcome.multiple);
}

/** Mean log-multiple of every resolved buy in a topic: the bar a member's own deals are judged against. */
export function topicBaseline(store, topic, asOf = Infinity) {
  return store.cached(`base:${topic}:${asOf}`, () => {
    let n = 0;
    let sum = 0;
    for (const d of store.dealsInTopic(topic)) {
      if (d.decision !== 'proceed' || !isResolved(d, asOf)) continue;
      n++;
      sum += Math.log(d.outcome.multiple);
    }
    return n ? sum / n : Math.log(HURDLE);
  });
}

function assetTotals(store, assetId, asOf) {
  return store.cached(`asset:${assetId}:${asOf}`, () => {
    let n = 0;
    let sum = 0;
    for (const d of store.dealsInTopic(store.asset(assetId)?.topic)) {
      if (d.assetId !== assetId || d.decision !== 'proceed' || !isResolved(d, asOf)) continue;
      n++;
      sum += Math.log(d.outcome.multiple);
    }
    return { n, sum };
  });
}

/**
 * What a typical buyer got from this asset, leaving this deal out: other members' results on the
 * same asset, shrunk toward the topic baseline when there are few of them. Comparing against this
 * credits a member for timing and terms, not for having happened to pick a good asset.
 */
function expectedLogMultiple(store, deal, asOf) {
  const base = topicBaseline(store, deal.topic, asOf);
  const { n, sum } = assetTotals(store, deal.assetId, asOf);
  const others = n - 1;
  const othersSum = sum - Math.log(deal.outcome.multiple);
  return (othersSum + 2 * base) / (others + 2);
}

/**
 * How much should you trust this member on this topic? Learned from two sources on the platform,
 * each shrunk toward "unknown" (50) until there is enough evidence:
 *   - their own deals in the topic: realised returns versus what other buyers of the same asset got
 *   - their advice record in the topic: how often their calls turned out right
 * `asOf` restricts to evidence that existed at a point in time (used when training the bias model,
 * so it never sees the future).
 */
export function credibility(store, memberId, topic, asOf = Infinity) {
  return store.cached(`cred:${memberId}:${topic}:${asOf}`, () => {
    let deals = 0;
    let excess = 0;
    let activity = 0;
    for (const d of store.dealsOf(memberId)) {
      if (d.topic === topic && d.createdAt <= asOf) activity++;
      if (d.topic !== topic || d.decision !== 'proceed' || !isResolved(d, asOf)) continue;
      deals++;
      excess += Math.log(d.outcome.multiple) - expectedLogMultiple(store, d, asOf);
    }
    let hits = 0;
    let calls = 0;
    for (const a of store.adviceBy(memberId)) {
      if (a.topic !== topic) continue;
      const d = store.deal(a.dealId);
      if (!isResolved(d, asOf)) continue;
      calls++;
      if (adviceWasRight(a, d)) hits++;
    }
    const dealW = deals / (deals + 3);
    const adviceW = calls / (calls + 2);
    const dealScore = deals ? sigmoid(excess / deals / 0.2) : 0.5;
    const adviceScore = (hits + 2) / (calls + 4);
    const priorW = 0.4;
    const score = (dealW * dealScore + adviceW * adviceScore + priorW * 0.5) / (dealW + adviceW + priorW);
    const evidence = deals + calls >= 8 ? 'strong' : deals + calls >= 3 ? 'moderate' : 'thin';
    return {
      score: Math.round(score * 100),
      activity,
      deals,
      avgExcessPct: deals ? Math.round((Math.exp(excess / deals) - 1) * 100) : null,
      calls,
      hits,
      hitRate: calls ? hits / calls : null,
      evidence,
    };
  });
}

/**
 * What did this advisor stand to gain from the deal at time `t`? Everything here is observable
 * from platform data: holdings come from their own transactions, not from self-reporting.
 *   stake  - holds a position in the asset (benefits if you buy in)
 *   exited - sold out of the asset in the past year (you would be buying what they just sold)
 *   rival  - weighing the same asset, or bought into the same space in the past 120 days
 *            (competing for the same allocations, so benefits if you pass)
 */
export function conflictState(store, advisorId, assetId, topic, t) {
  const asset = store.asset(assetId);
  let stake = !!asset?.initialStakeholders?.includes(advisorId);
  let exited = false;
  let rival = false;
  let recentTopicBuys = 0;
  for (const d of store.dealsOf(advisorId)) {
    if (d.createdAt > t) continue;
    const decided = d.decision && d.decidedAt <= t;
    if (d.assetId === assetId) {
      if (!decided) rival = true; // weighing the same asset right now
      else if (d.decision === 'proceed') {
        if (!isResolved(d, t)) stake = true;
        else if (t - d.outcome.resolvedAt <= 365 * DAY) exited = true;
      }
    }
    if (decided && d.decision === 'proceed' && d.topic === topic && d.assetId !== assetId && t - d.decidedAt <= 120 * DAY) recentTopicBuys++;
  }
  if (recentTopicBuys >= 1) rival = true;
  return { stake, exited, rival };
}

/** Did the advisor's interest point the same way as their recommendation? */
export const interestAligned = (context, rec) =>
  (rec === 'proceed' && (context.stake || context.exited)) || (rec === 'pass' && context.rival);

/**
 * The advisor's record on calls where they had something riding on it: of their past advice that
 * pointed the same way as their own interest, how much turned out wrong for the recipient?
 */
export function conflictRecord(store, advisorId, asOf = Infinity) {
  let n = 0;
  let wrong = 0;
  for (const a of store.adviceBy(advisorId)) {
    if (a.createdAt > asOf || !a.context || !interestAligned(a.context, a.rec)) continue;
    const d = store.deal(a.dealId);
    if (!isResolved(d, asOf)) continue;
    n++;
    if (!adviceWasRight(a, d)) wrong++;
  }
  return { n, wrong };
}

/** Everything the platform records about an advisor's position at the moment they advise. */
export function adviceContext(store, { advisorId, recipientId, assetId, topic, at }) {
  const cred = credibility(store, advisorId, topic, at);
  return {
    ...conflictState(store, advisorId, assetId, topic, at),
    credibility: cred.score,
    evidence: cred.activity + cred.calls,
    strength: store.strength(recipientId, advisorId),
    conflictRecord: conflictRecord(store, advisorId, at),
  };
}
