import { round } from '../util.js';
import { adviceWasRight, interestAligned, isGood, isResolved } from './credibility.js';

/** You made the call, so you carry this share whenever anyone's advice was followed. */
const OWN_SHARE = 0.4;

/** Money made or lost by the decision. A cancelled wire counts the gain missed or the loss avoided. */
export function decisionImpactM(deal) {
  const pnl = deal.sizeM * (deal.outcome.multiple - 1);
  return round(deal.decision === 'proceed' ? pnl : -pnl, 1);
}

/**
 * Who gets the blame (or the credit) for how a transaction turned out. Advisors whose advice you
 * followed share responsibility in proportion to how hard they pushed and how much their word
 * carries with you. People whose advice you ignored and who turned out right are listed separately.
 * Every line points back to the ledger entry that recorded what they said.
 */
export function blameReport(store, dealId) {
  const deal = store.deal(dealId);
  if (!isResolved(deal) || !deal.decision) return null;
  const decisionRight = (deal.decision === 'proceed') === isGood(deal.outcome.multiple);
  const advice = store.adviceForDeal(dealId);
  const parties = advice.map((a) => {
    const entry = a.ledgerSeq ? store.data.ledger[a.ledgerSeq - 1] : null;
    return {
      adviceId: a.id,
      advisorId: a.advisorId,
      name: store.member(a.advisorId).name,
      rec: a.rec,
      confidence: a.confidence,
      rationale: a.rationale,
      at: a.createdAt,
      followed: a.rec === deal.decision,
      right: adviceWasRight(a, deal),
      conflicted: !!a.context && interestAligned(a.context, a.rec),
      disclosed: a.context,
      influence: a.confidence * (0.5 + 0.5 * (a.context?.strength ?? 0.5)),
      ledger: entry ? { seq: entry.seq, hash: entry.hash } : null,
    };
  });
  const followed = parties.filter((p) => p.followed);
  const totalInfluence = followed.reduce((s, p) => s + p.influence, 0);
  const ownShare = followed.length ? OWN_SHARE : 1;
  for (const p of parties) p.share = p.followed && totalInfluence ? round(((1 - ownShare) * p.influence) / totalInfluence, 3) : 0;
  const impactM = decisionImpactM(deal);
  return {
    dealId,
    verdict: decisionRight ? 'credit' : 'blame',
    decision: deal.decision,
    multiple: deal.outcome.multiple,
    counterfactual: deal.outcome.counterfactual,
    impactM,
    ownShare,
    parties: parties.sort((a, b) => b.share - a.share),
    toldYouSo: parties.filter((p) => !p.followed && p.right).map((p) => p.name),
  };
}

/** Running tally across all your resolved transactions: who has cost you money, who has made you money. */
export function blameBoard(store, me) {
  const board = new Map();
  for (const deal of store.dealsOf(me)) {
    const report = blameReport(store, deal.id);
    if (!report) continue;
    for (const p of report.parties) {
      const row = board.get(p.advisorId) ?? { advisorId: p.advisorId, name: p.name, calls: 0, right: 0, conflictedCalls: 0, blamedM: 0, creditedM: 0, warnings: 0 };
      row.calls++;
      if (p.right) row.right++;
      if (p.conflicted) row.conflictedCalls++;
      if (!p.followed && p.right) row.warnings++;
      const amount = Math.abs(report.impactM) * p.share;
      if (report.verdict === 'blame') row.blamedM += amount;
      else row.creditedM += amount;
      board.set(p.advisorId, row);
    }
  }
  return [...board.values()]
    .map((r) => ({ ...r, blamedM: round(r.blamedM, 1), creditedM: round(r.creditedM, 1), netM: round(r.creditedM - r.blamedM, 1) }))
    .sort((a, b) => a.netM - b.netM);
}
