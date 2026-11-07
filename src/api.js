import { TOPICS, topicName } from './data/catalog.js';
import { round, YEAR } from './util.js';
import * as ledger from './engine/ledger.js';
import { adviceContext, credibility, isResolved } from './engine/credibility.js';
import { trainBiasModel, estimateBias, describeModel } from './engine/bias.js';
import { rankAdvisors } from './engine/advisors.js';
import { networkGaps } from './engine/gaps.js';
import { caseStudy } from './engine/precedents.js';
import { blameReport, blameBoard } from './engine/blame.js';
import { classifyPurpose, matchPayee } from './engine/classify.js';
import { findExperience, readDossier, publicMarkdown, canReadDossier, syncDossiers } from './engine/dossier.js';
import { researchQuery, ResearchError } from './research.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new HttpError(status, message); };
const LEVEL_ORDER = { low: 0, elevated: 1, high: 2 };
const isTopic = (t) => TOPICS.some((x) => x.id === t);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

/**
 * The app's HTTP API. Every response is computed for one signed-in member and only ever contains
 * aggregates or anonymised rows from other members' transactions, never their raw records.
 */
export function createApi(store, { persist = () => {}, dossierDir = null, researcher = null } = {}) {
  const routes = [];
  const route = (method, pattern, handler, { auth = true } = {}) => {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, regex, keys, handler, auth });
  };

  const now = () => Date.now();
  const model = () => trainBiasModel(store);
  const memberName = (id) => (id === 'system' ? 'Inner Circle' : store.member(id)?.name ?? id);
  const memberCard = (id) => { const m = store.member(id); return { id, name: m.name, title: m.title, city: m.city }; };
  const assetName = (id) => store.asset(id)?.name ?? 'Unknown payee';
  const write = (entry) => ledger.append(store, { ts: now(), ...entry });
  const commit = () => {
    store.invalidate();
    if (dossierDir) syncDossiers(store, dossierDir);
    persist();
  };

  const ownDeal = (me, id) => {
    const deal = store.deal(id);
    if (!deal || deal.memberId !== me) fail(404, 'Transaction not found');
    return deal;
  };

  const ownAccount = (me, id) => {
    const account = store.account(id);
    if (!account || account.memberId !== me) fail(400, 'Choose one of your accounts');
    return account;
  };

  const parseSize = (value) => {
    const sizeM = Number(value);
    if (!Number.isFinite(sizeM) || sizeM <= 0 || sizeM > 50_000) fail(400, 'Enter an amount in millions, e.g. 350');
    return round(sizeM, 2);
  };

  const adviceView = (a) => ({
    id: a.id,
    advisor: memberCard(a.advisorId),
    rec: a.rec,
    confidence: a.confidence,
    rationale: a.rationale,
    at: a.createdAt,
    threadId: store.data.requests.find((r) => r.id === a.requestId)?.threadId ?? null,
    disclosed: a.context,
    bias: estimateBias(model(), a.context, a.rec, a.confidence),
    ledger: a.ledgerSeq ? { seq: a.ledgerSeq, hash: store.data.ledger[a.ledgerSeq - 1].hash } : null,
  });

  const dealSummary = (d) => {
    const advice = store.adviceForDeal(d.id).map(adviceView);
    const worst = advice.reduce((w, a) => (LEVEL_ORDER[a.bias.level] > LEVEL_ORDER[w] ? a.bias.level : w), 'low');
    return {
      id: d.id,
      assetId: d.assetId,
      assetName: assetName(d.assetId),
      topic: d.topic,
      topicName: topicName(d.topic),
      sizeM: d.sizeM,
      accountId: d.accountId,
      purpose: d.purpose ?? d.note ?? '',
      status: d.status,
      decision: d.decision,
      createdAt: d.createdAt,
      decidedAt: d.decidedAt,
      outcome: d.outcome,
      adviceCount: advice.length,
      pendingRequests: store.data.requests.filter((r) => r.dealId === d.id && r.status === 'pending').length,
      worstBias: advice.length ? worst : null,
    };
  };

  /** The advice package shown on the "Before you send" screen. */
  const advisory = (me, { topic, assetId, sizeM, purpose = '', payeeName = '' }) => {
    const gaps = networkGaps(store, me, now());
    return {
      experience: dossierDir ? findExperience(store, dossierDir, me, { topic, assetId }) : [],
      research: {
        available: !!researcher,
        query: researchQuery({ topic, purpose, payeeName, sizeM }),
        queryWithName: payeeName ? researchQuery({ topic, purpose, payeeName, sizeM, includeName: true }) : null,
      },
      caseStudy: caseStudy(store, me, { topic, assetId, sizeM, now: now() }),
      advisors: rankAdvisors(store, me, { topic, assetId, at: now() }),
      gap: gaps.topics.find((g) => g.topic === topic),
      gapRank: gaps.topics.findIndex((g) => g.topic === topic) + 1,
    };
  };

  const openTransactionThread = (me, deal, toId, question) => {
    const at = now();
    const request = store.addRequest({ id: store.nextId('r', store.data.requests), dealId: deal.id, fromId: me, toId, question, createdAt: at, status: 'pending', adviceId: null });
    const thread = store.addThread({ id: store.nextId('t', store.data.threads), kind: 'transaction', dealId: deal.id, requestId: request.id, participants: [me, toId], createdAt: at });
    request.threadId = thread.id;
    store.addMessage({ id: `msg${store.data.messages.length + 1}`, threadId: thread.id, fromId: me, body: question, createdAt: at });
    write({ kind: 'request', actorId: me, subjectIds: [toId], dealId: deal.id, payload: { requestId: request.id, threadId: thread.id, assetId: deal.assetId, topic: deal.topic, sizeM: deal.sizeM, question } });
    return thread;
  };

  const consult = (me, deal, advisorIds = [], question = '') => {
    const ids = [...new Set(advisorIds)];
    if (!ids.length) fail(400, 'Pick at least one person to talk to');
    for (const id of ids) {
      if (!store.areFriends(me, id)) fail(400, `${memberName(id)} is not in your network yet. Ask a mutual friend for an introduction.`);
    }
    const asked = new Set(store.data.requests.filter((r) => r.dealId === deal.id).map((r) => r.toId));
    const q = text(question, 1000) || `I am about to send $${deal.sizeM}M to ${assetName(deal.assetId)}${deal.purpose ? ` (${deal.purpose})` : ''}. Before I do: what is your view?`;
    return ids.filter((id) => !asked.has(id)).map((id) => openTransactionThread(me, deal, id, q).id);
  };

  const decide = (me, deal, decision) => {
    if (deal.status !== 'review') fail(409, 'This transaction has already been decided');
    if (decision === 'proceed') {
      const account = store.account(deal.accountId);
      if (account.balanceM < deal.sizeM) fail(400, `Insufficient funds in ${account.name} ($${account.balanceM.toLocaleString()}M available)`);
      account.balanceM = round(account.balanceM - deal.sizeM, 2);
    }
    const advice = store.adviceForDeal(deal.id);
    deal.decision = decision;
    deal.decidedAt = now();
    deal.status = decision === 'proceed' ? 'sent' : 'cancelled';
    for (const r of store.data.requests) if (r.dealId === deal.id && r.status === 'pending') r.status = 'closed';
    return write({
      kind: 'decision', actorId: me, subjectIds: advice.map((a) => a.advisorId), dealId: deal.id,
      payload: { decision, sizeM: deal.sizeM, followed: advice.filter((a) => a.rec === decision).map((a) => a.id), against: advice.filter((a) => a.rec !== decision).map((a) => a.id) },
    });
  };

  const describeEntry = (e, me) => {
    const you = (id) => (id === me ? 'you' : memberName(id));
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const deal = e.dealId ? store.deal(e.dealId) : null;
    const asset = deal ? assetName(deal.assetId) : '';
    switch (e.kind) {
      case 'request': return `${cap(you(e.actorId))} asked ${you(e.subjectIds[0])} about sending $${e.payload.sizeM}M to ${asset}`;
      case 'advice': return `${cap(you(e.actorId))} advised ${you(e.subjectIds[0])} to ${e.payload.rec === 'proceed' ? 'send' : 'hold off on'} ${asset} (${Math.round(e.payload.confidence * 100)}% confident)`;
      case 'message': return `${cap(you(e.actorId))} wrote to ${you(e.subjectIds[0])} about ${asset}`;
      case 'decision': return `${cap(you(e.actorId))} ${e.payload.decision === 'proceed' ? 'sent' : 'cancelled'} $${e.payload.sizeM}M to ${asset}${e.payload.decision === 'proceed' && e.payload.against.length ? `, against ${e.payload.against.length === 1 ? 'one person’s' : `${e.payload.against.length} people’s`} advice` : ''}`;
      case 'outcome': return `${asset} returned ${e.payload.multiple}x${e.payload.counterfactual ? ' (wire was not sent)' : ''}`;
      default: return e.kind;
    }
  };

  // ── Public ────────────────────────────────────────────────────────────────
  route('GET', '/api/members', () => store.data.members.map((m) => ({ id: m.id, name: m.name, title: m.title })), { auth: false });
  route('GET', '/api/topics', () => TOPICS, { auth: false });

  // ── Home ──────────────────────────────────────────────────────────────────
  route('GET', '/api/home', (me) => {
    const deals = store.dealsOf(me);
    const activity = [];
    for (const d of deals) {
      if (d.decision === 'proceed') activity.push({ at: d.decidedAt, label: assetName(d.assetId), sub: topicName(d.topic), amountM: -d.sizeM, accountId: d.accountId, dealId: d.id });
      if (d.decision === 'proceed' && isResolved(d)) activity.push({ at: d.outcome.resolvedAt, label: assetName(d.assetId), sub: `Distribution · ${d.outcome.multiple}x`, amountM: round(d.sizeM * d.outcome.multiple, 1), accountId: d.accountId, dealId: d.id });
    }
    for (const p of store.data.payments) if (p.memberId === me) activity.push({ at: p.at, label: p.payeeName, sub: p.purpose || 'Payment', amountM: -p.sizeM, accountId: p.accountId, dealId: null });
    activity.sort((a, b) => b.at - a.at);
    const friends = store.friendsOf(me);
    const twoHop = new Set();
    for (const f of friends) for (const g of store.friendsOf(f.id)) if (g.id !== me && !friends.some((x) => x.id === g.id)) twoHop.add(g.id);
    const gaps = networkGaps(store, me, now());
    return {
      me: { ...store.member(me), friends: friends.length, twoHop: twoHop.size },
      accounts: store.accountsOf(me),
      activity: activity.slice(0, 10),
      held: deals.filter((d) => d.status === 'review').map(dealSummary).reverse(),
      awaitingYou: store.data.requests.filter((r) => r.toId === me && r.status === 'pending').length + store.data.intros.filter((i) => i.viaId === me && i.status === 'pending').length,
      coverage: gaps.overallCoverage,
      topGap: gaps.topics[0],
    };
  });

  route('GET', '/api/payees', (me) => store.data.assets
    .filter((a) => !a.createdBy || a.createdBy === me)
    .map((a) => ({ id: a.id, name: a.name, topic: a.topic, topicName: topicName(a.topic) })));

  // ── Pay: "What is this for?" then advice, right before money moves ────────
  route('POST', '/api/pay/review', (me, { body }) => {
    ownAccount(me, body.accountId);
    const sizeM = parseSize(body.sizeM);
    const purpose = text(body.purpose, 300);
    const payeeName = text(body.payeeName, 120);
    let asset = body.assetId ? store.asset(body.assetId) : null;
    if (body.assetId && !asset) fail(400, 'Unknown payee');
    if (!asset && !payeeName) fail(400, 'Who is the payment to?');
    const fromPurpose = classifyPurpose({ purpose, payeeName });
    const suggested = asset || fromPurpose.personal ? null : matchPayee(store.data.assets.filter((a) => !a.createdBy || a.createdBy === me), payeeName);
    const classification = body.topic && isTopic(body.topic)
      ? { topic: body.topic, topicName: topicName(body.topic), basis: 'chosen', personal: false, matches: [] }
      : body.topic === 'personal'
        ? { topic: null, topicName: 'Personal payment', basis: 'chosen', personal: true, matches: [] }
        : asset || suggested ? classifyPurpose({ purpose, payeeName, asset: asset ?? suggested }) : fromPurpose;
    if (!asset && suggested && classification.topic === suggested.topic) asset = suggested;
    const base = { sizeM, purpose, payee: asset ? { id: asset.id, name: asset.name } : { id: null, name: payeeName }, classification, suggestedPayee: suggested && !asset ? { id: suggested.id, name: suggested.name } : null };
    if (classification.personal || !classification.topic) return { ...base, advisory: null };
    return { ...base, advisory: advisory(me, { topic: classification.topic, assetId: asset?.id ?? null, sizeM, purpose, payeeName: asset?.name ?? payeeName }) };
  });

  route('POST', '/api/pay', (me, { body }) => {
    const account = ownAccount(me, body.accountId);
    const sizeM = parseSize(body.sizeM);
    const purpose = text(body.purpose, 300);
    if (!['continue', 'consult'].includes(body.action)) fail(400, 'Choose to continue or talk to people first');

    if (body.topic === 'personal') {
      if (body.action !== 'continue') fail(400, 'Personal payments go straight through');
      const payeeName = text(body.payeeName, 120);
      if (!payeeName) fail(400, 'Who is the payment to?');
      if (account.balanceM < sizeM) fail(400, `Insufficient funds in ${account.name}`);
      account.balanceM = round(account.balanceM - sizeM, 2);
      const payment = store.addPayment({ id: store.nextId('p', store.data.payments), memberId: me, accountId: account.id, payeeName, sizeM, purpose, at: now() });
      commit();
      return { kind: 'payment', id: payment.id };
    }

    let asset = body.assetId ? store.asset(body.assetId) : null;
    if (body.assetId && !asset) fail(400, 'Unknown payee');
    if (!asset) {
      const name = text(body.payeeName, 120);
      if (!name) fail(400, 'Who is the payment to?');
      if (!isTopic(body.topic)) fail(400, 'Choose what kind of transaction this is');
      asset = store.addAsset({ id: `a_new_${store.data.assets.length + 1}`, name, topic: body.topic, initialStakeholders: [], createdBy: me });
    }
    const deal = store.addDeal({
      id: store.nextId('d', store.data.deals), memberId: me, assetId: asset.id, topic: asset.topic, sizeM, accountId: account.id,
      purpose, createdAt: now(), status: 'review', decision: null, decidedAt: null, outcome: null,
    });
    let threads = [];
    let entry = null;
    if (body.action === 'continue') entry = decide(me, deal, 'proceed');
    else threads = consult(me, deal, body.advisorIds, body.question);
    commit();
    return { kind: 'transaction', id: deal.id, threads, ledgerSeq: entry?.seq ?? null };
  });

  route('GET', '/api/transactions/:id', (me, { params }) => {
    const deal = ownDeal(me, params.id);
    return {
      ...dealSummary(deal),
      account: store.account(deal.accountId),
      advice: store.adviceForDeal(deal.id).map(adviceView),
      waitingOn: store.data.requests.filter((r) => r.dealId === deal.id && r.status === 'pending').map((r) => ({ ...memberCard(r.toId), threadId: r.threadId, since: r.createdAt })),
      ...(deal.status === 'review' ? advisory(me, { topic: deal.topic, assetId: deal.assetId, sizeM: deal.sizeM, purpose: deal.purpose ?? '', payeeName: assetName(deal.assetId) }) : { caseStudy: caseStudy(store, me, { topic: deal.topic, assetId: deal.assetId, sizeM: deal.sizeM, now: now() }) }),
      blame: blameReport(store, deal.id),
    };
  });

  route('POST', '/api/transactions/:id/consult', (me, { params, body }) => {
    const deal = ownDeal(me, params.id);
    if (deal.status !== 'review') fail(409, 'This transaction has already been decided');
    const threads = consult(me, deal, body.advisorIds, body.question);
    if (!threads.length) fail(400, 'You have already asked everyone you picked');
    commit();
    return { threads };
  });

  route('POST', '/api/transactions/:id/continue', (me, { params }) => { const e = decide(me, ownDeal(me, params.id), 'proceed'); commit(); return { ledgerSeq: e.seq }; });
  route('POST', '/api/transactions/:id/cancel', (me, { params }) => { const e = decide(me, ownDeal(me, params.id), 'pass'); commit(); return { ledgerSeq: e.seq }; });

  // Demo control: in production the outcome arrives when the distribution lands, or from marks.
  route('POST', '/api/transactions/:id/outcome', (me, { params, body }) => {
    const deal = ownDeal(me, params.id);
    if (!deal.decision) fail(409, 'Send or cancel the transaction first');
    if (deal.outcome) fail(409, 'Outcome already recorded');
    const multiple = Number(body.multiple);
    if (!Number.isFinite(multiple) || multiple < 0 || multiple > 100) fail(400, 'Enter the multiple returned, e.g. 1.4');
    deal.outcome = { multiple: round(multiple, 2), resolvedAt: now(), holdYears: round((now() - deal.decidedAt) / YEAR, 1), counterfactual: deal.decision === 'pass' };
    if (deal.decision === 'proceed') {
      const account = store.account(deal.accountId);
      account.balanceM = round(account.balanceM + deal.sizeM * multiple, 2);
    }
    const advisors = store.adviceForDeal(deal.id).map((a) => a.advisorId);
    write({ kind: 'outcome', actorId: 'system', subjectIds: [me, ...advisors], dealId: deal.id, payload: { multiple: deal.outcome.multiple, holdYears: deal.outcome.holdYears, counterfactual: deal.outcome.counterfactual } });
    commit();
    return { ok: true };
  });

  // ── Private Line: the bank's members-only messaging ──────────────────────
  const threadView = (t, me) => {
    const otherId = t.participants.find((p) => p !== me);
    const messages = store.messagesIn(t.id);
    const last = messages[messages.length - 1];
    const request = t.requestId ? store.data.requests.find((r) => r.id === t.requestId) : null;
    const deal = t.dealId ? store.deal(t.dealId) : null;
    return {
      id: t.id,
      kind: t.kind,
      other: memberCard(otherId),
      subject: deal ? assetName(deal.assetId) : t.kind === 'intro' ? 'Introduction' : 'Direct',
      last: last ? { body: last.body, at: last.createdAt, fromMe: last.fromId === me, verdict: last.verdict ?? null } : null,
      awaitingYou: (request?.status === 'pending' && request.toId === me) || store.data.intros.some((i) => i.threadId === t.id && i.viaId === me && i.status === 'pending'),
      updatedAt: last?.createdAt ?? t.createdAt,
    };
  };

  const ownThread = (me, id) => {
    const t = store.thread(id);
    if (!t || !t.participants.includes(me)) fail(404, 'Conversation not found');
    return t;
  };

  route('GET', '/api/threads', (me) => store.threadsOf(me).map((t) => threadView(t, me)).sort((a, b) => b.awaitingYou - a.awaitingYou || b.updatedAt - a.updatedAt).slice(0, 60));

  route('GET', '/api/threads/:id', (me, { params }) => {
    const t = ownThread(me, params.id);
    const request = t.requestId ? store.data.requests.find((r) => r.id === t.requestId) : null;
    const deal = t.dealId ? store.deal(t.dealId) : null;
    const view = {
      ...threadView(t, me),
      messages: store.messagesIn(t.id).map((m) => ({
        id: m.id, fromMe: m.fromId === me, fromName: memberName(m.fromId), body: m.body, at: m.createdAt, verdict: m.verdict ?? null, ledgerSeq: m.ledgerSeq ?? store.advice(m.adviceId)?.ledgerSeq ?? null,
        intro: m.introId ? (() => { const i = store.data.intros.find((x) => x.id === m.introId); return { id: i.id, status: i.status, targetName: memberName(i.targetId), requesterName: memberName(i.requesterId), canRespond: i.viaId === me && i.status === 'pending' }; })() : null,
      })),
      deal: deal ? { id: deal.memberId === me ? deal.id : null, assetName: assetName(deal.assetId), topicName: topicName(deal.topic), sizeM: deal.sizeM, purpose: deal.purpose ?? '', status: deal.status, ownerName: memberName(deal.memberId), mine: deal.memberId === me } : null,
      request: request ? { id: request.id, status: request.status, askedMe: request.toId === me } : null,
      onRecord: !!deal,
    };
    if (request?.status === 'pending' && request.toId === me) {
      const context = adviceContext(store, { advisorId: me, recipientId: request.fromId, assetId: deal.assetId, topic: deal.topic, at: now() });
      view.advisorBrief = {
        disclosure: context,
        scoring: { proceed: estimateBias(model(), context, 'proceed', 0.75), pass: estimateBias(model(), context, 'pass', 0.75) },
        yourRecord: credibility(store, me, deal.topic),
      };
    }
    return view;
  });

  route('POST', '/api/threads', (me, { body }) => {
    const toId = body.toId;
    if (!store.member(toId) || toId === me) fail(400, 'Unknown member');
    if (!store.areFriends(me, toId)) fail(400, 'You can message people in your network. Ask a mutual friend for an introduction.');
    const message = text(body.body, 2000);
    let t = store.data.threads.find((x) => x.kind === 'direct' && x.participants.includes(me) && x.participants.includes(toId));
    if (!t) t = store.addThread({ id: store.nextId('t', store.data.threads), kind: 'direct', participants: [me, toId], createdAt: now() });
    if (message) store.addMessage({ id: `msg${store.data.messages.length + 1}`, threadId: t.id, fromId: me, body: message, createdAt: now() });
    commit();
    return { id: t.id };
  });

  route('POST', '/api/threads/:id/messages', (me, { params, body }) => {
    const t = ownThread(me, params.id);
    const message = text(body.body, 2000);
    const otherId = t.participants.find((p) => p !== me);
    const request = t.requestId ? store.data.requests.find((r) => r.id === t.requestId) : null;
    const deal = t.dealId ? store.deal(t.dealId) : null;
    const at = now();

    if (body.verdict) {
      if (!request || request.toId !== me || request.status !== 'pending') fail(409, 'There is no open question for you in this conversation');
      const { rec } = body.verdict;
      const confidence = Number(body.verdict.confidence);
      if (!['proceed', 'pass'].includes(rec)) fail(400, 'Choose send it or hold off');
      if (!(confidence >= 0.5 && confidence <= 1)) fail(400, 'Confidence must be between 50% and 100%');
      if (message.length < 10) fail(400, 'Add a sentence on why. It goes on the record with your call.');
      const advice = store.addAdvice({
        id: store.nextId('v', store.data.advice), dealId: deal.id, requestId: request.id, advisorId: me, recipientId: deal.memberId,
        topic: deal.topic, rec, confidence: round(confidence, 2), rationale: message, createdAt: at,
        context: adviceContext(store, { advisorId: me, recipientId: deal.memberId, assetId: deal.assetId, topic: deal.topic, at }),
      });
      const entry = write({ kind: 'advice', actorId: me, subjectIds: [deal.memberId], dealId: deal.id, payload: { adviceId: advice.id, threadId: t.id, rec, confidence: advice.confidence, rationale: message, disclosed: advice.context } });
      advice.ledgerSeq = entry.seq;
      request.status = 'answered';
      request.adviceId = advice.id;
      store.addMessage({ id: `msg${store.data.messages.length + 1}`, threadId: t.id, fromId: me, body: message, createdAt: at, verdict: { rec, confidence: advice.confidence }, adviceId: advice.id });
      commit();
      return { ok: true, ledgerSeq: entry.seq };
    }

    if (!message) fail(400, 'Write a message');
    const msg = store.addMessage({ id: `msg${store.data.messages.length + 1}`, threadId: t.id, fromId: me, body: message, createdAt: at });
    // Anything said about a transaction goes on the record; direct conversations stay private.
    if (deal) msg.ledgerSeq = write({ kind: 'message', actorId: me, subjectIds: [otherId], dealId: deal.id, payload: { threadId: t.id, messageId: msg.id, body: message } }).seq;
    commit();
    return { ok: true, ledgerSeq: msg.ledgerSeq ?? null };
  });

  route('POST', '/api/requests/:id/decline', (me, { params }) => {
    const request = store.data.requests.find((r) => r.id === params.id);
    if (!request || request.toId !== me) fail(404, 'Request not found');
    if (request.status !== 'pending') fail(409, 'This request is closed');
    request.status = 'declined';
    store.addMessage({ id: `msg${store.data.messages.length + 1}`, threadId: request.threadId, fromId: me, body: 'I would rather not weigh in on this one.', createdAt: now() });
    commit();
    return { ok: true };
  });

  // ── Network ───────────────────────────────────────────────────────────────
  route('GET', '/api/network', (me) => ({
    gaps: networkGaps(store, me, now()),
    friends: store.friendsOf(me).map((f) => ({ ...memberCard(f.id), strength: f.strength, declaredTopics: store.member(f.id).declaredTopics })),
  }));

  route('POST', '/api/intros', (me, { body }) => {
    const { targetId, viaId, topic } = body;
    if (!store.member(targetId) || targetId === me) fail(400, 'Unknown member');
    if (store.areFriends(me, targetId)) fail(400, 'You are already connected');
    if (!store.areFriends(me, viaId) || !store.areFriends(viaId, targetId)) fail(400, 'That friend does not know them');
    if (store.data.intros.some((i) => i.requesterId === me && i.targetId === targetId && i.status === 'pending')) fail(409, 'You have already asked for this introduction');
    let t = store.data.threads.find((x) => x.kind === 'direct' && x.participants.includes(me) && x.participants.includes(viaId));
    if (!t) t = store.addThread({ id: store.nextId('t', store.data.threads), kind: 'direct', participants: [me, viaId], createdAt: now() });
    const intro = store.addIntro({ id: store.nextId('i', store.data.intros), requesterId: me, viaId, targetId, topic: isTopic(topic) ? topic : null, threadId: t.id, createdAt: now(), status: 'pending' });
    const note = text(body.note, 500) || `Would you introduce me to ${memberName(targetId)}? I have nobody to ask about ${topic && isTopic(topic) ? topicName(topic).toLowerCase() : 'this'}.`;
    store.addMessage({ id: `msg${store.data.messages.length + 1}`, threadId: t.id, fromId: me, body: note, createdAt: now(), introId: intro.id });
    commit();
    return { threadId: t.id };
  });

  route('POST', '/api/intros/:id/respond', (me, { params, body }) => {
    const intro = store.data.intros.find((i) => i.id === params.id);
    if (!intro || intro.viaId !== me) fail(404, 'Introduction not found');
    if (intro.status !== 'pending') fail(409, 'Already handled');
    intro.status = body.accept ? 'introduced' : 'declined';
    const at = now();
    store.addMessage({ id: `msg${store.data.messages.length + 1}`, threadId: intro.threadId, fromId: me, body: body.accept ? `Done. I have introduced you to ${memberName(intro.targetId)}.` : 'I would rather not make that introduction.', createdAt: at });
    if (body.accept && !store.areFriends(intro.requesterId, intro.targetId)) {
      store.addConnection({ a: intro.requesterId, b: intro.targetId, strength: 0.3, since: at, introducedBy: me });
      const t = store.addThread({ id: store.nextId('t', store.data.threads), kind: 'direct', participants: [intro.requesterId, intro.targetId], createdAt: at });
      store.addMessage({ id: `msg${store.data.messages.length + 1}`, threadId: t.id, fromId: me, body: `${memberName(intro.requesterId)}, meet ${memberName(intro.targetId)}. ${memberName(intro.targetId).split(' ')[0]} knows ${intro.topic ? topicName(intro.topic).toLowerCase() : 'this area'} better than anyone I know.`, createdAt: at });
    }
    commit();
    return { ok: true };
  });

  // ── Dossiers and research beyond the network ─────────────────────────────
  route('GET', '/api/people/:id/dossier', (me, { params }) => {
    if (!store.member(params.id)) fail(404, 'Member not found');
    if (!canReadDossier(store, me, params.id)) fail(403, 'Dossiers are shared with friends and people one introduction away');
    const markdown = dossierDir ? readDossier(dossierDir, params.id) : null;
    if (!markdown) fail(404, 'No dossier yet');
    return { ...memberCard(params.id), markdown: publicMarkdown(markdown), friend: store.areFriends(me, params.id) };
  });

  route('POST', '/api/research', async (me, { body }) => {
    if (!researcher) fail(503, 'Public research is not switched on. Set ANTHROPIC_API_KEY on the server to enable it.');
    if (!isTopic(body.topic)) fail(400, 'Choose a topic');
    const query = researchQuery({ topic: body.topic, purpose: text(body.purpose, 300), payeeName: text(body.payeeName, 120), sizeM: parseSize(body.sizeM), includeName: !!body.includeName });
    try {
      return await researcher.research(query);
    } catch (err) {
      if (err instanceof ResearchError) fail(502, err.message);
      console.error('research failed', err);
      fail(502, 'The research service is unavailable right now.');
    }
  });

  // ── Case studies ──────────────────────────────────────────────────────────
  route('GET', '/api/precedents', (me, { query }) => {
    const topic = query.get('topic');
    if (!isTopic(topic)) fail(400, 'Choose a topic');
    const assetId = query.get('assetId') || null;
    return { topicName: topicName(topic), assetName: assetId ? assetName(assetId) : null, ...caseStudy(store, me, { topic, assetId, sizeM: parseSize(query.get('sizeM') ?? 100), now: now() }) };
  });

  // ── The record ────────────────────────────────────────────────────────────
  route('GET', '/api/record', (me, { query }) => {
    const kind = query.get('kind');
    const limit = Math.min(Number(query.get('limit')) || 80, 500);
    const entries = [];
    for (let i = store.data.ledger.length - 1; i >= 0 && entries.length < limit; i--) {
      const e = store.data.ledger[i];
      if (!ledger.involves(e, me) || (kind && e.kind !== kind)) continue;
      const dealIsMine = store.deal(e.dealId)?.memberId === me;
      if (e.kind === 'outcome' && !dealIsMine) continue;
      entries.push({ seq: e.seq, ts: e.ts, kind: e.kind, dealId: dealIsMine ? e.dealId : null, summary: describeEntry(e, me), hash: e.hash, prevHash: e.prevHash });
    }
    return { entries, verify: ledger.verify(store.data.ledger), board: blameBoard(store, me), model: describeModel(model()) };
  });

  return async function handle(method, url, headers, body) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const match = url.pathname.match(r.regex);
      if (!match) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      let me = null;
      if (r.auth) {
        // Demo sign-in: the client says which member it is viewing as. Production needs real auth.
        me = headers['x-member-id'];
        if (!me || !store.member(me)) fail(401, 'Sign in first');
      }
      return r.handler(me, { params, query: url.searchParams, body: body ?? {} });
    }
    fail(404, 'Not found');
  };
}
