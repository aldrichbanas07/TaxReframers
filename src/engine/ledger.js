import { canonical, sha256 } from '../util.js';

export const GENESIS = '0'.repeat(64);

const hashEntry = (entry) => {
  const { hash, ...body } = entry;
  return sha256(canonical(body));
};

/**
 * Append-only, hash-chained record of every request, piece of advice, decision and outcome.
 * Each entry commits to the one before it, so editing any past entry (say, to quietly change
 * what someone told you) breaks every hash after it.
 */
export function append(store, { ts, kind, actorId, subjectIds = [], dealId = null, payload }) {
  const ledger = store.data.ledger;
  const prev = ledger[ledger.length - 1];
  const entry = {
    seq: ledger.length + 1,
    ts,
    kind,
    actorId,
    subjectIds,
    dealId,
    payload,
    prevHash: prev ? prev.hash : GENESIS,
  };
  entry.hash = hashEntry(entry);
  ledger.push(entry);
  return entry;
}

export function verify(ledger) {
  let prevHash = GENESIS;
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    if (e.seq !== i + 1 || e.prevHash !== prevHash || hashEntry(e) !== e.hash) {
      return { ok: false, length: ledger.length, brokenAt: i + 1, head: ledger[ledger.length - 1]?.hash ?? GENESIS };
    }
    prevHash = e.hash;
  }
  return { ok: true, length: ledger.length, brokenAt: null, head: prevHash };
}

export const involves = (entry, memberId) => entry.actorId === memberId || entry.subjectIds.includes(memberId);
