import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const pushTo = (map, key, value) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * In-memory data store with the indexes the engine needs. Records are plain objects; the engine
 * mutates deals in place (decision, outcome) and the indexes keep pointing at the same objects.
 */
export class Store {
  constructor(data) {
    this.data = {
      meta: data.meta ?? {},
      members: data.members ?? [],
      accounts: data.accounts ?? [],
      connections: data.connections ?? [],
      assets: data.assets ?? [],
      deals: data.deals ?? [],
      advice: data.advice ?? [],
      requests: data.requests ?? [],
      intros: data.intros ?? [],
      threads: data.threads ?? [],
      messages: data.messages ?? [],
      payments: data.payments ?? [],
      ledger: data.ledger ?? [],
      external: data.external ?? [],
    };
    this.reindex();
  }

  reindex() {
    this.members = new Map();
    this.assets = new Map();
    this.deals = new Map();
    this.adviceById = new Map();
    this.friends = new Map();
    this.dealsByMember = new Map();
    this.dealsByTopic = new Map();
    this.adviceByDeal = new Map();
    this.adviceByAdvisor = new Map();
    this.threadsById = new Map();
    this.messagesByThread = new Map();
    this._cache = new Map();
    for (const m of this.data.members) this.members.set(m.id, m);
    for (const a of this.data.assets) this.assets.set(a.id, a);
    for (const c of this.data.connections) this.#indexConnection(c);
    for (const d of this.data.deals) this.#indexDeal(d);
    for (const a of this.data.advice) this.#indexAdvice(a);
    for (const t of this.data.threads) this.threadsById.set(t.id, t);
    for (const m of this.data.messages) pushTo(this.messagesByThread, m.threadId, m);
  }

  #indexConnection(c) {
    pushTo(this.friends, c.a, { id: c.b, strength: c.strength });
    pushTo(this.friends, c.b, { id: c.a, strength: c.strength });
  }

  #indexDeal(d) {
    this.deals.set(d.id, d);
    pushTo(this.dealsByMember, d.memberId, d);
    pushTo(this.dealsByTopic, d.topic, d);
  }

  #indexAdvice(a) {
    this.adviceById.set(a.id, a);
    pushTo(this.adviceByDeal, a.dealId, a);
    pushTo(this.adviceByAdvisor, a.advisorId, a);
  }

  /** Derived values (credibility, the bias model) are cached until the next write. */
  cached(key, compute) {
    if (!this._cache.has(key)) this._cache.set(key, compute());
    return this._cache.get(key);
  }

  invalidate() {
    this._cache.clear();
  }

  accountsOf(memberId) { return this.data.accounts.filter((a) => a.memberId === memberId); }
  account(id) { return this.data.accounts.find((a) => a.id === id); }
  member(id) { return this.members.get(id); }
  asset(id) { return this.assets.get(id); }
  deal(id) { return this.deals.get(id); }
  advice(id) { return this.adviceById.get(id); }
  friendsOf(id) { return this.friends.get(id) ?? []; }
  dealsOf(memberId) { return this.dealsByMember.get(memberId) ?? []; }
  dealsInTopic(topic) { return this.dealsByTopic.get(topic) ?? []; }
  adviceForDeal(dealId) { return this.adviceByDeal.get(dealId) ?? []; }
  adviceBy(advisorId) { return this.adviceByAdvisor.get(advisorId) ?? []; }

  strength(a, b) {
    return this.friendsOf(a).find((f) => f.id === b)?.strength ?? 0;
  }

  areFriends(a, b) {
    return this.friendsOf(a).some((f) => f.id === b);
  }

  nextId(prefix, list) {
    return `${prefix}${String(list.length + 1).padStart(4, '0')}`;
  }

  addConnection(c) { this.data.connections.push(c); this.#indexConnection(c); this.invalidate(); return c; }
  addAsset(a) { this.data.assets.push(a); this.assets.set(a.id, a); this.invalidate(); return a; }
  addDeal(d) { this.data.deals.push(d); this.#indexDeal(d); this.invalidate(); return d; }
  addAdvice(a) { this.data.advice.push(a); this.#indexAdvice(a); this.invalidate(); return a; }
  addRequest(r) { this.data.requests.push(r); return r; }
  addIntro(i) { this.data.intros.push(i); return i; }
  addThread(t) { this.data.threads.push(t); this.threadsById.set(t.id, t); return t; }
  addMessage(m) { this.data.messages.push(m); pushTo(this.messagesByThread, m.threadId, m); return m; }
  addPayment(p) { this.data.payments.push(p); return p; }
  thread(id) { return this.threadsById.get(id); }
  messagesIn(threadId) { return this.messagesByThread.get(threadId) ?? []; }
  threadsOf(memberId) { return this.data.threads.filter((t) => t.participants.includes(memberId)); }

  static load(path) {
    if (!existsSync(path)) return null;
    return new Store(JSON.parse(readFileSync(path, 'utf8')));
  }

  save(path) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, path);
  }
}
