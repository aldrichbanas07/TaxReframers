import { sigmoid, mean, round } from '../util.js';
import { adviceWasRight, isResolved, interestAligned } from './credibility.js';

/**
 * Features describing a piece of advice at the moment it was given. The three conflict features
 * only fire when the recommendation points the same way as the advisor's own interest: an advisor
 * who holds a stake and still tells you to pass is giving you a credible signal, not a biased one.
 */
export const FEATURES = [
  { key: 'stakeAligned', label: 'Holds a stake in this asset and told you to buy', conflict: true },
  { key: 'exitedAligned', label: 'Sold out of this asset in the past year and told you to buy', conflict: true },
  { key: 'rivalAligned', label: 'Competing for the same deals and told you to pass', conflict: true },
  { key: 'conflictHistory', label: 'How their past calls with money on the line turned out', conflict: true },
  { key: 'untested', label: 'Little or no record in this topic on the platform', offLabel: 'Has a record in this topic on the platform', conflict: false },
  { key: 'inexperience', label: 'Their track record in this topic', conflict: false },
  { key: 'closeness', label: 'How close the two of you are', conflict: false },
  { key: 'confidence', label: 'How hard they pushed the call', conflict: false },
  // A base-rate adjustment (send calls and hold calls go wrong at different rates), not about the advisor.
  { key: 'sendCall', label: 'Advice to send rather than hold', conflict: false, internal: true },
];

/** Starting weights before the platform has data, and what training is regularised toward. */
const PRIOR = { w: [1.0, 1.2, 0.9, 0.6, 0.4, 0.8, -0.2, 0.2, 0], b: -1.2 };

export function featureVector(context, rec, confidence) {
  const record = context.conflictRecord ?? { n: 0, wrong: 0 };
  // Centred on "unknown" (a one-in-three prior): positive for advisors whose conflicted calls have
  // tended to go wrong, negative for those whose conflicted calls have held up anyway.
  const history = interestAligned(context, rec) ? 3 * ((record.wrong + 1) / (record.n + 3) - 1 / 3) : 0;
  return [
    context.stake && rec === 'proceed' ? 1 : 0,
    context.exited && rec === 'proceed' ? 1 : 0,
    context.rival && rec === 'pass' ? 1 : 0,
    round(history, 3),
    (context.evidence ?? 0) < 2 ? 1 : 0,
    1 - context.credibility / 100,
    context.strength,
    confidence,
    rec === 'proceed' ? 1 : 0,
  ];
}

export function trainLogistic(X, y, { prior = PRIOR, lambda = 0.05, iters = 2500, lr = 0.5 } = {}) {
  const d = prior.w.length;
  const w = [...prior.w];
  let b = prior.b;
  const n = X.length;
  if (!n) return { w, b };
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * (w[j] - prior.w[j]));
    b -= lr * (gb / n);
  }
  return { w, b };
}

const predictRaw = (model, x) => sigmoid(model.b + model.w.reduce((s, wj, j) => s + wj * x[j], 0));

/** Area under the ROC curve: 0.5 is a coin flip, 1.0 is perfect ranking. */
export function auc(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  let pos = 0;
  let neg = 0;
  let rankSum = 0;
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j][0] === pairs[i][0]) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) {
      if (pairs[k][1]) { pos++; rankSum += avgRank; } else neg++;
    }
    i = j;
  }
  if (!pos || !neg) return null;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/**
 * Learn how often advice works against the person receiving it, from every resolved piece of
 * advice on the platform. Label: the advice turned out wrong for the recipient. A deterministic
 * one-in-five holdout gives an honest accuracy figure; the served model is then fit on everything.
 */
export function trainBiasModel(store) {
  return store.cached('biasModel', () => {
    const X = [];
    const y = [];
    const holdout = [];
    for (const a of store.data.advice) {
      const d = store.deal(a.dealId);
      if (!isResolved(d) || !a.context) continue;
      const x = featureVector(a.context, a.rec, a.confidence);
      X.push(x);
      y.push(adviceWasRight(a, d) ? 0 : 1);
      holdout.push(Number(a.id.replace(/\D/g, '')) % 5 === 0);
    }
    const trainIdx = X.map((_, i) => i).filter((i) => !holdout[i]);
    const testIdx = X.map((_, i) => i).filter((i) => holdout[i]);
    const split = trainLogistic(trainIdx.map((i) => X[i]), trainIdx.map((i) => y[i]));
    const holdoutAuc = auc(testIdx.map((i) => predictRaw(split, X[i])), testIdx.map((i) => y[i]));
    const model = trainLogistic(X, y);
    const means = FEATURES.map((_, j) => mean(X.map((x) => x[j])) ?? 0);
    return {
      ...model,
      means,
      trainedOn: X.length,
      holdoutSize: testIdx.length,
      holdoutAuc: holdoutAuc == null ? null : round(holdoutAuc, 3),
      baseRate: X.length ? round(mean(y), 3) : null,
    };
  });
}

/**
 * Probability this advice works against you, plus how much of that comes from the advisor's
 * conflicts: the same prediction with the conflict features switched off is the counterfactual
 * "if they had nothing riding on it".
 */
export function estimateBias(model, context, rec, confidence) {
  const x = featureVector(context, rec, confidence);
  const p = predictRaw(model, x);
  const pClean = predictRaw(model, x.map((v, j) => (FEATURES[j].conflict ? 0 : v)));
  const factors = FEATURES.map((f, j) => ({
    key: f.key,
    internal: !!f.internal,
    label: f.offLabel && x[j] === 0 ? f.offLabel : f.label,
    conflict: f.conflict,
    active: f.conflict ? x[j] !== 0 : true,
    value: round(x[j], 2),
    logOdds: round(model.w[j] * (f.conflict ? x[j] : x[j] - model.means[j]), 3),
    ...(f.key === 'conflictHistory' ? { record: context.conflictRecord } : {}),
  })).filter((f) => f.active && !f.internal && Math.abs(f.logOdds) >= 0.02);
  factors.sort((a, b) => Math.abs(b.logOdds) - Math.abs(a.logOdds));
  return {
    probability: round(p, 3),
    withoutConflicts: round(pClean, 3),
    conflictLift: round(p - pClean, 3),
    level: p - pClean >= 0.12 || p >= 0.6 ? 'high' : p - pClean >= 0.05 || p >= 0.45 ? 'elevated' : 'low',
    factors,
  };
}

export function describeModel(model) {
  return {
    trainedOn: model.trainedOn,
    holdoutSize: model.holdoutSize,
    holdoutAuc: model.holdoutAuc,
    baseRate: model.baseRate,
    intercept: round(model.b, 3),
    weights: FEATURES.map((f, j) => ({ key: f.key, label: f.label, weight: round(model.w[j], 3) })),
  };
}
