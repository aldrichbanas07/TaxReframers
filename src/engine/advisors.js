import { credibility, conflictState, conflictRecord } from './credibility.js';

const hasConflict = (c) => !!c && (c.stake || c.exited || c.rival);

function profile(store, id, topic, assetId, at) {
  const m = store.member(id);
  return {
    id,
    name: m.name,
    title: m.title,
    city: m.city,
    declaresTopic: m.declaredTopics.includes(topic),
    credibility: credibility(store, id, topic),
    conflicts: assetId ? conflictState(store, id, assetId, topic, at) : null,
    conflictRecord: conflictRecord(store, id),
  };
}

/**
 * Who should you ask about this transaction? Direct friends ranked by what the platform has seen
 * them do in this topic (not by what they claim), with anything they stand to gain from it
 * flagged up front. Strong people one introduction away are listed with the friend who can make it.
 */
export function rankAdvisors(store, me, { topic, assetId = null, at = Date.now() }) {
  const direct = store.friendsOf(me);
  const directIds = new Set(direct.map((f) => f.id));

  const friends = direct
    .map((f) => ({ ...profile(store, f.id, topic, assetId, at), strength: f.strength, degree: 1 }))
    .map((p) => ({ ...p, rank: p.credibility.score + 8 * p.strength - (hasConflict(p.conflicts) ? 10 : 0) }))
    .sort((a, b) => b.rank - a.rank);

  const paths = new Map();
  for (const f of direct) {
    for (const g of store.friendsOf(f.id)) {
      if (g.id === me || directIds.has(g.id)) continue;
      const pathStrength = f.strength * g.strength;
      if (!paths.has(g.id) || paths.get(g.id).pathStrength < pathStrength) {
        paths.set(g.id, { viaId: f.id, viaName: store.member(f.id).name, pathStrength });
      }
    }
  }
  const introductions = [...paths.entries()]
    .map(([id, path]) => ({ ...profile(store, id, topic, assetId, at), degree: 2, ...path }))
    .filter((p) => p.credibility.score >= 55 || p.declaresTopic)
    .sort((a, b) => b.credibility.score - a.credibility.score)
    .slice(0, 5);

  return { topic, assetId, friends, introductions };
}
